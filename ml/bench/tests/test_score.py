import numpy as np
import pytest
from shapes import box, plate_with_holes

from gkod_bench.gkod import Gkod
from gkod_bench.mesh import measure
from gkod_bench.paths import REPO
from gkod_bench.score import check_facts, meets_request, meets_request_strict, orient, plan_facts, score_answer, size_block

needs_compiler = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)


def fact(key, value, unit="mm", axis=None):
    f = {"key": key, "value": value, "unit": unit}
    if axis:
        f["axis"] = axis
    return f


def by_key(results):
    return {r["key"]: r for r in results}


# ---- facts, on hand-made meshes ----


def test_overall_sizes_within_half_a_millimetre():
    facts = [fact("width", 10, axis="x"), fact("depth", 20, axis="y"), fact("height", 5, axis="z"), fact("wall", 2)]
    planned = plan_facts(facts, measure(box(10, 20, 5)))
    got = by_key(check_facts(planned, measure(box(10.4, 20.6, 5))))
    assert got["width"]["status"] == "pass"
    assert got["depth"]["status"] == "fail" and got["depth"]["got"] == [20.6]
    assert got["height"]["status"] == "pass"
    assert got["wall"]["status"] == "unmeasured"


def test_overall_sizes_fit_whichever_way_the_part_lies():
    # a hook drawn on its side: width on z, reach on x, back plate on y; the answer stands it up
    facts = [fact("width", 27, axis="z"), fact("reach", 42, axis="x"), fact("back_height", 107, axis="y")]
    planned = plan_facts(facts, measure(box(42, 107, 27)))
    assert orient(planned, (42.0, 27.0, 107.0)) == (0, 2, 1)
    results = check_facts(planned, measure(box(42, 27, 107)))
    got = by_key(results)
    assert all(r["status"] == "pass" for r in results)
    assert got["width"]["answer_axis"] == "y" and got["back_height"]["answer_axis"] == "z" and got["reach"]["answer_axis"] == "x"
    # the strict column keeps the axes the reference part is drawn with
    assert got["width"]["strict"] == {"got": [107.0], "status": "fail"} and got["reach"]["strict"]["status"] == "pass"
    assert meets_request(True, results) is True and meets_request_strict(True, results) is False
    # lying as drawn, both agree
    as_drawn = check_facts(planned, measure(box(42, 107, 27)))
    assert meets_request(True, as_drawn) is True and meets_request_strict(True, as_drawn) is True


def test_one_order_of_the_sides_serves_every_size_of_a_prompt():
    # each size alone fits some side, but no one order fits all three: the box has one 10 mm side, not two
    planned = plan_facts([fact("width", 10, axis="x"), fact("depth", 10, axis="y"), fact("height", 5, axis="z")], measure(box(10, 10, 5)))
    assert sorted(r["status"] for r in check_facts(planned, measure(box(10, 5, 5)))) == ["fail", "pass", "pass"]
    # a diameter turned onto its side is read on the two sides of one order
    planned = plan_facts([fact("diameter", 30, axis="xy"), fact("height", 10, axis="z")], measure(box(30, 30, 10)))
    results = check_facts(planned, measure(box(30, 10, 30)))
    assert [r["status"] for r in results] == ["pass", "pass"] and by_key(results)["diameter"]["answer_axis"] == "xz"


def test_a_diameter_is_checked_on_x_and_y():
    planned = plan_facts([fact("diameter", 30, axis="xy")], measure(box(30, 30, 5)))
    assert check_facts(planned, measure(box(30, 30, 2)))[0]["status"] == "pass"
    assert check_facts(planned, measure(box(30, 31, 2)))[0]["status"] == "fail"


def test_hole_count_from_genus_when_the_reference_agrees():
    reference = measure(plate_with_holes(2))
    planned = plan_facts([fact("hole_count", 2, "count"), fact("hole_d", 4)], reference)
    good = by_key(check_facts(planned, measure(plate_with_holes(2))))
    assert good["hole_count"]["status"] == "pass" and good["hole_count"]["got_genus"] == 2
    assert good["hole_d"]["status"] == "unmeasured"
    bad = by_key(check_facts(planned, measure(plate_with_holes(3))))
    assert bad["hole_count"]["status"] == "fail"


def test_hole_counts_add_up_across_keys_and_slots_join_when_needed():
    reference = measure(plate_with_holes(4))
    facts = [fact("arm1_hole_count", 2, "count"), fact("arm2_hole_count", 2, "count")]
    assert all(p["how"] == "holes" for p in plan_facts(facts, reference))
    # holes alone do not explain the genus, holes and slots do
    facts = [fact("hole_count", 1, "count"), fact("slot_count", 3, "count")]
    assert [p["how"] for p in plan_facts(facts, reference)] == ["holes", "holes"]
    # holes explain it; the open slots of a comb are not tunnels and stay unmeasured
    facts = [fact("hole_count", 4, "count"), fact("slot_count", 8, "count")]
    planned = by_key(plan_facts(facts, reference))
    assert planned["hole_count"]["how"] == "holes"
    assert planned["slot_count"]["how"] is None and "not the stated total" in planned["slot_count"]["reason"]


def test_hole_count_unmeasured_when_the_genus_cannot_count_it():
    # blind holes or a bore: the reference genus is not the stated count
    planned = plan_facts([fact("hole_count", 3, "count")], measure(plate_with_holes(1)))
    assert planned[0]["how"] is None and "not the stated total" in planned[0]["reason"]
    # an answer in two pieces has no genus
    planned = plan_facts([fact("hole_count", 1, "count")], measure(plate_with_holes(1)))
    two = measure(np.concatenate([plate_with_holes(1), box(1, 1, 1, offset=(50, 0, 0))]))
    result = check_facts(planned, two)[0]
    assert result["status"] == "unmeasured" and "not one closed body" in result["reason"]


def test_no_mesh_fails_every_measurable_fact():
    planned = plan_facts([fact("width", 10, axis="x"), fact("wall", 2)], measure(box(10, 10, 10)))
    got = by_key(check_facts(planned, None))
    assert got["width"]["status"] == "fail" and got["wall"]["status"] == "unmeasured"


def test_meets_request():
    passed = [{"status": "pass"}, {"status": "unmeasured"}]
    assert meets_request(True, passed) is True
    assert meets_request(True, [{"status": "pass"}, {"status": "fail"}]) is False
    assert meets_request(True, [{"status": "unmeasured"}]) is None
    assert meets_request(False, passed) is False


# ---- edits: the size block against code B ----

EDIT_ROW = {
    "facts": {
        "changed": [{"name": "width", "from": 80, "to": 90}],
        "kept": [{"name": "depth", "value": 40}, {"name": "hole_d", "value": 4}],
        "removed": [{"name": "rib_count"}],
        "added": [],
    }
}
B_PARAMS = [
    {"name": "width", "value": 90, "caption": "Plate width (mm)"},
    {"name": "depth", "value": 40, "caption": "Plate depth (mm)"},
    {"name": "hole_d", "value": 4, "caption": "Hole diameter (mm)"},
]


def test_size_block_right():
    block = size_block([dict(p) for p in B_PARAMS], EDIT_ROW, B_PARAMS)
    assert block["sizes_ok"] and block["kept"] == {"n": 2, "ok": 2} and block["removed"] == {"n": 1, "ok": 1}


def test_size_block_wrong_in_each_way():
    params = [dict(p) for p in B_PARAMS]
    params[0]["value"] = 85  # wrong new value
    params[1]["caption"] = "Depth"  # caption changed
    params.append({"name": "rib_count", "value": 3})  # not removed
    block = size_block(params, EDIT_ROW, B_PARAMS)
    assert not block["sizes_ok"]
    assert block["changed"]["ok"] == 0 and block["kept"]["ok"] == 1 and block["removed"]["ok"] == 0
    assert {w["name"] for w in block["wrong"]} == {"width", "depth", "rib_count"}
    # a missing kept size is wrong too
    assert not size_block([p for p in B_PARAMS if p["name"] != "hole_d"], EDIT_ROW, B_PARAMS)["sizes_ok"]


# ---- the whole scorer, with the real compiler ----

PLATE = """// Plate
// Plate width (mm)
width = 60; // [40:1:80]
// Plate depth (mm)
depth = 30; // [20:1:40]
// Plate thickness (mm)
thickness = 4; // [2:0.5:6]
// Hole diameter (mm)
hole_d = 5; // [3:0.5:8]

/* [Hidden] */
$fn = 32;

difference() {
  cube([width, depth, thickness]);
  for (x = [15, width - 15]) translate([x, depth / 2, -1]) cylinder(d = hole_d, h = thickness + 2);
}
"""

CREATE_ROW = {
    "id": "hand-1",
    "code": PLATE,
    "labels": {"stl_sha256": None},
    "facts": [
        fact("width", 60, axis="x"),
        fact("depth", 30, axis="y"),
        fact("thickness", 4, axis="z"),
        fact("hole_count", 2, "count"),
        fact("hole_d", 5),
    ],
}


@pytest.fixture(scope="module")
def gkod():
    with Gkod(workers=4) as g:
        yield g


@needs_compiler
def test_the_reference_itself_scores_full_marks(gkod):
    s = score_answer(gkod, CREATE_ROW, "create", f"Here it is:\n```openscad\n{PLATE}```\n")
    assert s["extract"]["ok"] and s["compiles"] and s["checks_pass"]
    assert s["checks"] == {"closed": True, "fits-bed": True, "flat-base": True, "overhang": True}
    assert s["mesh"]["genus"] == 2 and s["reference"]["mesh"]["genus"] == 2
    assert s["facts_measured"] == 4 and s["facts_passed"] == 4 and s["facts_unmeasured"] == 1
    assert s["meets_request"] is True and s["meets_request_strict"] is True and s["size_orientation"] == "xyz"
    assert s["iou"] == pytest.approx(1.0) and s["iou_as_drawn"] == pytest.approx(1.0)
    assert s["slider_ends"] == {"sizes": 4, "skipped_sizes": 0, "ends": 8, "compiled": 8, "all_ok": True, "failed": []}


@needs_compiler
def test_a_wrong_answer_loses_the_right_scores(gkod):
    wrong = PLATE.replace("width = 60;", "width = 70;").replace("for (x = [15, width - 15])", "for (x = [15])")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{wrong}```")
    assert s["compiles"] and s["checks_pass"]
    got = by_key(s["facts"])
    assert got["width"]["status"] == "fail" and got["depth"]["status"] == "pass"
    assert got["hole_count"]["status"] == "fail" and got["hole_count"]["got_genus"] == 1
    assert s["meets_request"] is False
    assert 0.6 < s["iou"] < 0.95


@needs_compiler
def test_a_right_part_standing_up_is_not_marked_down(gkod):
    # the plate stood on its long edge: every stated size is there, on other axes
    upright = PLATE.replace("difference() {", "rotate([90, 0, 0]) difference() {")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{upright}```", slider_ends=False)
    assert s["compiles"] and s["mesh"]["size"] == pytest.approx([60, 4, 30])
    assert s["meets_request"] is True and s["meets_request_strict"] is False and s["size_orientation"] == "xzy"
    assert s["iou"] == pytest.approx(1.0) and s["iou_as_drawn"] < 0.5
    assert s["iou_detail"]["turn"] == ["+x", "+z", "-y"]


@needs_compiler
def test_no_code_and_broken_code(gkod):
    s = score_answer(gkod, CREATE_ROW, "create", "Sorry, I cannot help with that.")
    assert s["extract"] == {"ok": False, "problem": "no-code"}
    assert not s["compiles"] and not s["checks_pass"] and s["meets_request"] is False and s["iou"] == 0.0
    assert s["slider_ends"] is None
    s = score_answer(gkod, CREATE_ROW, "create", "```openscad\ncube([10, 10, 10]);\nsphere(r = nope);\n```")
    assert s["extract"]["ok"] and not s["compiles"] and s["compile"]["error"]
    s = score_answer(gkod, CREATE_ROW, "create", None)
    assert s["extract"]["problem"] == "no-answer" and not s["compiles"]


@needs_compiler
def test_a_slider_end_that_breaks_the_part(gkod):
    # at its smallest the plate is narrower than the hole spacing needs, so the holes leave the part (it still
    # compiles); at the largest hole size, a wall made from the hole size goes to zero and the compile fails
    code = PLATE.replace("hole_d = 5; // [3:0.5:8]", "hole_d = 5; // [3:0.5:10]").replace(
        "difference() {", "assert(hole_d < 10, \"hole too big\");\ndifference() {"
    )
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{code}```")
    assert s["compiles"]
    ends = s["slider_ends"]
    assert ends["ends"] == 8 and ends["compiled"] == 7 and not ends["all_ok"]
    assert ends["failed"][0]["name"] == "hole_d" and ends["failed"][0]["end"] == "max"


@needs_compiler
def test_an_edit_answer_against_code_b(gkod):
    b = PLATE.replace("width = 60; // [40:1:80]", "width = 70; // [40:1:80]")
    row = {
        "id": "hand-edit-1",
        "a": {"code": PLATE},
        "b": {"code": b},
        "labels": {"stl_sha256": None},
        "facts": {
            "stated": [fact("width", 70, axis="x")],
            "changed": [{"name": "width", "from": 60, "to": 70}],
            "kept": [{"name": "depth", "value": 30}, {"name": "thickness", "value": 4}, {"name": "hole_d", "value": 5}],
            "removed": [],
            "added": [],
        },
    }
    s = score_answer(gkod, row, "edit", f"```openscad\n{b}```", slider_ends=False)
    assert s["edit"]["sizes_ok"] and not s["edit"]["same_as_a"]
    assert s["meets_request"] is True and s["iou"] == pytest.approx(1.0)
    assert s["slider_ends"] is None
    # sending code A back unchanged: the width is wrong
    s = score_answer(gkod, row, "edit", f"```openscad\n{PLATE}```", slider_ends=False)
    assert s["edit"]["same_as_a"] and not s["edit"]["sizes_ok"] and s["meets_request"] is False
    # changing a kept size as well
    s = score_answer(gkod, row, "edit", f"```openscad\n{b.replace('depth = 30;', 'depth = 32;')}```", slider_ends=False)
    assert not s["edit"]["sizes_ok"] and s["edit"]["size_block"]["kept"] == {"n": 3, "ok": 2}


@needs_compiler
def test_an_answer_that_hits_the_time_limit_once_is_compiled_again(gkod, monkeypatch):
    from gkod_bench.gkod import TIMEOUT_MESSAGE

    real = gkod.compile
    seen = []

    def stalled_once(code, defines=None, stl=None, check=True):
        if check and not seen:
            seen.append(code)
            return {"ok": False, "error": TIMEOUT_MESSAGE, "ms": 10000.0}
        return real(code, defines, stl, check)

    monkeypatch.setattr(gkod, "compile", stalled_once)
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{PLATE}```", slider_ends=False)
    assert s["compiles"] and s["compile"]["first_try"] == {"error": TIMEOUT_MESSAGE, "ms": 10000.0}
