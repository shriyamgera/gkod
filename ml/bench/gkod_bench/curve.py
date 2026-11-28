"""The learning curve of a training run: every saved checkpoint scored on a fixed dev subset (dev-curve), with the
same prompts, decoding and scorer as any benchmark row, next to the run's training and validation losses.

    gkod_bench curve --run adapters/run1-insurance --subset dev-curve

Each checkpoint is an ordinary benchmark row on the subset (`<subset>-<run>-s<step>`), made by run.run_row with the
local engine and that checkpoint as its adapter: greedy, the same token limit, one prompt at a time unless --batch is
given. So it resumes the way a row does (a finished prompt is never asked again), and `summarize`, `rescore` and
`compare` work on it. Step 0 is the untrained model: read from the baseline row when that row was made with the very
same settings (no model run), otherwise scored as its own row.

curve.json (results/curve/<run>/<subset>.json) has one point per checkpoint (the rates with 95% Wilson intervals,
overall and per tier, the median overlap, and the losses), two readings of where the curve stops rising, and the
checkpoints PICK_RULE.md sends to full dev. A PNG beside it draws right part and the losses against the step.

Where the curve stops rising, two rules, both over the scored points in step order (step 0 included):

- Interval rule: the earliest point s with two points after it, neither of which has a right-part rate above the upper
  end of s's 95% Wilson interval. Points after those two that do go above it are listed (`rises_later`), so a late
  rise is not hidden.
- Paired rule (PICK_RULE.md's saturation point): the earliest point that no later point beats by a real margin, that
  is with more right parts and an exact McNemar p below 0.05 on the prompts both answered. While it is the last point
  there is nothing later to test it against, and the file says so.

Neither picks a checkpoint; PICK_RULE.md does that on full dev.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from collections.abc import Callable
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path

from gkod_bench import ceiling, subsets
from gkod_bench.data import Item, check_open, load_split
from gkod_bench.engines.base import Engine
from gkod_bench.gkod import Gkod
from gkod_bench.paths import LOCAL_MODEL, REPO, RESULTS, SETS, SETS_HASHES, SUBSETS
from gkod_bench.prompts import build
from gkod_bench.run import RowMismatch, _current, expected_of, harness_source, read_records, row_dir, run_row, say, write_json
from gkod_bench.score import RIGHT_PART_IOU, right_part
from gkod_bench.stats import paired_rates, rate
from gkod_bench.summary import summarize

SPLIT = "dev"
CHECKPOINT = re.compile(r"^(\d+)_adapters\.safetensors$")
REAL_MARGIN_P = 0.05
INTERVAL_RULE = (
    "the earliest scored point with two points after it, neither of which has a right-part rate above the upper end of "
    "its 95% Wilson interval"
)
PAIRED_RULE = (
    "PICK_RULE.md: the earliest point that no later point beats by a real margin (more right parts and an exact "
    "McNemar p below 0.05 on the prompts both answered)"
)
FULL_DEV_RULE = (
    "PICK_RULE.md: at most two checkpoints of a run go to full dev, the last one and the one with the most right parts "
    "on dev-curve if that is another one; a tie on dev-curve goes to the later checkpoint"
)


class CurveError(RuntimeError):
    pass


def _shown(path: Path) -> str:
    full = Path(path).resolve()
    return str(full.relative_to(REPO)) if full.is_relative_to(REPO) else str(full)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


# The training run's folder, as ml/train/train.py writes it.


def find_checkpoints(run_dir: Path) -> list[tuple[int, Path]]:
    """The step checkpoints of a run, oldest first."""
    if not run_dir.is_dir():
        return []
    found = [(int(m.group(1)), p) for p in run_dir.iterdir() if (m := CHECKPOINT.match(p.name)) and p.is_file()]
    return sorted(found)


def read_run(run_dir: Path) -> dict:
    path = run_dir / "run.json"
    return json.loads(path.read_text()) if path.is_file() else {}


def _jsonl(path: Path) -> list[dict]:
    rows = []
    if not path.is_file():
        return rows
    for line in path.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def read_losses(run_dir: Path) -> tuple[dict[int, dict], dict[int, float]]:
    """The training rows of train_log.jsonl by step, and the validation losses by step (from train_log.jsonl, or
    val_loss.jsonl when the log has none). A step logged twice keeps its last line."""
    train: dict[int, dict] = {}
    val: dict[int, float] = {}
    for row in _jsonl(run_dir / "train_log.jsonl"):
        try:
            step = int(row["step"])
        except (KeyError, TypeError, ValueError):
            continue
        if row.get("kind") == "train" and row.get("loss") is not None:
            train[step] = row
        elif row.get("kind") == "val" and row.get("loss") is not None:
            val[step] = float(row["loss"])
    if not val:
        for row in _jsonl(run_dir / "val_loss.jsonl"):
            try:
                val[int(row["step"])] = float(row["val_loss"])
            except (KeyError, TypeError, ValueError):
                continue
    return train, val


def train_loss_between(train: dict[int, dict], after: int, upto: int) -> dict | None:
    """The training loss over the steps after `after` up to `upto`: each step's loss weighted by its answer tokens
    (one step's loss alone is 8 rows, too noisy to plot)."""
    steps = [s for s in sorted(train) if after < s <= upto]
    if not steps:
        return None
    weights = [float(train[s].get("answer_tokens") or 1) for s in steps]
    loss = sum(float(train[s]["loss"]) * w for s, w in zip(steps, weights)) / sum(weights)
    return {"loss": loss, "steps": [steps[0], steps[-1]]}


def adapter_folder(run_dir: Path, step: int) -> Path:
    """at/<step>/ in the run folder: adapter_config.json and that checkpoint as adapters.safetensors (a hard link), the
    same folder `train.py --adapter-folder STEP` makes, so mlx-lm loads one checkpoint from it."""
    checkpoint = run_dir / f"{step:07d}_adapters.safetensors"
    config = run_dir / "adapter_config.json"
    if not checkpoint.is_file():
        raise CurveError(f"There is no checkpoint at step {step} in {run_dir}.")
    if not config.is_file():
        raise CurveError(f"{run_dir} has no adapter_config.json, so its checkpoints cannot be loaded.")
    folder = run_dir / "at" / f"{step:07d}"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(config, folder / "adapter_config.json")
    target = folder / "adapters.safetensors"
    if not (target.is_file() and os.path.samefile(target, checkpoint)):
        target.unlink(missing_ok=True)
        try:
            os.link(checkpoint, target)
        except OSError:
            shutil.copyfile(checkpoint, target)
    return folder


# Names and where things go.


def _suffix(batch: int) -> str:
    return f"-b{batch}" if batch > 1 else ""


def checkpoint_row(subset: str, run: str, step: int, batch: int = 1) -> str:
    return f"{subset}-{run}-s{step:07d}{_suffix(batch)}"


def base_row(subset: str, model: str, batch: int = 1) -> str:
    return f"{subset}-base-{model}{_suffix(batch)}"


def curve_path(results: Path, run: str, subset: str, batch: int = 1) -> Path:
    return results / "curve" / run / f"{subset}{_suffix(batch)}.json"


def installed_versions() -> dict:
    out = {}
    for key, package in (("mlx", "mlx"), ("mlx_lm", "mlx-lm")):
        try:
            out[key] = metadata.version(package)
        except metadata.PackageNotFoundError:
            out[key] = None
    return out


# Step 0 from the baseline row.


def base_row_misfit(results: Path, row: str, ids: list[str], files: dict, want: dict) -> str | None:
    """Why the row cannot stand for step 0 on these prompts, or None when it can: made with the untrained model (the
    run's base weights), zero-shot, greedy, one prompt at a time, the same token limit, mlx versions, system prompt,
    set files and slider-end scoring, and every prompt of the subset done."""
    path = row_dir(results, row, SPLIT) / "run.json"
    if not path.is_file():
        return f"there is no row {row}"
    config = json.loads(path.read_text())
    engine = config.get("engine") or {}
    if not want.get("weights_sha256"):
        return "the training run does not record its base weights' sha256"
    checks = [
        (engine.get("engine") == "local", "it is not a local-model row"),
        (engine.get("adapter") is None, "it has an adapter"),
        (config.get("shots") is None and not config.get("with_tools"), "it is not zero-shot"),
        (engine.get("temperature") == 0, "it is not greedy"),
        ("batch_size" not in engine, "it was answered in batches"),
        (engine.get("max_tokens") == want["max_tokens"], f"its token limit is {engine.get('max_tokens')}, not {want['max_tokens']}"),
        (engine.get("weights_sha256") == want["weights_sha256"], "its model weights are not the run's base weights"),
        (all(engine.get(k) == v for k, v in want["versions"].items()), f"its mlx versions ({engine.get('mlx')}, {engine.get('mlx_lm')}) are not the ones here ({want['versions']})"),
        (config.get("system_sha256") == want["system_sha256"], "its system prompt is not the site's current one"),
        ((config.get("data") or {}).get("files") == files, "its set files are not the current ones"),
        ((config.get("scoring") or {}).get("slider_ends") == want["slider_ends"], "it was scored with other slider-end settings"),
    ]
    for ok, reason in checks:
        if not ok:
            return reason
    done = {r["id"] for r in _current(read_records(results, row, SPLIT), files) if r.get("status") == "done"}
    missing = [i for i in ids if i not in done]
    if missing:
        return f"{len(missing)} prompts of the subset have no scored answer in it"
    return None


# Reading a scored point.


def _rate(r: dict) -> dict:
    return {k: r[k] for k in ("k", "n", "rate", "ci95")}


def point_of(summary: dict) -> dict:
    """The numbers of one point, from the summary of its row on the subset."""
    o = summary.get("overall")
    out: dict = {"prompts": summary["prompts"], "done": summary["done"], "complete": summary["complete"]}
    if not o:
        return out
    out.update(
        right_part={**_rate(o["right_part"]), "failed": o["right_part"]["failed"]},
        compiles=_rate(o["compiles"]),
        checks_pass=_rate(o["checks_pass"]),
        stated_sizes_match={**_rate(o["stated_sizes_match"]), "prompts_with_nothing_measured": o["stated_sizes_match"]["prompts_with_nothing_measured"]},
        iou_median=o["iou"]["median"],
        iou_mean=o["iou"]["mean"],
        no_code=sum(o["no_code"].values()),
        cut_off=(o.get("generation_tokens") or {}).get("cut_off"),
    )
    tiers = {}
    for tier, g in summary["tiers"].items():
        t = {
            "prompts": g["prompts"],
            "right_part": _rate(g["right_part"]),
            "compiles": _rate(g["compiles"]),
            "checks_pass": _rate(g["checks_pass"]),
            "stated_sizes_match": _rate(g["stated_sizes_match"]),
            "iou_median": g["iou"]["median"],
        }
        if "edit_sizes_ok" in g:
            t["edit_sizes_ok"] = _rate(g["edit_sizes_ok"])
        tiers[tier] = t
    out["tiers"] = tiers
    return out


def _scorer_commit(record: dict) -> str | None:
    """The harness commit that scored the record last: the rescore's, if it was scored again."""
    return ((record.get("rescored") or {}).get("harness") or {}).get("commit") or (record.get("harness") or {}).get("commit")


# Where the curve stops rising.


def _leading_complete(points: list[dict]) -> list[dict]:
    out = []
    for p in points:
        if not p.get("complete") or "right_part" not in p:
            break
        out.append(p)
    return out


def interval_saturation(points: list[dict]) -> dict:
    pts = _leading_complete(points)
    out: dict = {"rule": INTERVAL_RULE, "points_read": len(pts)}
    for i in range(len(pts) - 2):
        high = pts[i]["right_part"]["ci95"][1]
        if all(p["right_part"]["rate"] <= high for p in pts[i + 1 : i + 3]):
            return {
                **out,
                "step": pts[i]["step"],
                "right_part": pts[i]["right_part"]["rate"],
                "ci95_upper": high,
                "next_two": [{"step": p["step"], "right_part": p["right_part"]["rate"]} for p in pts[i + 1 : i + 3]],
                "rises_later": [p["step"] for p in pts[i + 3 :] if p["right_part"]["rate"] > high],
            }
    note = "needs at least three scored points" if len(pts) < 3 else "every point so far is followed within two points by a rise above its interval"
    return {**out, "step": None, "note": note}


def paired_saturation(points: list[dict], rights: dict[int, dict[str, bool]]) -> dict:
    pts = _leading_complete(points)
    out: dict = {"rule": PAIRED_RULE, "points_read": len(pts)}
    if not pts:
        return {**out, "step": None, "note": "no scored point yet"}
    for i, p in enumerate(pts):
        tests, beaten = [], False
        for q in pts[i + 1 :]:
            common = sorted(rights[p["step"]].keys() & rights[q["step"]].keys())
            pr = paired_rates([rights[q["step"]][x] for x in common], [rights[p["step"]][x] for x in common])
            better = pr["diff"] is not None and pr["diff"] > 0 and pr["mcnemar_p"] < REAL_MARGIN_P
            tests.append({"later_step": q["step"], "only_later": pr["only_a"], "only_earlier": pr["only_b"], "p": pr["mcnemar_p"], "beats_it": better})
            beaten = beaten or better
        if not beaten:
            res = {**out, "step": p["step"], "right_part": p["right_part"]["rate"], "against_later": tests}
            if i == len(pts) - 1:
                res["note"] = "this is the last scored point, so nothing later can test it yet"
            return res
    raise AssertionError("the last point is never beaten by a later one")


def full_dev_candidates(points: list[dict], steps_in_run: list[int], run_status: str | None) -> dict:
    """The checkpoints PICK_RULE.md sends to full dev, once every checkpoint of the run is scored on the subset."""
    scored = {p["step"]: p for p in _leading_complete(points) if p["step"] != 0 and p.get("checkpoint")}
    out: dict = {"rule": FULL_DEV_RULE}
    if not steps_in_run:
        return {**out, "steps": [], "note": "the run has no checkpoints"}
    unscored = [s for s in steps_in_run if s not in scored]
    if unscored:
        return {**out, "steps": None, "note": f"{len(unscored)} checkpoints are not scored on the subset yet"}
    last = steps_in_run[-1]
    best = max(scored.values(), key=lambda p: (p["right_part"]["k"], p["step"]))["step"]
    out["steps"] = [last] if best == last else [last, best]
    out["last"], out["best_on_subset"] = last, best
    if run_status != "finished":
        out["note"] = f"the run's status is {run_status!r}, not finished: more checkpoints may come"
    return out


# The plot.


def plot(curve: dict, path: Path) -> bool:
    """Right part (with its 95% interval) and the losses against the step, in two panels on one step axis. False when
    matplotlib is not installed (the numbers are all in curve.json)."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return False
    text, muted, grid = "#191919", "#666666", "#e6e6e6"
    blue, orange = "#257de0", "#f47230"
    pts = [p for p in curve["points"] if "right_part" in p]
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(8, 6.4), sharex=True, gridspec_kw={"height_ratios": [3, 2], "hspace": 0.12})
    fig.patch.set_facecolor("#ffffff")
    for ax in (top, bottom):
        ax.set_facecolor("#ffffff")
        ax.grid(True, axis="y", color=grid, linewidth=0.8)
        ax.tick_params(colors=muted, labelsize=9)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_color("#bdbdbd")
    if pts:
        steps = [p["step"] for p in pts]
        rates = [100 * p["right_part"]["rate"] for p in pts]
        low = [100 * p["right_part"]["ci95"][0] for p in pts]
        high = [100 * p["right_part"]["ci95"][1] for p in pts]
        top.fill_between(steps, low, high, color=blue, alpha=0.14, linewidth=0, label="95% interval")
        top.plot(steps, rates, color=blue, linewidth=2, marker="o", markersize=5, label="right part")
        top.set_ylim(0, max(100 * max(p["right_part"]["ci95"][1] for p in pts) + 5, 20))
    # where it stops rising: the interval rule dashed, the paired rule dotted (when it is a step with a later point)
    marks = [("interval rule", curve["saturation"]["interval_rule"].get("step"), (0, (4, 3)), -12)]
    paired = curve["saturation"]["paired_rule"]
    if "note" not in paired:
        marks.append(("paired rule", paired.get("step"), (0, (1, 2)), -24))
    for name, step, style, dy in marks:
        if step is None:
            continue
        for ax in (top, bottom):
            ax.axvline(step, color=muted, linewidth=1, linestyle=style)
        top.annotate(f"stops rising, {name}: step {step}", xy=(step, top.get_ylim()[1]), xytext=(4, dy), textcoords="offset points", color=muted, fontsize=8.5)
    n = curve["subset"]["prompts"]
    top.set_ylabel(f"right part, % of {n} prompts", color=text, fontsize=10)
    top.set_title(f"{curve['run']} on {curve['subset']['name']}", color=text, fontsize=12, loc="left")
    if pts:
        top.legend(loc="lower right", frameon=False, fontsize=9, labelcolor=text)
    losses = [(p["step"], (p.get("train_loss") or {}).get("loss"), p.get("valid_loss")) for p in curve["points"]]
    tr = [(s, v) for s, v, _ in losses if v is not None]
    va = [(s, v) for s, _, v in losses if v is not None]
    if tr:
        bottom.plot(*zip(*tr), color=blue, linewidth=2, marker="o", markersize=4, label="train loss (mean since the last checkpoint)")
    if va:
        bottom.plot(*zip(*va), color=orange, linewidth=2, marker="s", markersize=4, label="validation loss (100 train rows)")
    bottom.set_ylabel("loss", color=text, fontsize=10)
    bottom.set_xlabel("step (one step = one update of 8 rows)", color=text, fontsize=10)
    if tr or va:
        bottom.legend(loc="upper right", frameon=False, fontsize=9, labelcolor=text)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor="#ffffff")
    plt.close(fig)
    return True


# The command.


def run_curve(
    run_dir: Path,
    subset_name: str = "dev-curve",
    *,
    make_engine: Callable[[Path | None, int], Engine] | None = None,
    max_tokens: int = 1024,
    batch: int = 1,
    include_base: bool = True,
    base_row_name: str | None = None,
    model: Path | None = None,
    results: Path = RESULTS,
    sets_dir: Path = SETS,
    hashes: Path = SETS_HASHES,
    subsets_dir: Path = SUBSETS,
    workers: int = 4,
    slider_ends: bool = True,
    max_checkpoints: int | None = None,
    even_if_running: bool = False,
    plot_only: bool = False,
    versions: dict | None = None,
    log: Callable[[str], None] = say,
) -> dict:
    """Scores every checkpoint of the run not yet scored on the subset (at most `max_checkpoints` of them now), then
    writes curve.json and the plot. `make_engine(adapter_folder or None, batch)` gives the engine for one point (the
    local model by default; the tests pass a fake)."""
    check_open(SPLIT)
    run_dir = Path(run_dir)
    if not run_dir.is_dir():
        raise CurveError(f"There is no training run folder {run_dir}.")
    subset = subsets.load(subset_name, subsets_dir)
    items, files = load_split(SPLIT, False, sets_dir, hashes)
    picked = subset.pick(items, SPLIT, files)
    ids = [i.id for i in picked]
    record = read_run(run_dir)
    run_name = run_dir.resolve().name
    status = record.get("status")
    if status == "running" and not even_if_running and not plot_only:
        raise CurveError(
            f"{run_dir}/run.json says the run is still training. Scoring now would put a second job on the GPU. Wait for it "
            "to finish, or pass --even-if-running if the trainer is no longer running (it was killed)."
        )
    model_dir = Path(model) if model else (REPO / record["model"]["path"] if (record.get("model") or {}).get("path") else LOCAL_MODEL)
    weights_sha = (record.get("model") or {}).get("weights_sha256")
    checkpoints = find_checkpoints(run_dir)
    train, val = read_losses(run_dir)
    if make_engine is None:
        make_engine = _local_engine_maker(model_dir, max_tokens)

    plan: list[dict] = []
    if include_base:
        plan.append({"step": 0, "checkpoint": None, "path": None})
    prev = 0
    for step, path in checkpoints:
        plan.append({"step": step, "checkpoint": path.name, "path": path, "after": prev})
        prev = step

    base_source = None
    if include_base:
        name = base_row_name or f"local-{model_dir.name}-0shot"
        if batch > 1:
            reason = "this curve is answered in batches, and that row one prompt at a time"
        else:
            want = {
                "weights_sha256": weights_sha,
                "max_tokens": max_tokens,
                "versions": versions if versions is not None else installed_versions(),
                "system_sha256": _system_sha(picked[:1]),
                "slider_ends": slider_ends,
            }
            reason = base_row_misfit(results, name, ids, files, want)
        if reason is None:
            base_source = name
            log(f"step 0: the untrained model's answers come from the row {name}")
        else:
            log(f"step 0: the row {name} cannot stand for it ({reason}), so the untrained model is scored as its own row")

    for p in plan:
        if p["step"] == 0:
            p["row"] = base_source or base_row(subset.name, model_dir.name, batch)
            p["source"] = f"row {base_source}" if base_source else "scored"
        else:
            p["row"] = checkpoint_row(subset.name, run_name, p["step"], batch)
            p["source"] = "scored"
            p["adapter_sha256"] = sha256_file(p["path"])
            config_path = row_dir(results, p["row"], SPLIT) / "run.json"
            if config_path.is_file():
                before = (json.loads(config_path.read_text()).get("engine") or {}).get("adapter_sha256")
                if before is not None and before != p["adapter_sha256"]:
                    raise RowMismatch(
                        f"Row {p['row']} was scored with another checkpoint at step {p['step']} (adapter sha256 {before}, now "
                        f"{p['adapter_sha256']}). A run trained again needs a new folder name."
                    )

    scored_now = 0
    for p in plan:
        if plot_only or (base_source and p["step"] == 0):
            continue
        sha = p.get("adapter_sha256")
        config_path = row_dir(results, p["row"], SPLIT) / "run.json"
        done = {r["id"] for r in _current(read_records(results, p["row"], SPLIT), files) if r.get("status") == "done"}
        if config_path.is_file() and all(i in done for i in ids):
            continue
        if max_checkpoints is not None and scored_now >= max_checkpoints:
            log(f"stopping: {scored_now} points scored now (--max-checkpoints); run the same command again to go on")
            break
        adapter = adapter_folder(run_dir, p["step"]) if p["path"] else None
        log(f"step {p['step']}: scoring {'the untrained model' if adapter is None else _shown(adapter)} on {subset.name} ({len(ids)} prompts) as row {p['row']}")
        engine = make_engine(adapter, batch)
        try:
            settings = engine.settings()
            if sha and settings.get("adapter_sha256") not in (None, sha):
                raise RowMismatch(f"The engine loaded an adapter with sha256 {settings.get('adapter_sha256')}, not the checkpoint's {sha}.")
            if weights_sha and settings.get("weights_sha256") not in (None, weights_sha):
                raise RowMismatch(f"The engine's model weights are not the run's base weights ({weights_sha}).")
            summary = run_row(engine, p["row"], SPLIT, subset=subset, results=results, sets_dir=sets_dir, hashes=hashes, workers=workers, slider_ends=slider_ends, log=log)
        finally:
            engine.close()
        scored_now += 1
        write_curve(run_dir, run_name, record, subset, picked, files, plan, train, val, results, batch, max_tokens, slider_ends, model_dir)
        if not summary["complete"]:
            # the row stopped part way (low disk, or answers that did not come): the later points wait for it
            log(f"stopping: step {p['step']} has {summary['done']} of {summary['prompts']} prompts scored; run the same command again to go on")
            break
    return write_curve(run_dir, run_name, record, subset, picked, files, plan, train, val, results, batch, max_tokens, slider_ends, model_dir)


def _system_sha(items: list[Item]) -> str:
    """The sha256 of the site's system prompt now, as a row would record it (worded by the site's code)."""
    with Gkod(workers=1) as gkod:
        messages = build(gkod, items)
    return next(iter(messages.values())).record()["system_sha256"]


def _local_engine_maker(model_dir: Path, max_tokens: int) -> Callable[[Path | None, int], Engine]:
    def make(adapter: Path | None, batch: int) -> Engine:
        from gkod_bench.engines.local import LocalEngine

        return LocalEngine(model_dir, adapter=adapter, max_tokens=max_tokens, temperature=0.0, seed=0, batch_size=batch)

    return make


def write_curve(
    run_dir: Path,
    run_name: str,
    record: dict,
    subset: subsets.Subset,
    picked: list[Item],
    files: dict,
    plan: list[dict],
    train: dict[int, dict],
    val: dict[int, float],
    results: Path,
    batch: int,
    max_tokens: int,
    slider_ends: bool,
    model_dir: Path,
) -> dict:
    ids = {i.id for i in picked}
    saved_ceiling = ceiling.load(results, SPLIT, files)
    effective = (record.get("plan") or {}).get("effective_batch")
    points, rights, commits = [], {}, set()
    for p in plan:
        records = [r for r in _current(read_records(results, p["row"], SPLIT), files) if r["id"] in ids]
        done = [r for r in records if r.get("status") == "done"]
        summary = summarize(records, expected_of(picked), {"row": p["row"], "split": SPLIT})
        point = {"step": p["step"], "checkpoint": p["checkpoint"], "row": p["row"], "source": p["source"]}
        if p.get("adapter_sha256"):
            point["adapter_sha256"] = p["adapter_sha256"]
        step_row = train.get(p["step"]) or {}
        point["rows_seen"] = 0 if p["step"] == 0 else step_row.get("rows_seen", p["step"] * effective if effective else None)
        point["train_loss"] = None if p["step"] == 0 else train_loss_between(train, p.get("after", 0), p["step"])
        point["valid_loss"] = val.get(p["step"])
        point.update(point_of(summary))
        points.append(point)
        rights[p["step"]] = {r["id"]: right_part(r["scores"])["ok"] for r in done}
        commits |= {c for c in (_scorer_commit(r) for r in done) if c}
    creates = [i.id for i in picked if i.task == "create"]
    got = ceiling.share(saved_ceiling, creates)
    curve = {
        "run": run_name,
        "run_dir": _shown(run_dir),
        "run_status": record.get("status"),
        "subset": {"name": subset.name, "prompts": len(picked), "files": files},
        "settings": {
            "model": model_dir.name,
            "decoding": "greedy",
            "max_tokens": max_tokens,
            "batch_size": batch,
            "generation": "one prompt at a time (stream_generate), as every scored row" if batch == 1 else f"batched (batch_generate, {batch} at once): may differ from one prompt at a time",
            "right_part_iou": RIGHT_PART_IOU,
            "slider_ends": slider_ends,
        },
        "checkpoints_in_run": [p["step"] for p in plan if p["checkpoint"]],
        "points": points,
        "guess_ceiling": {**rate(got["k"], got["n"]), "kept_a_true_value": got["kept_a_true_value"], "note": "create prompts of the subset only"} if got else {"note": "not worked out for dev yet: run gkod_bench summarize on any dev row"},
        "saturation": {"interval_rule": interval_saturation(points), "paired_rule": paired_saturation(points, rights)},
        "full_dev_candidates": full_dev_candidates(points, [p["step"] for p in plan if p["checkpoint"]], record.get("status")),
        "scorer_commits": sorted(commits),
        "made": datetime.now(UTC).isoformat(timespec="seconds"),
        "harness": harness_source(),
    }
    if len(commits) > 1:
        curve["scorer_note"] = "the points were scored by more than one harness commit: run gkod_bench rescore on the older rows before reading small differences"
    path = curve_path(results, run_name, subset.name, batch)
    png = path.with_suffix(".png")
    curve["plot"] = _shown(png) if plot(curve, png) else None
    write_json(path, curve)
    return curve


def same_answers(row_a: str, row_b: str, *, results: Path = RESULTS, split: str = SPLIT) -> dict:
    """How many of the prompts both rows answered got the very same answer text, and where the first few differ (to
    check batched answers against one-at-a-time answers)."""
    check_open(split)
    a = {r["id"]: r for r in read_records(results, row_a, split) if r.get("status") == "done"}
    b = {r["id"]: r for r in read_records(results, row_b, split) if r.get("status") == "done"}
    common = sorted(a.keys() & b.keys())
    differ = []
    for i in common:
        x, y = a[i]["answer"], b[i]["answer"]
        if x != y:
            at = next((k for k, (c, d) in enumerate(zip(x, y)) if c != d), min(len(x), len(y)))
            differ.append({"id": i, "first_difference_at_char": at, "length_a": len(x), "length_b": len(y), "right_part_a": right_part(a[i]["scores"])["ok"], "right_part_b": right_part(b[i]["scores"])["ok"]})
    return {"a": row_a, "b": row_b, "split": split, "both": len(common), "same": len(common) - len(differ), "differ": differ}


def headline(curve: dict) -> str:
    lines = [f"{curve['run']} on {curve['subset']['name']} ({curve['subset']['prompts']} prompts), {curve['settings']['generation']}"]
    for p in curve["points"]:
        if "right_part" not in p:
            lines.append(f"  step {p['step']:>6}: {p['done']} of {p['prompts']} scored")
            continue
        r = p["right_part"]
        tl = (p.get("train_loss") or {}).get("loss")
        vl = p.get("valid_loss")
        losses = f"  train loss {tl:.3f}" if tl is not None else ""
        losses += f"  valid loss {vl:.3f}" if vl is not None else ""
        part = "" if p["complete"] else f" ({p['done']} of {p['prompts']} scored)"
        lines.append(f"  step {p['step']:>6}: right part {r['k']:>2}/{r['n']} {r['rate']:.0%} [{r['ci95'][0]:.0%}, {r['ci95'][1]:.0%}], compiles {p['compiles']['rate']:.0%}{losses}{part}")
    sat = curve["saturation"]
    s1, s2 = sat["interval_rule"], sat["paired_rule"]
    lines.append(f"  stops rising, interval rule: {'step ' + str(s1['step']) if s1['step'] is not None else s1.get('note')}" + (f" (later rises above its interval at {s1['rises_later']})" if s1.get("rises_later") else ""))
    lines.append(f"  stops rising, paired rule: {'step ' + str(s2['step']) if s2.get('step') is not None else s2.get('note')}" + (f" ({s2['note']})" if s2.get("note") and s2.get("step") is not None else ""))
    fd = curve["full_dev_candidates"]
    lines.append(f"  to full dev (PICK_RULE.md): {fd['steps'] if fd.get('steps') else fd.get('note')}")
    if curve.get("plot"):
        lines.append(f"  plot: {curve['plot']}")
    return "\n".join(lines)
