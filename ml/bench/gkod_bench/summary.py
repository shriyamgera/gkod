"""Rates with 95% Wilson intervals, per tier and overall, from the saved per-prompt records."""

from __future__ import annotations

from collections import Counter

from gkod_bench.stats import mean_ci, median, rate

TIER_ORDER = ("t1", "t2", "t3", "edit")


def _group(records: list[dict]) -> dict:
    n = len(records)
    s = [r["scores"] for r in records]
    compiled = [x for x in s if x["compiles"]]
    out: dict = {"prompts": n}
    out["compiles"] = rate(sum(x["compiles"] for x in s), n)
    out["checks_pass"] = rate(sum(x["checks_pass"] for x in s), n)
    judged = [x["meets_request"] for x in s if x["meets_request"] is not None]
    out["meets_request"] = {**rate(sum(judged), len(judged)), "prompts_with_nothing_measured": n - len(judged)}
    strict = [x["meets_request_strict"] for x in s if x.get("meets_request_strict") is not None]
    out["meets_request_strict_axes"] = {
        **rate(sum(strict), len(strict)),
        "note": "overall sizes on the axes the reference part is drawn with, which no prompt states; the score is meets_request",
    }
    facts = [f for x in s for f in x["facts"]]
    # a holes_total fact is added by the scorer when one genus measures several stated counts; it is not stated
    stated = [f for f in facts if "of" not in f]
    measured = [f for f in facts if f["status"] != "unmeasured"]
    by_how = {}
    for how in ("size", "holes"):
        fs = [f for f in measured if f["how"] == how]
        by_how[how] = rate(sum(f["status"] == "pass" for f in fs), len(fs))
    sized = [f for f in measured if f["how"] == "size" and "strict" in f]
    by_how["size_strict_axes"] = rate(sum(f["strict"]["status"] == "pass" for f in sized), len(sized))
    out["facts"] = {
        "stated": len(stated),
        "totals_added": len(facts) - len(stated),
        "measured": len(measured),
        "unmeasured": sum(f["status"] == "unmeasured" for f in stated),
        # facts of one prompt are not independent, so this interval is narrower than it should be
        "passed": rate(sum(f["status"] == "pass" for f in measured), len(measured)),
        "by_measurer": by_how,
        "unmeasured_reasons": dict(Counter(f.get("reason") for f in facts if f["status"] == "unmeasured").most_common()),
    }
    ious = [x["iou"] for x in s]
    out["iou"] = {**mean_ci(ious), "median": median(ious), "note": "0 for a prompt with no part"}
    out["iou_compiled"] = {**mean_ci([x["iou"] for x in compiled]), "median": median([x["iou"] for x in compiled])}
    drawn = [x.get("iou_as_drawn", x["iou"]) for x in s]
    out["iou_as_drawn"] = {**mean_ci(drawn), "median": median(drawn), "note": "the answer as drawn, not turned to fit; 0 for a prompt with no part"}
    ends = [x["slider_ends"] for x in compiled if x.get("slider_ends")]
    out["slider_ends"] = {
        "all_ends_compile": rate(sum(e["all_ok"] for e in ends), len(ends)),
        "ends": sum(e["ends"] for e in ends),
        "ends_compiled": sum(e["compiled"] for e in ends),
    }
    edits = [x["edit"] for x in s if "edit" in x]
    if edits:
        out["edit_sizes_ok"] = rate(sum(e["sizes_ok"] for e in edits), len(edits))
        out["edit_same_as_a"] = sum(e["same_as_a"] for e in edits)
        out["edit_same_mesh_as_a"] = sum(bool(e.get("same_mesh_as_a")) for e in edits)
    out["no_code"] = dict(Counter(x["extract"]["problem"] for x in s if not x["extract"]["ok"]))
    out["check_failures"] = dict(Counter(k for x in compiled for k, ok in (x["checks"] or {}).items() if not ok))
    secs = [r["timings"]["engine_s"] for r in records]
    out["engine_seconds"] = {"mean": sum(secs) / n if n else None, "median": median(secs)}
    tokens = [r["engine_meta"].get("generation_tokens") for r in records if r["engine_meta"].get("generation_tokens") is not None]
    if tokens:
        out["generation_tokens"] = {"mean": sum(tokens) / len(tokens), "max": max(tokens), "cut_off": sum(r["engine_meta"].get("finish_reason") == "length" for r in records)}
    costs = [r["engine_meta"].get("total_cost_usd") for r in records if r["engine_meta"].get("total_cost_usd") is not None]
    if costs:
        out["cost_usd"] = {"total": sum(costs), "mean": sum(costs) / len(costs)}
    return out


def summarize(records: list[dict], expected: list[dict], config: dict) -> dict:
    """`records` are every saved record of the row and split; `expected` the prompts the split holds (id, tier,
    family) after any tier filter."""
    by_id = {r["id"]: r for r in records}
    done = [by_id[e["id"]] for e in expected if e["id"] in by_id and by_id[e["id"]]["status"] == "done"]
    errors = [by_id[e["id"]] for e in expected if e["id"] in by_id and by_id[e["id"]]["status"] == "error"]
    missing = [e["id"] for e in expected if e["id"] not in by_id or by_id[e["id"]]["status"] != "done"]
    out = {
        "row": config["row"],
        "split": config["split"],
        "config": config,
        "prompts": len(expected),
        "done": len(done),
        "missing": len(missing),
        "engine_errors": len(errors),
        "complete": not missing,
        "overall": _group(done) if done else None,
        "tiers": {},
        "t3_families": {},
        "dates": sorted({(r["engine_meta"].get("date") or r["at"])[:10] for r in done}),
        "harness_commits": sorted({r["harness"]["commit"] for r in done}),
    }
    for tier in TIER_ORDER:
        group = [r for r in done if r["tier"] == tier]
        if group:
            out["tiers"][tier] = _group(group)
    for family in sorted({r["family"] for r in done if r["tier"] == "t3"}):
        out["t3_families"][family] = _group([r for r in done if r["tier"] == "t3" and r["family"] == family])
    if not out["complete"]:
        out["note"] = f"{len(missing)} of {len(expected)} prompts have no scored answer yet; the rates cover the {len(done)} done."
    return out
