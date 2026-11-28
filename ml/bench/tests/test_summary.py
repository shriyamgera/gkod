from gkod_bench.score import RIGHT_PART_IOU
from gkod_bench.summary import summarize


def record(id, tier, *, compiles=True, iou=1.0, holes=0, stated=True, old=False, sizes_ok=None):
    """A saved record with the measurements the summary reads. `old` writes it the way records were written before
    28 Nov: meets_request, and no stated_sizes_match or right_part."""
    task = "edit" if tier == "edit" else "create"
    facts = [{"key": "width", "how": "size", "status": "pass" if stated else "fail", "strict": {"status": "pass"}}]
    scores = {
        "extract": {"ok": True, "problem": None},
        "compiles": compiles,
        "compile": {"params": 3},
        "checks_pass": compiles,
        "checks": {"closed": True} if compiles else None,
        "mesh": {"shells": 1, "holes": holes} if compiles else None,
        "reference": {"mesh": {"shells": 1, "holes": 0}},
        "facts": facts,
        "iou": iou if compiles else 0.0,
        "iou_as_drawn": iou if compiles else 0.0,
        "slider_ends": {"all_ok": True, "ends": 6, "compiled": 6} if compiles else None,
    }
    loose = stated and compiles
    if old:
        scores.update(meets_request=loose, meets_request_strict=loose)
    else:
        scores.update(stated_sizes_match=loose, stated_sizes_match_strict=loose, meets_request=loose, meets_request_strict=loose)
    if task == "edit":
        scores["edit"] = {"sizes_ok": bool(sizes_ok), "same_as_a": False, "same_mesh_as_a": False}
    return {
        "id": id,
        "task": task,
        "tier": tier,
        "family": "plate",
        "status": "done",
        "scores": scores,
        "engine_meta": {},
        "timings": {"engine_s": 1.0},
        "at": "2026-11-28T10:00:00+00:00",
        "harness": {"commit": "abc"},
    }


CONFIG = {"row": "r", "split": "dev"}


def expected(records):
    return [{"id": r["id"], "tier": r["tier"], "family": r["family"]} for r in records]


def test_right_part_is_the_headline_and_says_what_failed():
    records = [
        record("a", "t1"),
        record("b", "t1", iou=0.95),
        record("c", "t1", holes=2, stated=False),
        record("d", "t2", compiles=False),
        record("e", "edit", sizes_ok=True),
        record("f", "edit", sizes_ok=False),
    ]
    s = summarize(records, expected(records), CONFIG)
    o = s["overall"]
    assert list(o)[:2] == ["prompts", "right_part"]
    assert o["right_part"]["k"] == 2 and o["right_part"]["n"] == 6 and o["right_part"]["iou_threshold"] == RIGHT_PART_IOU
    # every check an answer missed is counted; no part counts only as compiles
    assert o["right_part"]["failed"] == {"compiles": 1, "facts": 1, "shape": 1, "holes": 1, "sizes": 1}
    assert s["tiers"]["t1"]["right_part"]["k"] == 1 and s["tiers"]["edit"]["right_part"]["k"] == 1


def test_stated_sizes_match_replaces_meets_request():
    records = [record("a", "t1"), record("b", "t1", stated=False)]
    o = summarize(records, expected(records), CONFIG)["overall"]
    assert "meets_request" not in o and "meets_request_strict_axes" not in o
    assert o["stated_sizes_match"]["k"] == 1 and o["stated_sizes_match"]["n"] == 2
    assert o["stated_sizes_match_strict_axes"]["k"] == 1


def test_old_records_count_the_same():
    new = [record("a", "t1"), record("b", "t1", iou=0.5), record("c", "t3", stated=False), record("e", "edit", sizes_ok=True)]
    old = [record("a", "t1", old=True), record("b", "t1", iou=0.5, old=True), record("c", "t3", stated=False, old=True), record("e", "edit", sizes_ok=True, old=True)]
    assert "right_part" not in old[0]["scores"] and "stated_sizes_match" not in old[0]["scores"]
    a = summarize(new, expected(new), CONFIG)["overall"]
    b = summarize(old, expected(old), CONFIG)["overall"]
    for key in ("right_part", "stated_sizes_match", "stated_sizes_match_strict_axes", "compiles", "iou"):
        assert a[key] == b[key], key


def test_the_guess_ceiling_sits_next_to_right_part_for_creates():
    records = [record("a", "t1"), record("b", "t1", iou=0.9), record("c", "t3"), record("e", "edit", sizes_ok=True)]
    saved = {"prompts": {"a": {"iou": 1.0, "kept": []}, "b": {"iou": 0.95, "kept": []}, "c": {"iou": 0.999, "kept": ["slot_depth"]}}}
    s = summarize(records, expected(records), CONFIG, saved)
    c = s["overall"]["guess_ceiling"]
    # create prompts only: a and c reach the threshold, b's guess does not
    assert (c["k"], c["n"]) == (2, 3) and c["iou_threshold"] == RIGHT_PART_IOU and c["kept_a_true_value"] == 1
    assert (c["right_part_on_these"]["k"], c["right_part_on_these"]["n"]) == (2, 3)
    assert (s["tiers"]["t1"]["guess_ceiling"]["k"], s["tiers"]["t1"]["guess_ceiling"]["n"]) == (1, 2)
    assert s["t3_families"]["plate"]["guess_ceiling"]["k"] == 1
    # edits state their change and keep code A's other sizes: no ceiling
    assert "guess_ceiling" not in s["tiers"]["edit"]


def test_a_split_without_a_saved_ceiling_says_so():
    records = [record("a", "t1")]
    c = summarize(records, expected(records), CONFIG)["overall"]["guess_ceiling"]
    assert "rate" not in c and "summarize" in c["note"]
