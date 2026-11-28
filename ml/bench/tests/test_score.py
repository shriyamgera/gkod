import json
from pathlib import Path

import numpy as np
import pytest
from shapes import box, hollow_cube, plate_with_holes

from gkod_bench import score
from gkod_bench.gkod import Gkod
from gkod_bench.mesh import measure
from gkod_bench.paths import REPO
from gkod_bench.score import (
    RIGHT_PART_IOU,
    check_facts,
    meets_request,
    orient,
    plan_facts,
    right_part,
    score_answer,
    size_block,
    stated_of,
    stated_sizes_match,
    stated_sizes_match_strict,
    stated_strict_of,
)

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


def test_stated_sizes_of_a_create_are_read_from_the_named_sizes():
    facts = [fact("width", 60, axis="x"), fact("hole_d", 3.5), fact("floor_thickness", 1.8), fact("lip_width", 2), fact("rounded_corners", 1, "flag")]
    ref_params = [{"name": "width", "value": 60}, {"name": "hole_d", "value": 3.5}, {"name": "floor_thickness", "value": 1.8}]
    planned = by_key(plan_facts(facts, measure(box(60, 30, 4)), ref_params))
    assert planned["width"]["how"] == "size" and planned["hole_d"]["how"] == "code" and planned["floor_thickness"]["how"] == "code"
    # a stated size the reference has no named size for, and a flag, stay unmeasured; without the reference's sizes
    # (an edit) nothing is read from code
    assert planned["lip_width"]["how"] is None and planned["rounded_corners"]["how"] is None
    assert all(p["how"] != "code" for p in plan_facts(facts, measure(box(60, 30, 4))))

    def read(params):
        return by_key(check_facts(list(planned.values()), measure(box(60, 30, 4)), params))

    got = read([{"name": "width", "value": 60}, {"name": "hole_d", "value": 3.5}, {"name": "floor_thickness", "value": 1.82}])
    assert got["hole_d"]["status"] == "pass" and got["floor_thickness"]["status"] == "pass"
    # the size of the same name decides, even when another size happens to have the value
    got = read([{"name": "hole_d", "value": 2.8}, {"name": "slot", "value": 3.5}, {"name": "floor_thickness", "value": 1.4}])
    assert got["hole_d"]["status"] == "fail" and got["hole_d"]["got"] == 2.8
    assert got["floor_thickness"]["status"] == "fail"
    # other names: matched by value, and a diameter by a radius of half the value
    got = read([{"name": "screw_d", "value": 3.5}, {"name": "base_t", "value": 1.8}])
    assert got["hole_d"] == {**got["hole_d"], "status": "pass", "matched": "screw_d"} and got["floor_thickness"]["matched"] == "base_t"
    got = read([{"name": "hole_r", "value": 1.75}, {"name": "floor", "value": 1.8}])
    assert got["hole_d"]["status"] == "pass" and got["hole_d"]["as_radius"] is True
    # a radius does not stand for a size that is not a diameter
    assert read([{"name": "floor_r", "value": 0.9}])["floor_thickness"]["status"] == "fail"
    # sizes written as plain numbers in the code are not named sizes, so they cannot be read
    got = read([])
    assert got["hole_d"]["status"] == "fail" and got["hole_d"]["reason"] == "the answer has no named sizes"
    # no part: every measurable fact fails
    assert by_key(check_facts(list(planned.values()), None))["hole_d"]["status"] == "fail"


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
    assert stated_sizes_match(True, results) is True and stated_sizes_match_strict(True, results) is False
    # lying as drawn, both agree
    as_drawn = check_facts(planned, measure(box(42, 107, 27)))
    assert stated_sizes_match(True, as_drawn) is True and stated_sizes_match_strict(True, as_drawn) is True


def test_one_order_of_the_sides_serves_every_size_of_a_prompt():
    # each size alone fits some side, but no one order fits all three: the box has one 10 mm side, not two
    planned = plan_facts([fact("width", 10, axis="x"), fact("depth", 10, axis="y"), fact("height", 5, axis="z")], measure(box(10, 10, 5)))
    assert sorted(r["status"] for r in check_facts(planned, measure(box(10, 5, 5)))) == ["fail", "pass", "pass"]
    # a diameter turned onto its side is read on the two sides of one order
    planned = plan_facts([fact("diameter", 30, axis="xy"), fact("height", 10, axis="z")], measure(box(30, 30, 10)))
    results = check_facts(planned, measure(box(30, 10, 30)))
    assert [r["status"] for r in results] == ["pass", "pass"] and by_key(results)["diameter"]["answer_axis"] == "xz"


def test_half_a_millimetre_either_way_whatever_the_float_rounding():
    planned = plan_facts([fact("thickness", 2.2, axis="z")], measure(box(10, 10, 2.2)))
    # the STL's 32-bit corners: 2.7 is read back as 2.70000005 and 1.7 as 1.70000005
    for z, status in ((np.float32(2.7), "pass"), (np.float32(1.7), "pass"), (2.75, "fail"), (1.65, "fail")):
        assert check_facts(planned, measure(box(10, 10, float(z))))[0]["status"] == status, z


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
    planned = plan_facts(facts, reference)
    # the genus measures only the sum, so the sum is the one fact measured
    assert [p["how"] for p in planned] == [None, None, "holes"]
    assert "only the total of arm1_hole_count and arm2_hole_count" in planned[0]["reason"]
    assert {k: planned[2][k] for k in ("key", "value", "of")} == {"key": "holes_total", "value": 4, "of": ["arm1_hole_count", "arm2_hole_count"]}
    # four holes all in one arm: the total passes once, and neither arm passes on its own
    results = check_facts(planned, measure(plate_with_holes(4)))
    assert [r["status"] for r in results] == ["unmeasured", "unmeasured", "pass"]
    assert check_facts(planned, measure(plate_with_holes(3)))[2]["status"] == "fail"
    # holes alone do not explain the genus, holes and slots do
    facts = [fact("hole_count", 1, "count"), fact("slot_count", 3, "count")]
    assert [p["how"] for p in plan_facts(facts, reference)] == [None, None, "holes"]
    # holes explain it; the open slots of a comb are not tunnels and stay unmeasured
    facts = [fact("hole_count", 4, "count"), fact("slot_count", 8, "count")]
    planned = by_key(plan_facts(facts, reference))
    assert planned["hole_count"]["how"] == "holes"
    assert planned["slot_count"]["how"] is None and "not the stated total" in planned["slot_count"]["reason"]


def test_hole_count_unmeasured_when_the_genus_cannot_count_it():
    # blind holes or a bore: the reference genus is not the stated count
    planned = plan_facts([fact("hole_count", 3, "count")], measure(plate_with_holes(1)))
    assert planned[0]["how"] is None and "not the stated total" in planned[0]["reason"]


def test_extra_pieces_hollows_and_open_surfaces_cannot_hide_holes():
    planned = plan_facts([fact("hole_count", 2, "count")], measure(plate_with_holes(2)))
    # the holes of every piece are added up; a hidden hollow adds none
    two = measure(np.concatenate([plate_with_holes(2), box(1, 1, 1, offset=(50, 0, 0))]))
    assert check_facts(planned, two)[0]["status"] == "pass" and check_facts(planned, two)[0]["got_genus"] == 2
    hollow = check_facts(planned, measure(hollow_cube()))[0]
    assert hollow["status"] == "fail" and hollow["got_genus"] == 0
    # a surface that is not closed fails: the reference showed the holes can be counted, and a part must be closed
    open_part = check_facts(planned, measure(plate_with_holes(2)[:-1]))[0]
    assert open_part["status"] == "fail" and "not closed" in open_part["reason"]


def test_no_mesh_fails_every_measurable_fact():
    planned = plan_facts([fact("width", 10, axis="x"), fact("wall", 2)], measure(box(10, 10, 10)))
    got = by_key(check_facts(planned, None))
    assert got["width"]["status"] == "fail" and got["wall"]["status"] == "unmeasured"


def test_stated_sizes_match():
    passed = [{"status": "pass"}, {"status": "unmeasured"}]
    assert stated_sizes_match(True, passed) is True
    assert stated_sizes_match(True, [{"status": "pass"}, {"status": "fail"}]) is False
    assert stated_sizes_match(True, [{"status": "unmeasured"}]) is None
    assert stated_sizes_match(False, passed) is False
    # the old name still works for code written before the rename
    assert meets_request is stated_sizes_match


# ---- right part, on saved measurements ----


def right_scores(**changes):
    """The measurements of a right create answer, with some of them changed."""
    s = {
        "compiles": True,
        "checks_pass": True,
        "facts": [{"status": "pass"}, {"status": "unmeasured"}],
        "iou": 1.0,
        "mesh": {"shells": 1, "holes": 2},
        "reference": {"mesh": {"shells": 1, "holes": 2}},
    }
    s.update(changes)
    return s


def test_right_part_needs_every_check():
    assert right_part(right_scores()) == {"ok": True, "failed": []}
    assert right_part(right_scores(checks_pass=False))["failed"] == ["checks"]
    assert right_part(right_scores(facts=[{"status": "pass"}, {"status": "fail"}]))["failed"] == ["facts"]
    assert right_part(right_scores(iou=0.98))["failed"] == ["shape"]
    # a second piece, or a hidden hollow (its inner surface is a shell of its own)
    assert right_part(right_scores(mesh={"shells": 2, "holes": 2}))["failed"] == ["pieces"]
    assert right_part(right_scores(mesh={"shells": 1, "holes": 1}))["failed"] == ["holes"]
    # an answer that is not closed has no hole count, which is not the reference's
    assert right_part(right_scores(mesh={"shells": 1, "holes": None}))["failed"] == ["holes"]
    # every check it missed is named, in order
    assert right_part(right_scores(checks_pass=False, iou=0.5, mesh={"shells": 3, "holes": 0}))["failed"] == ["checks", "shape", "pieces", "holes"]


def test_right_part_with_no_part_fails_only_compiles():
    assert right_part({"compiles": False, "checks_pass": False, "facts": [{"status": "fail"}], "iou": 0.0, "mesh": None}) == {"ok": False, "failed": ["compiles"]}


def test_right_part_with_nothing_measured_still_needs_the_shape():
    # an edit that states nothing measurable: no fact fails, so the facts check passes
    assert right_part(right_scores(facts=[{"status": "unmeasured"}]))["ok"]
    assert right_part(right_scores(facts=[]))["ok"]


def test_right_part_overlap_threshold_is_inclusive():
    assert right_part(right_scores(iou=RIGHT_PART_IOU))["ok"]
    assert not right_part(right_scores(iou=RIGHT_PART_IOU - 1e-9))["ok"]
    assert not right_part(right_scores(iou=None))["ok"]


def test_right_part_skips_holes_only_when_the_reference_cannot_count_them():
    assert right_part(right_scores(reference={"mesh": {"shells": 1, "holes": None}}, mesh={"shells": 1, "holes": 5}))["ok"]


def test_right_part_for_an_edit_needs_the_size_block():
    assert right_part(right_scores(edit={"sizes_ok": True}))["ok"]
    # the right shape with dead or missing sliders is not the right part for GKod
    assert right_part(right_scores(edit={"sizes_ok": False}))["failed"] == ["sizes"]


def test_old_records_still_read():
    # a record scored before 28 Nov: meets_request, no stated_sizes_match, no right_part
    old = right_scores(meets_request=True, meets_request_strict=False)
    assert stated_of(old) is True and stated_strict_of(old) is False
    assert right_part(old)["ok"]
    new = right_scores(stated_sizes_match=None, stated_sizes_match_strict=None, meets_request=True)
    assert stated_of(new) is None and stated_strict_of(new) is None


def test_the_threshold_against_the_picture_review():
    """Every compiled answer the 27 Nov picture review described, with its verdict: at RIGHT_PART_IOU every right one
    passes and no wrong one does. Two of the three near misses (square or chamfered corners where rounded ones were
    asked) pass: the overlap cannot see a corner radius at this voxel size."""
    answers = json.loads((Path(__file__).parent / "fixtures" / "right_part_review.json").read_text())["answers"]
    counts = {}
    for a in answers:
        ok = right_part(a["scores"])["ok"]
        counts.setdefault(a["verdict"], {"pass": 0, "fail": 0})["pass" if ok else "fail"] += 1
    assert counts == {"right": {"pass": 11, "fail": 0}, "wrong": {"pass": 0, "fail": 142}, "near miss": {"pass": 2, "fail": 1}}
    near_passes = sorted(f"{a['id']} {a['row']}" for a in answers if a["verdict"] == "near miss" and right_part(a["scores"])["ok"])
    assert near_passes == ["s201-000055 3shot", "s203-000444 3shot"]


def test_the_threshold_sits_between_the_closest_right_and_wrong_answers(monkeypatch):
    answers = json.loads((Path(__file__).parent / "fixtures" / "right_part_review.json").read_text())["answers"]
    lowest_right = min(a["scores"]["iou"] for a in answers if a["verdict"] == "right")
    # the highest wrong answer that passes every other check: only the overlap can fail it
    only_shape = [a for a in answers if a["verdict"] == "wrong" and right_part(a["scores"])["failed"] == ["shape"]]
    highest_wrong = max(a["scores"]["iou"] for a in only_shape)
    assert highest_wrong < RIGHT_PART_IOU <= lowest_right
    assert {"s201-000019"} <= {a["id"] for a in only_shape if a["scores"]["iou"] == highest_wrong}
    # a lower threshold lets wrong parts through; a higher one fails a right part
    monkeypatch.setattr(score, "RIGHT_PART_IOU", 0.95)
    assert sum(right_part(a["scores"])["ok"] for a in answers if a["verdict"] == "wrong") == 3
    monkeypatch.setattr(score, "RIGHT_PART_IOU", 0.995)
    assert sum(not right_part(a["scores"])["ok"] for a in answers if a["verdict"] == "right") == 1


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


def test_added_sizes_must_be_new_sizes_with_their_values():
    row = {
        "facts": {
            "changed": [],
            "kept": [{"name": "thickness", "value": 8}],
            "removed": [],
            "added": [{"name": "rib_count", "value": 3}, {"name": "rib_height", "value": 8}],
        }
    }
    b = [
        {"name": "thickness", "value": 8, "caption": "Plate thickness (mm)"},
        {"name": "rib_count", "value": 3, "caption": "Number of ribs"},
        {"name": "rib_height", "value": 8, "caption": "Rib height (mm)"},
    ]
    block = size_block([dict(p) for p in b], row, b)
    assert block["sizes_ok"] and block["added"] == {"n": 2, "ok": 2}
    # the names of new sizes are free
    block = size_block([b[0], {"name": "ribs", "value": 3}, {"name": "rib_h", "value": 8}], row, b)
    assert block["sizes_ok"] and block["added"] == {"n": 2, "ok": 2}
    # code A back: nothing added
    assert size_block([b[0]], row, b)["added"] == {"n": 2, "ok": 0}
    # one new size only, and a size code A had cannot stand in for the other (thickness is 8 too)
    block = size_block([b[0], {"name": "rib_count", "value": 3}], row, b)
    assert not block["sizes_ok"] and block["wrong"] == [{"name": "rib_height", "value": 8, "ok": False}]


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
    # the four on the mesh, and the stated hole diameter read from the named sizes
    assert s["facts_measured"] == 5 and s["facts_passed"] == 5 and s["facts_unmeasured"] == 0
    assert by_key(s["facts"])["hole_d"] == {"key": "hole_d", "value": 5, "unit": "mm", "how": "code", "status": "pass", "got": 5, "matched": "hole_d"}
    assert s["stated_sizes_match"] is True and s["stated_sizes_match_strict"] is True and s["size_orientation"] == "xyz"
    # the old keys stay in new records as copies
    assert s["meets_request"] is True and s["meets_request_strict"] is True
    assert s["iou"] == pytest.approx(1.0) and s["iou_as_drawn"] == pytest.approx(1.0)
    assert s["right_part"] is True and s["right_part_failed"] == []
    assert s["slider_ends"] == {"sizes": 4, "skipped_sizes": 0, "ends": 8, "compiled": 8, "all_ok": True, "failed": []}


@needs_compiler
def test_a_wrong_answer_loses_the_right_scores(gkod):
    wrong = PLATE.replace("width = 60;", "width = 70;").replace("for (x = [15, width - 15])", "for (x = [15])")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{wrong}```")
    assert s["compiles"] and s["checks_pass"]
    got = by_key(s["facts"])
    assert got["width"]["status"] == "fail" and got["depth"]["status"] == "pass"
    assert got["hole_count"]["status"] == "fail" and got["hole_count"]["got_genus"] == 1
    assert s["stated_sizes_match"] is False
    assert 0.6 < s["iou"] < 0.95
    assert s["right_part"] is False and s["right_part_failed"] == ["facts", "shape", "holes"]


@needs_compiler
def test_a_right_part_standing_up_is_not_marked_down(gkod):
    # the plate stood on its long edge: every stated size is there, on other axes
    upright = PLATE.replace("difference() {", "rotate([90, 0, 0]) difference() {")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{upright}```", slider_ends=False)
    assert s["compiles"] and s["mesh"]["size"] == pytest.approx([60, 4, 30])
    assert s["stated_sizes_match"] is True and s["stated_sizes_match_strict"] is False and s["size_orientation"] == "xzy"
    assert s["iou"] == pytest.approx(1.0) and s["iou_as_drawn"] < 0.5
    assert s["iou_detail"]["turn"] == ["+x", "+z", "-y"]
    # the right part standing up is still the right part (it fails the print checks only if it would not print)
    assert s["checks_pass"] and s["right_part"] is True


@needs_compiler
def test_no_code_and_broken_code(gkod):
    s = score_answer(gkod, CREATE_ROW, "create", "Sorry, I cannot help with that.")
    assert s["extract"] == {"ok": False, "problem": "no-code"}
    assert not s["compiles"] and not s["checks_pass"] and s["stated_sizes_match"] is False and s["iou"] == 0.0
    assert s["slider_ends"] is None
    assert s["right_part"] is False and s["right_part_failed"] == ["compiles"]
    s = score_answer(gkod, CREATE_ROW, "create", "```openscad\ncube([10, 10, 10]);\nsphere(r = nope);\n```")
    assert s["extract"]["ok"] and not s["compiles"] and s["compile"]["error"]
    s = score_answer(gkod, CREATE_ROW, "create", None)
    assert s["extract"]["problem"] == "no-answer" and not s["compiles"]


@needs_compiler
def test_a_hidden_hollow_does_not_hide_missing_holes(gkod):
    hollow = PLATE.replace("for (x = [15, width - 15]) translate([x, depth / 2, -1]) cylinder(d = hole_d, h = thickness + 2);", "translate([25, 10, 1]) cube([5, 5, 2]);")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{hollow}```", slider_ends=False)
    assert s["compiles"] and s["checks_pass"] and s["mesh"]["shells"] == 2
    got = by_key(s["facts"])
    assert got["hole_count"]["status"] == "fail" and got["hole_count"]["got_genus"] == 0
    assert s["stated_sizes_match"] is False
    # the holes and a hollow: the holes are counted
    both = PLATE.replace("cylinder(d = hole_d, h = thickness + 2);", "cylinder(d = hole_d, h = thickness + 2);\n  translate([25, 10, 1]) cube([5, 5, 2]);")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{both}```", slider_ends=False)
    assert s["mesh"]["shells"] == 2 and by_key(s["facts"])["hole_count"]["status"] == "pass" and s["stated_sizes_match"] is True
    # every stated fact passes and the shape is close, but a hidden hollow is a second shell: not the right part
    assert s["iou"] > RIGHT_PART_IOU and s["right_part_failed"] == ["pieces"]


@needs_compiler
def test_an_answer_with_no_named_sizes_fails_the_slider_ends(gkod):
    s = score_answer(gkod, CREATE_ROW, "create", "```openscad\ncube([60, 30, 4]);\n```")
    assert s["compiles"] and s["compile"]["params"] == 0
    assert s["slider_ends"]["sizes"] == 0 and s["slider_ends"]["all_ok"] is False
    assert score_answer(gkod, CREATE_ROW, "create", "```openscad\ncube([60, 30, 4]);\n```", slider_ends=False)["slider_ends"] is None


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
    assert s["stated_sizes_match"] is True and s["iou"] == pytest.approx(1.0)
    assert s["slider_ends"] is None
    assert s["right_part"] is True
    # sending code A back unchanged: the width is wrong
    s = score_answer(gkod, row, "edit", f"```openscad\n{PLATE}```", slider_ends=False)
    assert s["edit"]["same_as_a"] and not s["edit"]["sizes_ok"] and s["stated_sizes_match"] is False
    assert s["right_part_failed"] == ["facts", "shape", "sizes"]
    # changing a kept size as well
    s = score_answer(gkod, row, "edit", f"```openscad\n{b.replace('depth = 30;', 'depth = 32;')}```", slider_ends=False)
    assert not s["edit"]["sizes_ok"] and s["edit"]["size_block"]["kept"] == {"n": 3, "ok": 2}
    assert "sizes" in s["right_part_failed"]


@needs_compiler
def test_an_edit_that_changes_no_named_size_is_not_passed_by_code_a(gkod):
    # a third hole in the middle: the part changes, no named size does
    b = PLATE.replace("for (x = [15, width - 15])", "for (x = [15, width / 2, width - 15])")
    row = {
        "id": "hand-edit-2",
        "a": {"code": PLATE},
        "b": {"code": b},
        "labels": {"stl_sha256": None},
        "facts": {
            "stated": [fact("hole_count", 3, "count")],
            "changed": [],
            "kept": [{"name": "width", "value": 60}, {"name": "depth", "value": 30}, {"name": "thickness", "value": 4}, {"name": "hole_d", "value": 5}],
            "removed": [],
            "added": [],
        },
    }
    s = score_answer(gkod, row, "edit", f"```openscad\n{b}```", slider_ends=False)
    assert s["edit"]["sizes_ok"] and s["edit"]["same_mesh_as_a"] is False
    s = score_answer(gkod, row, "edit", f"```openscad\n{PLATE}```", slider_ends=False)
    assert s["edit"]["same_as_a"] and s["edit"]["size_block"]["sizes_ok"] and not s["edit"]["sizes_ok"]
    # code A sent back fails the size block, the shape and the hole count
    assert s["right_part_failed"] == ["facts", "shape", "holes", "sizes"]
    # code A with a line that changes nothing still makes code A's part
    s = score_answer(gkod, row, "edit", f"```openscad\n{PLATE}// three holes\n```", slider_ends=False)
    assert not s["edit"]["same_as_a"] and s["edit"]["same_mesh_as_a"] and not s["edit"]["sizes_ok"]


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


CUP = """// Cup
// Diameter (mm)
diameter = 75; // [50:1:100]
// Height (mm)
height = 60; // [40:1:80]
// Wall thickness (mm)
wall = 1.6; // [1.2:0.2:2.4]

/* [Hidden] */
$fn = 48;

difference() {
  cylinder(d = diameter, h = height);
  translate([0, 0, 2]) cylinder(d = diameter - 2 * wall, h = height);
}
"""

CUP_ROW = {"id": "hand-cup", "code": CUP, "labels": {"stl_sha256": None}, "facts": [fact("diameter", 75, axis="xy"), fact("height", 60, axis="z")]}


@needs_compiler
def test_a_coarser_circle_setting_is_not_marked_down_on_a_thin_wall(gkod):
    # the same cup with $fn = 32, or with no $fn at all (OpenSCAD's defaults): drawn as written, the 1.6 mm wall moves
    # by a tenth of a millimetre and the overlap fell to about 0.93 to 0.95. Both parts are compared at $fn = 48.
    for code in (CUP.replace("$fn = 48;", "$fn = 32;"), CUP.replace("$fn = 48;\n", "")):
        s = score_answer(gkod, CUP_ROW, "create", f"```openscad\n{code}```", slider_ends=False)
        assert s["iou"] == pytest.approx(1.0) and s["right_part"] is True
        assert s["iou_detail"]["fn"] == score.OVERLAP_FN
    # a $fn given inside the call is the part's own shape and is kept: a six-sided cup is not a round one
    hexagon = CUP.replace("cylinder(d = diameter, h = height);", "cylinder(d = diameter, h = height, $fn = 6);")
    s = score_answer(gkod, CUP_ROW, "create", f"```openscad\n{hexagon}```", slider_ends=False)
    assert s["iou"] < 0.9 and s["right_part"] is False


@needs_compiler
def test_a_stated_hole_size_that_is_wrong_is_not_the_right_part(gkod):
    # 4 mm holes where 5 mm were asked: the overlap is still above 0.99 (the holes are a small share of the plate),
    # so only the named size read from the code catches it
    smaller = PLATE.replace("hole_d = 5;", "hole_d = 4;")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{smaller}```", slider_ends=False)
    assert s["iou"] >= RIGHT_PART_IOU and s["mesh"]["holes"] == 2
    assert by_key(s["facts"])["hole_d"]["status"] == "fail"
    assert s["right_part"] is False and s["right_part_failed"] == ["facts"]
    # the same part with the hole given by its radius is right
    radius = PLATE.replace("// Hole diameter (mm)\nhole_d = 5; // [3:0.5:8]", "// Hole radius (mm)\nhole_r = 2.5; // [1.5:0.25:4]").replace("cylinder(d = hole_d,", "cylinder(r = hole_r,")
    s = score_answer(gkod, CREATE_ROW, "create", f"```openscad\n{radius}```", slider_ends=False)
    assert by_key(s["facts"])["hole_d"]["matched"] == "hole_r" and s["right_part"] is True
