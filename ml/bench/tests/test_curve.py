"""The learning curve (curve.py), with a scripted engine and fake checkpoints: no model, no GPU. The runs through `gkod
batch` need the OpenSCAD web build, like the runner tests."""

import hashlib
import json

import pytest
from fake_set import ScriptedEngine, echo_reference, make_set
from test_subsets import subset_file

from gkod_bench import curve as cv
from gkod_bench.engines.base import Answer
from gkod_bench.paths import REPO
from gkod_bench.run import RowMismatch, read_records, row_dir, run_row

needs_gkod = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)
WEIGHTS = "w" * 64
VERSIONS = {"mlx": "0.32.4", "mlx_lm": "0.32.2"}


# ---- the losses and the two rules (no compiling) ----


def test_the_train_loss_of_a_point_is_the_token_weighted_mean_since_the_last_checkpoint(tmp_path):
    rows = [
        {"kind": "train", "step": 1, "loss": 2.0, "answer_tokens": 100},
        {"kind": "train", "step": 2, "loss": 1.0, "answer_tokens": 300},
        {"kind": "val", "step": 2, "loss": 1.5},
        {"kind": "train", "step": 3, "loss": 9.0, "answer_tokens": 100},
        "not json",
        {"kind": "train", "step": 3, "loss": 0.5, "answer_tokens": 100},  # a step logged again keeps its last line
        {"kind": "save", "step": 3},
    ]
    (tmp_path / "train_log.jsonl").write_text("".join((r if isinstance(r, str) else json.dumps(r)) + "\n" for r in rows))
    train, val = cv.read_losses(tmp_path)
    assert val == {2: 1.5} and train[3]["loss"] == 0.5
    assert cv.train_loss_between(train, 0, 2) == {"loss": pytest.approx((200 + 300) / 400), "steps": [1, 2]}
    assert cv.train_loss_between(train, 2, 3) == {"loss": 0.5, "steps": [3, 3]}
    assert cv.train_loss_between(train, 3, 9) is None
    # validation losses from val_loss.jsonl when the log has none
    (tmp_path / "train_log.jsonl").write_text(json.dumps(rows[0]) + "\n")
    (tmp_path / "val_loss.jsonl").write_text(json.dumps({"step": 0, "val_loss": 3.0}) + "\n")
    assert cv.read_losses(tmp_path)[1] == {0: 3.0}


def points_from(counts, n=50):
    """Points with k of n right, where the right prompts are the first k (so a later point's right set holds an
    earlier one's), and the per-prompt answers for the paired rule."""
    points, rights = [], {}
    for step, k in counts:
        points.append({"step": step, "complete": True, "right_part": {"k": k, "n": n, "rate": k / n, "ci95": list(wilson_ci(k, n))}, "checkpoint": f"{step:07d}_adapters.safetensors" if step else None})
        rights[step] = {f"p{i}": i < k for i in range(n)}
    return points, rights


def wilson_ci(k, n):
    from gkod_bench.stats import wilson

    return wilson(k, n)


def test_the_interval_rule_finds_the_first_point_the_next_two_do_not_rise_above():
    points, _ = points_from([(0, 0), (50, 20), (100, 22), (150, 21), (200, 21)])
    sat = cv.interval_saturation(points)
    # 0 of 50 has an upper end of about 7%, and 20 of 50 is above it; 20 of 50 has about 54%, and 44% and 42% are not
    assert sat["step"] == 50 and sat["saturated"] and sat["rises_later"] == [] and sat["ci95_upper"] == pytest.approx(wilson_ci(20, 50)[1])
    assert [p["step"] for p in sat["next_two"]] == [100, 150]
    # a point that is flat for two points and then rises above its interval is not where the curve stops
    points, _ = points_from([(0, 0), (50, 20), (100, 22), (150, 21), (200, 40)])
    sat = cv.interval_saturation(points)
    assert sat["step"] is None and sat["verdict"] == cv.NOT_SATURATED and sat["first_flat"]["step"] == 50 and sat["first_flat"]["rises_later"] == [200]
    # still rising: no step yet; too few points: no step
    points, _ = points_from([(0, 0), (50, 10), (100, 25), (150, 45)])
    assert cv.interval_saturation(points)["step"] is None
    assert "three" in cv.interval_saturation(points[:2])["note"]
    # an unfinished point ends what can be read
    points, _ = points_from([(0, 0), (50, 20), (100, 22), (150, 21)])
    points[2]["complete"] = False
    assert cv.interval_saturation(points)["step"] is None and cv.interval_saturation(points)["points_read"] == 2


def test_the_paired_rule_is_the_earliest_point_no_later_point_beats_by_a_real_margin():
    points, rights = points_from([(0, 0), (50, 20), (100, 22), (150, 21), (200, 21)])
    sat = cv.paired_saturation(points, rights)
    # 20 of 50 beats 0 of 50 (p far below 0.05); 22 against 20 is 2 discordant prompts, p 0.5
    assert sat["step"] == 50 and sat["saturated"] and sat["earliest_unbeaten_step"] == 50
    assert all(not t["beats_it"] for t in sat["against_later"]) and sat["against_later"][0]["only_later"] == 2
    # 6 prompts gained with none lost is the least a later point needs on 50 prompts (p 0.031; 5 gives 0.0625)
    assert sat["min_detectable_gain"]["prompts"] == 6 and sat["min_detectable_gain"]["of"] == 50
    # nothing later to test the last point against
    points, rights = points_from([(0, 0), (50, 25)])
    sat = cv.paired_saturation(points, rights)
    assert sat["step"] is None and sat["earliest_unbeaten_step"] == 50 and "among the last 3" in sat["why"][0]


def test_a_curve_still_rising_at_the_end_is_not_saturated_within_the_run():
    steps = list(range(0, 701, 50))
    # the 50 prompts can hardly ever show the last points beaten, so without the end check the paired rule named step
    # 600 (29 right, against 33 at the end: 4 to 0, p 0.125) and the interval rule step 0, on a curve that never flattens
    for climb in ([5 + 2 * i for i in range(15)], [5 + i for i in range(15)]):
        points, rights = points_from(list(zip(steps, climb)))
        paired, interval = cv.paired_saturation(points, rights), cv.interval_saturation(points)
        assert paired["step"] is None and paired["verdict"] == cv.NOT_SATURATED and paired["end_of_run"]["rising"]
        assert interval["step"] is None and interval["verdict"] == cv.NOT_SATURATED
    # a real plateau still gets a step, at or before where it flattens (step 400): the rules cannot see small gains
    plateau = [5, 8, 11, 14, 17, 20, 23, 26, 28, 28, 28, 28, 28, 28, 28]
    points, rights = points_from(list(zip(steps, plateau)))
    paired, interval = cv.paired_saturation(points, rights), cv.interval_saturation(points)
    assert paired["saturated"] and paired["step"] <= 400 and interval["saturated"] and interval["step"] <= 400
    assert not paired["end_of_run"]["rising"]
    # the trend test: a steady rise is found, a flat run is not
    rising = cv.trend_test(points_from([(s, 10 + 2 * i) for i, s in enumerate(steps[:8])])[0])
    flat = cv.trend_test(points_from([(s, 20) for s in steps[:8]])[0])
    assert rising["p_rising"] < 0.05 and rising["slope_per_100_steps"] == pytest.approx(0.08) and flat["p_rising"] >= 0.5


def test_full_dev_gets_the_last_checkpoint_and_the_best_on_the_subset_with_ties_to_the_later():
    points, _ = points_from([(0, 0), (50, 20), (100, 24), (150, 21), (200, 23)])
    fd = cv.full_dev_candidates(points, [50, 100, 150, 200], "finished")
    assert fd["steps"] == [200, 100] and "note" not in fd
    points, _ = points_from([(0, 0), (50, 24), (100, 24)])
    assert cv.full_dev_candidates(points, [50, 100], "finished")["steps"] == [100]
    assert cv.full_dev_candidates(points, [50, 100, 150], "finished")["steps"] is None
    assert "not finished" in cv.full_dev_candidates(points, [50, 100], "running")["note"]


# ---- whole curves through the runner (a scripted engine, fake checkpoints) ----


STEPS = (50, 100, 150, 200)


def make_run(folder, status="finished", steps=STEPS):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "adapter_config.json").write_text(json.dumps({"fine_tune_type": "lora", "num_layers": 2}))
    for step in steps:
        (folder / f"{step:07d}_adapters.safetensors").write_bytes(f"checkpoint {step}".encode())
    log = [{"kind": "val", "step": 0, "loss": 2.0}]
    for step in range(1, max(steps) + 1):
        log.append({"kind": "train", "step": step, "rows_seen": 8 * step, "loss": 2.0 - step / 200, "answer_tokens": 1000})
        if step % 50 == 0:
            log.append({"kind": "val", "step": step, "loss": 1.9 - step / 400})
    (folder / "train_log.jsonl").write_text("".join(json.dumps(r) + "\n" for r in log))
    (folder / "run.json").write_text(json.dumps({"name": "toy", "status": status, "plan": {"effective_batch": 8}, "model": {"path": "ml/models/toy", "weights_sha256": WEIGHTS}}))
    return folder


class Maker:
    """Engines for the curve: the untrained model answers nothing useful, step 50 makes only the t1 plate, and later
    checkpoints make every part (the right answers come from the fake set's reference)."""

    def __init__(self, fail_at=None):
        self.made, self.calls, self.closed = [], [], 0
        self.fail_at = fail_at

    def __call__(self, adapter, batch):
        step = int(adapter.name) if adapter else 0
        sha = hashlib.sha256((adapter / "adapters.safetensors").read_bytes()).hexdigest() if adapter else None
        self.made.append((step, batch))
        maker = self

        def script(messages):
            maker.calls.append((step, messages.user))
            if maker.fail_at is not None and len(maker.calls) == maker.fail_at:
                raise KeyboardInterrupt
            if step == 0 or (step == 50 and "60 mm wide" not in messages.user):
                return "Sorry, no code."
            return echo_reference(messages)

        settings = {"engine": "local", "weights_sha256": WEIGHTS, "adapter": str(adapter) if adapter else None, "adapter_sha256": sha, "temperature": 0.0, "max_tokens": 1024}
        engine = ScriptedEngine(script, settings)
        engine.close = lambda: setattr(maker, "closed", maker.closed + 1)
        return engine


@pytest.fixture
def toy(tmp_path):
    sets = tmp_path / "sets"
    hashes = make_set(sets)
    files = {name: hashlib.sha256((sets / name).read_bytes()).hexdigest() for name in ("dev/create.jsonl", "dev/edit.jsonl")}
    subset_file(tmp_path / "subsets", "mini", ["d-1", "d-2", "de-1"], files)
    run = make_run(tmp_path / "adapters" / "toy")
    kw = {"results": tmp_path / "results", "sets_dir": sets, "hashes": hashes, "subsets_dir": tmp_path / "subsets", "versions": VERSIONS, "log": lambda line: None}
    return {"run": run, "kw": kw, "files": files, "tmp": tmp_path}


@needs_gkod
def test_the_curve_scores_every_checkpoint_on_the_subset_and_writes_the_points(toy):
    maker = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=maker, **toy["kw"])
    results = toy["kw"]["results"]
    assert [m[0] for m in maker.made] == [0, 50, 100, 150, 200] and maker.closed == 5
    # the same three prompts for every point, and nothing else
    asked = {}
    for step, user in maker.calls:
        asked.setdefault(step, set()).add(user)
    assert len(maker.calls) == 15 and len({frozenset(v) for v in asked.values()}) == 1
    pts = curve["points"]
    assert [p["step"] for p in pts] == [0, 50, 100, 150, 200]
    assert [p["right_part"]["k"] for p in pts] == [0, 1, 3, 3, 3] and all(p["complete"] for p in pts)
    assert pts[0]["row"] == "mini-base-toy" and pts[0]["source"] == "scored" and pts[0]["train_loss"] is None
    assert pts[1]["row"] == "mini-toy-s0000050" and pts[1]["rows_seen"] == 400
    assert pts[1]["train_loss"]["steps"] == [1, 50] and pts[2]["train_loss"]["steps"] == [51, 100]
    assert pts[2]["train_loss"]["loss"] == pytest.approx(2.0 - 75.5 / 200)
    assert pts[0]["valid_loss"] == 2.0 and pts[4]["valid_loss"] == pytest.approx(1.4)
    assert pts[1]["tiers"]["t1"]["right_part"]["k"] == 1 and pts[1]["tiers"]["edit"]["right_part"]["k"] == 0
    assert pts[2]["compiles"]["rate"] == 1.0 and pts[2]["iou_median"] == pytest.approx(1.0) and pts[0]["no_code"] == 3
    assert pts[1]["adapter_sha256"] == hashlib.sha256(b"checkpoint 50").hexdigest()
    # 3 of 3 at step 100 has an upper end of 1, and the next two do not go above it
    assert curve["saturation"]["interval_rule"]["step"] == 100
    # with 3 prompts no difference is a real margin, so the paired rule stays at step 0
    assert curve["saturation"]["paired_rule"]["step"] == 0
    assert curve["full_dev_candidates"]["steps"] == [200]
    assert curve["subset"]["prompts"] == 3 and curve["settings"]["batch_size"] == 1 and curve["run_status"] == "finished"
    saved = json.loads((results / "curve" / "toy" / "mini.json").read_text())
    assert saved["points"][2]["right_part"]["k"] == 3
    # each point is an ordinary row on the subset, with the checkpoint as its adapter folder (as train.py makes it)
    config = json.loads((row_dir(results, "mini-toy-s0000100", "dev") / "run.json").read_text())
    assert config["subset"]["ids"] == ["d-1", "d-2", "de-1"]
    assert config["engine"]["adapter"].endswith("at/0000100")
    assert (toy["run"] / "at" / "0000100" / "adapters.safetensors").read_bytes() == b"checkpoint 100"
    # the same prompts a plain row gets
    plain = ScriptedEngine(echo_reference)
    run_row(plain, "plain", "dev", results=results, sets_dir=toy["kw"]["sets_dir"], hashes=toy["kw"]["hashes"], log=lambda line: None)
    by_id = {r["id"]: r["prompt"] for r in read_records(results, "plain", "dev")}
    for r in read_records(results, "mini-toy-s0000100", "dev"):
        assert r["prompt"] == by_id[r["id"]]
    if curve["plot"]:  # matplotlib is installed (the Mac's venv)
        assert (results / "curve" / "toy" / "mini.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    # run again: nothing is asked
    again = Maker()
    cv.run_curve(toy["run"], "mini", make_engine=again, **toy["kw"])
    assert again.made == [] and again.calls == []


@needs_gkod
def test_the_curve_runs_in_stages_and_resumes_inside_a_point(toy):
    first = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=first, max_checkpoints=2, **toy["kw"])
    assert [m[0] for m in first.made] == [0, 50]
    assert [p["complete"] for p in curve["points"]] == [True, True, False, False, False]
    assert curve["full_dev_candidates"]["steps"] is None
    # stopped in the middle of step 100 (Ctrl-C on its second prompt)
    second = Maker(fail_at=2)
    with pytest.raises(KeyboardInterrupt):
        cv.run_curve(toy["run"], "mini", make_engine=second, **toy["kw"])
    assert second.closed == 1
    done = [r for r in read_records(toy["kw"]["results"], "mini-toy-s0000100", "dev") if r["status"] == "done"]
    assert len(done) == 1
    # answers that do not come (three in a row) stop the row part way, and the later points wait for it
    class Silent(Maker):
        def __call__(self, adapter, batch):
            engine = super().__call__(adapter, batch)
            engine.script = lambda messages: Answer
            return engine

    silent = Silent()
    curve = cv.run_curve(toy["run"], "mini", make_engine=silent, **toy["kw"])
    assert [m[0] for m in silent.made] == [100] and not curve["points"][2]["complete"]
    third = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=third, **toy["kw"])
    assert [m[0] for m in third.made] == [100, 150, 200]
    assert sum(1 for step, _ in third.calls if step == 100) == 2  # only the two prompts left
    assert all(p["complete"] for p in curve["points"]) and [p["right_part"]["k"] for p in curve["points"]] == [0, 1, 3, 3, 3]


@needs_gkod
def test_the_curve_refuses_a_run_still_training_and_a_checkpoint_that_changed(toy):
    run = make_run(toy["tmp"] / "adapters" / "busy", status="running", steps=(50,))
    with pytest.raises(cv.CurveError, match="still training"):
        cv.run_curve(run, "mini", make_engine=Maker(), **toy["kw"])
    # plot-only reads what is there without scoring
    curve = cv.run_curve(run, "mini", make_engine=Maker(), plot_only=True, **toy["kw"])
    assert [p["done"] for p in curve["points"]] == [0, 0]
    cv.run_curve(run, "mini", make_engine=Maker(), even_if_running=True, **toy["kw"])
    (run / "0000050_adapters.safetensors").write_bytes(b"trained again")
    with pytest.raises(RowMismatch, match="another checkpoint"):
        cv.run_curve(run, "mini", make_engine=Maker(), even_if_running=True, **toy["kw"])


def base_like(settings_extra=None):
    """A scripted engine whose settings look like the untrained local model's zero-shot row."""
    settings = {
        "engine": "local", "model": "toy", "weights_sha256": WEIGHTS, "adapter": None, "adapter_sha256": None,
        "decoding": "greedy", "temperature": 0.0, "seed": 0, "max_tokens": 1024, **VERSIONS, **(settings_extra or {}),
    }
    return ScriptedEngine(lambda m: "no code here", settings)


@needs_gkod
def test_step_0_comes_from_the_baseline_row_only_when_its_settings_are_the_same(toy):
    kw = {k: toy["kw"][k] for k in ("results", "sets_dir", "hashes", "log")}
    run_row(base_like(), "local-toy-0shot", "dev", **kw)
    maker = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=maker, **toy["kw"])
    assert 0 not in [m[0] for m in maker.made]
    assert curve["points"][0]["row"] == "local-toy-0shot" and curve["points"][0]["source"] == "row local-toy-0shot"
    assert curve["points"][0]["right_part"]["n"] == 3 and curve["points"][0]["complete"]
    # other token limits, other weights or other mlx versions: step 0 is scored as its own row
    run_row(base_like({"max_tokens": 512}), "short", "dev", **kw)
    run_row(base_like({"weights_sha256": "v" * 64}), "other-weights", "dev", **kw)
    for row, reason in (("short", "token limit is 512"), ("other-weights", "not the run's base weights"), ("missing", "there is no row")):
        want = {"weights_sha256": WEIGHTS, "max_tokens": 1024, "versions": VERSIONS, "system_sha256": json.loads((row_dir(kw["results"], "local-toy-0shot", "dev") / "run.json").read_text())["system_sha256"], "slider_ends": True}
        assert reason in cv.base_row_misfit(kw["results"], row, ["d-1", "d-2", "de-1"], toy["files"], want)
    want["versions"] = {"mlx": "0.31.0", "mlx_lm": "0.32.2"}
    assert "mlx versions" in cv.base_row_misfit(kw["results"], "local-toy-0shot", ["d-1"], toy["files"], want)
    maker = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=maker, base_row_name="short", **{**toy["kw"], "results": toy["tmp"] / "results2"})
    assert maker.made[0] == (0, 1) and curve["points"][0]["row"] == "mini-base-toy"
    # a batched curve never borrows a one-at-a-time row
    maker = Maker()
    curve = cv.run_curve(toy["run"], "mini", make_engine=maker, batch=4, **toy["kw"])
    assert maker.made[0] == (0, 4) and curve["points"][0]["row"] == "mini-base-toy-b4" and curve["points"][1]["row"] == "mini-toy-s0000050-b4"
    assert curve["settings"]["batch_size"] == 4 and (toy["kw"]["results"] / "curve" / "toy" / "mini-b4.json").exists()


@needs_gkod
def test_same_answers_counts_identical_texts_and_shows_where_they_part(toy):
    kw = {k: toy["kw"][k] for k in ("results", "sets_dir", "hashes", "log")}
    run_row(ScriptedEngine(echo_reference), "a", "dev", **kw)
    run_row(ScriptedEngine(lambda m: echo_reference(m) if "60 mm" in m.user else echo_reference(m) + "\nextra"), "b", "dev", **kw)
    out = cv.same_answers("a", "b", results=kw["results"])
    assert out["both"] == 4 and out["same"] == 1 and len(out["differ"]) == 3
    d = out["differ"][0]
    assert d["first_difference_at_char"] == d["length_a"] and d["length_b"] == d["length_a"] + 6
