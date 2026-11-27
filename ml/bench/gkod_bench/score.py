"""Scores one answer, all by code: compiles, passes the print checks, meets the request (each stated fact checked on
the mesh where a measurer exists), shape overlap with the reference part, the size block for edits, and whether the
part still compiles at both ends of every slider.

What counts as measured:
- A fact with an axis (the part's real overall size along x, y, z, or x and y for a diameter) is checked on the
  answer's bounding box, within 0.5 mm, whichever way the answer lies: the prompt's overall sizes are matched to the
  box's three sides in the one order that fits the most of them, since no prompt says which side is x. The axes the
  reference part is drawn with (a hook or clip lies on its side) are kept as a second, stricter result.
- Stated hole counts (keys ending in hole_count, and slot_count with them when needed) are checked with the mesh's
  genus: the number of through holes. When it takes more than one count to make the total (the holes in each arm, or
  holes and slots), the genus measures only their sum, so one added fact, holes_total, is measured and the counts
  themselves are unmeasured. They are measured only when the reference part is one closed body whose genus
  is exactly the stated total, so the genus is known to count those holes and nothing else; otherwise they are
  marked unmeasured, with the reason. The answer's holes are the genus of all its closed surfaces added up, so a
  second piece or a hidden hollow cannot hide missing holes; an answer that is not closed fails them, since a part
  must be closed to print and the reference showed the holes can be counted.
- Every other fact (hole diameters, spacings, flags, wall thickness, ...) is unmeasured until a measurer exists.
"""

from __future__ import annotations

import itertools
import math
import tempfile
import time
from pathlib import Path
from typing import Any

from gkod_bench.extract import extract_code
from gkod_bench.gkod import TIMEOUT_MESSAGE, Gkod
from gkod_bench.mesh import MeshInfo, measure
from gkod_bench.stl import read_stl
from gkod_bench.voxel import best_turn_iou

SIZE_TOLERANCE_MM = 0.5
# edit values are written with a few decimals; scaled sizes are exact to 1e-6 in code B
VALUE_TOLERANCE = 1e-3
MAX_SLIDERS = 30
REFERENCE_TRIES = 3
AXES = {"x": (0,), "y": (1,), "z": (2,), "xy": (0, 1)}
# the answer's axes for the request's x, y and z, the order as drawn first
ORDERS = list(itertools.permutations(range(3)))


def _counts(facts: list[dict], suffix: str) -> list[dict]:
    return [f for f in facts if f.get("unit") == "count" and f["key"].endswith(suffix)]


def plan_facts(facts: list[dict], reference: MeshInfo | None) -> list[dict]:
    """How each stated fact will be measured, decided from the request and the reference part alone."""
    planned = [{**f, "how": None, "reason": "no measurer for this fact yet"} for f in facts]
    for p in planned:
        if p.get("axis") in AXES and p.get("unit") == "mm":
            p["how"], p["reason"] = "size", None
    holes = _counts(facts, "hole_count")
    groups = [holes, holes + _counts(facts, "slot_count")]
    keys_in_play = {f["key"] for f in groups[1]}
    if keys_in_play:
        genus = reference.genus if reference else None
        chosen = None
        if genus is not None:
            for group in groups:
                if group and sum(f["value"] for f in group) == genus:
                    chosen = group
                    break
        chosen_keys = [f["key"] for f in chosen] if chosen else []
        for p in planned:
            if p["key"] not in keys_in_play:
                continue
            if p["key"] in chosen_keys and len(chosen_keys) == 1:
                p["how"], p["reason"], p["expected_genus"] = "holes", None, genus
            elif p["key"] in chosen_keys:
                p["reason"] = f"only the total of {' and '.join(chosen_keys)} is measurable (holes_total)"
            elif genus is None:
                p["reason"] = "the reference part is not one closed body, so its genus does not count holes"
            else:
                p["reason"] = f"the reference part has {genus} through holes, not the stated total, so the genus cannot count these"
        if len(chosen_keys) > 1:
            # one genus measures only the sum: say so with one fact, so the right total in the wrong places (all the
            # holes in one arm, holes for a slot) passes once, not once for each key
            planned.append({"key": "holes_total", "value": genus, "unit": "count", "of": chosen_keys, "how": "holes", "reason": None, "expected_genus": genus})
    return planned


def _size_ok(got: list[float], value: float) -> bool:
    return all(abs(g - value) <= SIZE_TOLERANCE_MM for g in got)


def orient(planned: list[dict], size: tuple[float, float, float]) -> tuple[int, int, int]:
    """The answer's axes for the request's x, y and z: the one order of the box's sides that fits the most stated
    overall sizes, then the smallest total error, then the order as drawn. One order serves every size of the prompt,
    so a part cannot be wide on one axis for one fact and on another for the next."""
    sized = [p for p in planned if p["how"] == "size"]
    best_key, best = None, ORDERS[0]
    for order in ORDERS:
        got = [[size[order[i]] for i in AXES[p["axis"]]] for p in sized]
        key = (-sum(_size_ok(g, p["value"]) for g, p in zip(got, sized)), round(sum(abs(x - p["value"]) for g, p in zip(got, sized) for x in g), 6))
        if best_key is None or key < best_key:
            best_key, best = key, order
    return best


def check_facts(planned: list[dict], answer: MeshInfo | None) -> list[dict]:
    """pass, fail or unmeasured for each fact. With no mesh every measurable fact fails: there is no part. An overall
    size is checked on the side of the answer's box that `orient` matched to its axis; `strict` keeps the result on
    the stated axis itself."""
    order = orient(planned, answer.size) if answer is not None else ORDERS[0]
    out = []
    for p in planned:
        r = {k: p[k] for k in ("key", "value", "unit", "of") if k in p}
        if p.get("axis"):
            r["axis"] = p["axis"]
        how = p["how"]
        r["how"] = how
        if how is None:
            r.update(status="unmeasured", reason=p["reason"])
        elif answer is None:
            r.update(status="fail", reason="no mesh")
            if how == "size":
                r["strict"] = {"status": "fail"}
        elif how == "size":
            axes = [order[i] for i in AXES[p["axis"]]]
            got = [answer.size[i] for i in axes]
            r["got"] = [round(g, 3) for g in got]
            r["answer_axis"] = "".join("xyz"[i] for i in axes)
            r["status"] = "pass" if _size_ok(got, p["value"]) else "fail"
            strict = [answer.size[i] for i in AXES[p["axis"]]]
            r["strict"] = {"got": [round(g, 3) for g in strict], "status": "pass" if _size_ok(strict, p["value"]) else "fail"}
        elif how == "holes":
            r["expected_genus"] = p["expected_genus"]
            if not answer.closed:
                r.update(status="fail", reason="the answer is not closed, so its holes cannot be counted")
            elif answer.holes is None:
                r.update(status="fail", reason="the answer's surfaces touch at a corner or an edge, so its holes cannot be counted")
            else:
                r["got_genus"] = answer.holes
                r["status"] = "pass" if answer.holes == p["expected_genus"] else "fail"
        out.append(r)
    return out


def meets_request(compiled: bool, facts: list[dict]) -> bool | None:
    """False when there is no part or a measured fact fails; True when at least one fact was measured and all
    passed; None when nothing could be measured."""
    if not compiled:
        return False
    measured = [f for f in facts if f["status"] != "unmeasured"]
    if any(f["status"] == "fail" for f in measured):
        return False
    return True if measured else None


def meets_request_strict(compiled: bool, facts: list[dict]) -> bool | None:
    """meets_request with every overall size on the axis its fact names, as the reference part is drawn: width on x,
    depth on y, height on z, and a hook, clip, saddle or handle lying on its side. No prompt says this, so it is the
    second, stricter column, not the score."""
    return meets_request(compiled, [{**f, "status": f["strict"]["status"]} if "strict" in f else f for f in facts])


def _close(a: Any, b: Any) -> bool:
    return isinstance(a, int | float) and isinstance(b, int | float) and math.isclose(a, b, rel_tol=0, abs_tol=VALUE_TOLERANCE)


def size_block(answer_params: list[dict], row: dict, b_params: list[dict]) -> dict:
    """The answer's named sizes against code B: kept sizes have the same name, value and caption; changed sizes
    have their new value; removed sizes are gone; each added size is there as a new size (a name code A did not
    have) with its value. Names of added sizes are free, so one is matched by its own name first, then by value."""
    ans = {p["name"]: p for p in answer_params}
    b = {p["name"]: p for p in b_params}
    facts = row["facts"]
    a_names = {x["name"] for key in ("kept", "changed", "removed") for x in facts[key]}
    kept = []
    for k in facts["kept"]:
        got = ans.get(k["name"])
        caption = b.get(k["name"], {}).get("caption")
        ok = got is not None and _close(got["value"], k["value"]) and got.get("caption") == caption
        kept.append({"name": k["name"], "ok": ok, **({"got": got["value"], "got_caption": got.get("caption")} if got and not ok else {})})
    changed = []
    for c in facts["changed"]:
        got = ans.get(c["name"])
        ok = got is not None and _close(got["value"], c["to"])
        changed.append({"name": c["name"], "to": c["to"], "ok": ok, **({"got": got["value"] if got else None} if not ok else {})})
    removed = [{"name": r["name"], "ok": r["name"] not in ans} for r in facts["removed"]]
    new = [p for p in answer_params if p["name"] not in a_names]
    used: set[str] = set()
    added = []
    for x in facts["added"]:
        options = sorted((p for p in new if p["name"] not in used and _close(p["value"], x["value"])), key=lambda p: p["name"] != x["name"])
        got = options[0] if options else None
        if got:
            used.add(got["name"])
        added.append({"name": x["name"], "value": x["value"], "ok": got is not None, **({"as": got["name"]} if got and got["name"] != x["name"] else {})})
    every = kept + changed + removed + added
    return {
        "sizes_ok": all(x["ok"] for x in every),
        "kept": {"n": len(kept), "ok": sum(x["ok"] for x in kept)},
        "changed": {"n": len(changed), "ok": sum(x["ok"] for x in changed)},
        "removed": {"n": len(removed), "ok": sum(x["ok"] for x in removed)},
        "added": {"n": len(added), "ok": sum(x["ok"] for x in added)},
        "wrong": [x for x in every if not x["ok"]],
    }


def _slider_ends(gkod: Gkod, code: str, params: list[dict]) -> dict:
    sizes = params[:MAX_SLIDERS]
    jobs, ends = [], []
    for p in sizes:
        for end in ("min", "max"):
            jobs.append({"code": code, "defines": {p["name"]: p[end]}, "check": False})
            ends.append((p["name"], end, p[end]))
    replies = gkod.compile_many(jobs) if jobs else []
    failed = [{"name": n, "end": e, "value": v, "error": r.get("error")} for (n, e, v), r in zip(ends, replies) if not r.get("ok")]
    return {
        "sizes": len(sizes),
        "skipped_sizes": max(0, len(params) - MAX_SLIDERS),
        "ends": len(ends),
        "compiled": len(ends) - len(failed),
        "all_ok": not failed,
        "failed": failed,
    }


def reference_code(row: dict, task: str) -> tuple[str, str | None]:
    """The code the answer is compared with, and the STL sha256 the set recorded for it."""
    if task == "edit":
        return row["b"]["code"], row["labels"].get("stl_sha256")
    return row["code"], row["labels"].get("stl_sha256")


def score_answer(gkod: Gkod, row: dict, task: str, answer_text: str | None, slider_ends: bool = True) -> dict:
    """Every score for one answer. `answer_text` None means the engine gave no answer at all."""
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="gkod-bench-") as tmp:
        ref_stl = Path(tmp) / "reference.stl"
        ans_stl = Path(tmp) / "answer.stl"
        ref_code, ref_sha = reference_code(row, task)
        # the reference passed every label when the set was made, so a failure here is the machine (a stall); try again
        for _ in range(REFERENCE_TRIES):
            ref = gkod.compile(ref_code, stl=ref_stl, check=False)
            if ref.get("ok"):
                break
        else:
            raise RuntimeError(f"the reference part of {row['id']} did not compile: {ref.get('error')}")
        ref_tri = read_stl(ref_stl)
        ref_info = measure(ref_tri)
        reference = {"stl_sha256_ok": ref.get("stl_sha256") == ref_sha, "mesh": ref_info.as_dict()}

        extracted = extract_code(answer_text) if answer_text is not None else {"ok": False, "problem": "no-answer", "message": "the engine gave no answer"}
        code = extracted.get("code") if extracted["ok"] else None
        scores: dict[str, Any] = {
            "extract": {"ok": extracted["ok"], "problem": extracted.get("problem")},
            "code": code,
            "reference": reference,
        }
        compiled = None
        if code is not None:
            compiled = gkod.compile(code, stl=ans_stl, check=True)
            if not compiled.get("ok") and compiled.get("error") == TIMEOUT_MESSAGE:
                # once more, so a stall of the machine does not count against the code; slow code fails twice
                again = gkod.compile(code, stl=ans_stl, check=True)
                again["first_try"] = {"error": compiled.get("error"), "ms": compiled.get("ms")}
                compiled = again
        ok = bool(compiled and compiled.get("ok"))
        scores["compiles"] = ok
        scores["compile"] = None if compiled is None else {
            "error": compiled.get("error"),
            "ms": compiled.get("ms"),
            "triangles": compiled.get("triangles"),
            "params": len(compiled.get("params") or []),
            **({"first_try": compiled["first_try"]} if "first_try" in compiled else {}),
        }
        checks = compiled.get("checks") if ok else None
        scores["checks_pass"] = bool(checks and checks.get("ok"))
        scores["checks"] = {c["id"]: c["ok"] for c in checks["results"]} if checks else None
        scores["check_details"] = [c for c in checks["results"] if not c["ok"]] if checks else None

        info = measure(read_stl(ans_stl)) if ok else None
        scores["mesh"] = info.as_dict() if info else None

        stated = row["facts"]["stated"] if task == "edit" else row["facts"]
        planned = plan_facts(stated, ref_info)
        facts = check_facts(planned, info)
        scores["facts"] = facts
        scores["facts_measured"] = sum(f["status"] != "unmeasured" for f in facts)
        scores["facts_passed"] = sum(f["status"] == "pass" for f in facts)
        scores["facts_unmeasured"] = sum(f["status"] == "unmeasured" for f in facts)
        scores["meets_request"] = meets_request(ok, facts)
        scores["meets_request_strict"] = meets_request_strict(ok, facts)
        # the answer's axes that the request's x, y and z sizes were read on ("xyz" when it lies as drawn)
        scores["size_orientation"] = "".join("xyz"[i] for i in orient(planned, info.size)) if info else None

        if ok:
            overlap = best_turn_iou(read_stl(ans_stl), ref_tri)
            scores["iou"] = overlap["iou"] if overlap["iou"] is not None else 0.0
            scores["iou_as_drawn"] = overlap["iou_as_drawn"] if overlap["iou_as_drawn"] is not None else 0.0
            scores["iou_detail"] = overlap
        else:
            scores["iou"] = 0.0
            scores["iou_as_drawn"] = 0.0
            scores["iou_detail"] = None

        params = compiled.get("params") if ok else None
        if task == "edit":
            b_params = ref.get("params") or []
            block = size_block(params, row, b_params) if ok else None
            same_code = code is not None and code.strip() == row["a"]["code"].strip()
            same_mesh = None
            if ok:
                # code A sent back, or code that makes code A's part, never passes, even when no named size changes
                for _ in range(REFERENCE_TRIES):
                    a = gkod.compile(row["a"]["code"], check=False)
                    if a.get("ok"):
                        break
                a_sha = a.get("stl_sha256") if a.get("ok") else None
                same_mesh = a_sha is not None and a_sha != ref.get("stl_sha256") and compiled.get("stl_sha256") == a_sha
            scores["edit"] = {
                "sizes_ok": bool(block and block["sizes_ok"]) and not same_code and not same_mesh,
                "size_block": block,
                "same_as_a": same_code,
                "same_mesh_as_a": same_mesh,
            }
        scores["slider_ends"] = _slider_ends(gkod, code, params) if ok and slider_ends and params else None
    scores["score_s"] = round(time.perf_counter() - started, 3)
    return scores
