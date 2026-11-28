import json

import pytest
from fake_set import ScriptedEngine, echo_reference, make_hashes, make_set

from gkod_bench.data import SplitClosed
from gkod_bench.engines.base import Answer
from gkod_bench.paths import REPO
from gkod_bench.run import RowMismatch, raw_dir, read_records, rescore_row, row_dir, run_row, summarize_row

pytestmark = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)


@pytest.fixture
def fake(tmp_path):
    sets = tmp_path / "sets"
    hashes = make_set(sets)
    return {"sets_dir": sets, "hashes": hashes, "results": tmp_path / "results", "log": lambda line: None}


def test_a_row_writes_one_record_per_prompt_and_a_summary(fake):
    engine = ScriptedEngine(echo_reference)
    summary = run_row(engine, "ref", "dev", **fake)
    assert summary["complete"] and summary["done"] == 4 and summary["missing"] == 0
    o = summary["overall"]
    assert o["compiles"]["rate"] == 1.0 and o["checks_pass"]["rate"] == 1.0 and o["stated_sizes_match"]["rate"] == 1.0
    assert o["right_part"]["rate"] == 1.0 and o["right_part"]["failed"] == {}
    # a run only reads a saved ceiling; summarize works it out
    assert "rate" not in o["guess_ceiling"]
    assert o["iou"]["mean"] == pytest.approx(1.0)
    assert set(summary["tiers"]) == {"t1", "t2", "t3", "edit"}
    assert summary["tiers"]["edit"]["edit_sizes_ok"]["rate"] == 1.0
    assert summary["t3_families"].keys() == {"coaster"}
    assert summary["tiers"]["t1"]["compiles"]["ci95"][1] == 1.0
    records = read_records(fake["results"], "ref", "dev")
    assert {r["id"] for r in records} == {"d-1", "d-2", "d-3", "de-1"}
    r = next(r for r in records if r["id"] == "d-2")
    assert r["status"] == "done" and r["code"].startswith("// Plate") and r["answer"].startswith("```openscad")
    assert r["prompt"]["user"].startswith("Make this part: A plate 70 mm wide") and r["prompt"]["shots"] == []
    assert r["scores"]["facts_passed"] == 3 and r["timings"]["score_s"] > 0
    assert (row_dir(fake["results"], "ref", "dev") / "summary.json").exists()
    config = json.loads((row_dir(fake["results"], "ref", "dev") / "run.json").read_text())
    assert config["engine"] == {"engine": "scripted", "temperature": 0} and config["shots"] is None


def test_a_row_resumes_where_it_stopped(fake):
    first = ScriptedEngine(echo_reference)
    summary = run_row(first, "staged", "dev", limit=2, **fake)
    assert len(first.calls) == 2 and summary["done"] == 2 and not summary["complete"]
    assert "2 of 4 prompts have no scored answer" in summary["note"]
    second = ScriptedEngine(echo_reference)
    summary = run_row(second, "staged", "dev", **fake)
    assert len(second.calls) == 2 and summary["complete"]
    asked = {m.user for m in first.calls} | {m.user for m in second.calls}
    assert len(asked) == 4
    # nothing left: a third run asks nothing
    third = ScriptedEngine(echo_reference)
    run_row(third, "staged", "dev", **fake)
    assert third.calls == []


def test_prompts_with_no_answer_are_kept_as_errors_and_tried_again(fake):
    broken = ScriptedEngine(lambda m: Answer)
    summary = run_row(broken, "flaky", "dev", max_errors=3, **fake)
    # it stops after three in a row, and none of them counts as done
    assert len(broken.calls) == 3 and summary["done"] == 0 and summary["engine_errors"] == 3 and summary["overall"] is None
    statuses = {r["status"] for r in read_records(fake["results"], "flaky", "dev")}
    assert statuses == {"error"}
    fixed = ScriptedEngine(echo_reference)
    summary = run_row(fixed, "flaky", "dev", **fake)
    assert len(fixed.calls) == 4 and summary["complete"] and summary["engine_errors"] == 0


def test_a_prompt_the_engine_turns_down_counts_as_no_code(fake):
    turned_down = Answer(text="", seconds=0.01, error="turned down: blocked", meta={"failure": "turned-down"})
    script = lambda m: turned_down if "70 mm wide" in m.user else echo_reference(m)  # noqa: E731
    first = ScriptedEngine(script)
    summary = run_row(first, "picky", "dev", **fake)
    # scored, not missing: it is in every rate, and it is not asked again
    assert summary["complete"] and summary["done"] == 4 and summary["engine_errors"] == 0 and summary["engine_failures_scored"] == 1
    assert summary["overall"]["compiles"]["k"] == 3 and summary["overall"]["compiles"]["n"] == 4
    assert summary["overall"]["engine_failures"] == {"turned-down": 1}
    again = ScriptedEngine(script)
    run_row(again, "picky", "dev", **fake)
    assert again.calls == []


def test_a_run_stops_when_prompts_keep_being_turned_down(fake):
    turned_down = Answer(text="", seconds=0.01, error="turned down: blocked", meta={"failure": "turned-down"})
    engine = ScriptedEngine(lambda m: turned_down)
    summary = run_row(engine, "setup", "dev", max_errors=2, **fake)
    assert len(engine.calls) == 2 and summary["done"] == 2 and not summary["complete"]


def test_a_resumed_row_must_keep_its_settings(fake):
    run_row(ScriptedEngine(echo_reference), "fixed", "dev", limit=1, **fake)
    changed = ScriptedEngine(echo_reference, settings={"engine": "scripted", "temperature": 0.7})
    with pytest.raises(RowMismatch, match="engine"):
        run_row(changed, "fixed", "dev", **fake)
    # a new day is fine
    later = ScriptedEngine(echo_reference, settings={"engine": "scripted", "temperature": 0, "date": "2026-12-01"})
    run_row(later, "fixed", "dev", limit=1, **fake)


def test_a_resumed_row_must_keep_its_set_files_and_scoring(fake, tmp_path):
    run_row(ScriptedEngine(echo_reference), "frozen", "dev", limit=2, **fake)
    record = read_records(fake["results"], "frozen", "dev")[0]
    assert record["data_sha256"] == json.loads((row_dir(fake["results"], "frozen", "dev") / "run.json").read_text())["data"]["files"][f"dev/{record['task']}.jsonl"]
    # the scoring settings may not change between stages
    with pytest.raises(RowMismatch, match="scoring"):
        run_row(ScriptedEngine(echo_reference), "frozen", "dev", slider_ends=False, **fake)
    # the set is made again with other sizes under the same ids: nothing may mix with the old answers
    path = fake["sets_dir"] / "dev" / "create.jsonl"
    path.write_text(path.read_text().replace('"value": 70', '"value": 77'))
    hashes = make_hashes(fake["sets_dir"])
    changed = {**fake, "hashes": hashes}
    engine = ScriptedEngine(echo_reference)
    with pytest.raises(RowMismatch, match="data"):
        run_row(engine, "frozen", "dev", **changed)
    assert engine.calls == []
    with pytest.raises(RowMismatch, match="set's files changed"):
        summarize_row("frozen", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=hashes)
    with pytest.raises(RowMismatch, match="set's files changed"):
        rescore_row("frozen", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=hashes, log=lambda line: None)


def test_few_shot_rows_put_the_fixed_train_examples_first(fake):
    engine = ScriptedEngine(echo_reference)
    run_row(engine, "three", "dev", shots=3, **fake)
    create = next(m for m in engine.calls if m.user.startswith("Make this part:"))
    assert create.shots == ("tr-spacer", "tr-plate", "tr-bracket")
    assert [t["role"] for t in create.turns] == ["user", "assistant"] * 3 + ["user"]
    assert create.turns[1]["content"].startswith("```openscad\n// Plate")
    edit = next(m for m in engine.calls if m.user.startswith("Here is the current"))
    assert edit.shots == ("tre-size", "tre-add", "tre-remove")
    config = json.loads((row_dir(fake["results"], "three", "dev") / "run.json").read_text())
    assert config["shots"]["create"]["ids"] == ["tr-spacer", "tr-plate", "tr-bracket"]


def test_summarize_again_from_the_records(fake):
    run_row(ScriptedEngine(echo_reference), "again", "dev", **fake)
    (raw_dir(fake["results"], "again", "dev") / "d-1.json").unlink()
    summary = summarize_row("again", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    assert summary["done"] == 3 and summary["missing"] == 1


def test_summarize_works_out_the_guess_ceiling_and_later_runs_read_it(fake):
    run_row(ScriptedEngine(echo_reference), "ceil", "dev", **fake)
    summary = summarize_row("ceil", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    c = summary["overall"]["guess_ceiling"]
    # the 3 create prompts; their unstated thickness is train's median, so every guess is the reference
    assert (c["k"], c["n"]) == (3, 3) and (c["right_part_on_these"]["k"], c["right_part_on_these"]["n"]) == (3, 3)
    assert summary["tiers"]["t2"]["guess_ceiling"]["n"] == 1 and "guess_ceiling" not in summary["tiers"]["edit"]
    assert (fake["results"] / "ceiling" / "dev.json").exists()
    later = run_row(ScriptedEngine(echo_reference), "later", "dev", **fake)
    assert later["overall"]["guess_ceiling"]["n"] == 3


def test_old_records_still_summarize_and_rescore(fake):
    """Records written before 28 Nov have meets_request and no stated_sizes_match or right_part."""
    run_row(ScriptedEngine(echo_reference), "old", "dev", **fake)
    folder = raw_dir(fake["results"], "old", "dev")
    for path in folder.glob("*.json"):
        record = json.loads(path.read_text())
        for key in ("stated_sizes_match", "stated_sizes_match_strict", "right_part", "right_part_failed"):
            record["scores"].pop(key)
        path.write_text(json.dumps(record))
    summary = summarize_row("old", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    o = summary["overall"]
    assert o["right_part"]["k"] == 4 and o["stated_sizes_match"]["k"] == 4
    # rescoring writes the new keys from the saved answers, without the engine
    rescore_row("old", "dev", results=fake["results"], sets_dir=fake["sets_dir"], hashes=fake["hashes"], log=lambda line: None)
    for record in read_records(fake["results"], "old", "dev"):
        assert record["scores"]["right_part"] is True and record["scores"]["stated_sizes_match"] is True and "rescored" in record


def test_the_test_split_is_refused_before_anything_runs(fake):
    engine = ScriptedEngine(echo_reference)
    with pytest.raises(SplitClosed):
        run_row(engine, "peek", "test", **fake)
    with pytest.raises(SplitClosed):
        summarize_row("peek", "test", results=fake["results"])
    assert engine.calls == [] and not fake["results"].exists()
