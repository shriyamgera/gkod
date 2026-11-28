"""Rates with 95% Wilson intervals, per tier and overall, from the saved per-prompt records.

The headline is right_part (see score.right_part), worked out again here from each record's saved measurements, so
records scored before it existed count too. Next to it, for create prompts, the guess ceiling (see ceiling.py)."""

from __future__ import annotations

from collections import Counter

from gkod_bench.ceiling import share
from gkod_bench.score import RIGHT_PART_GATES, RIGHT_PART_IOU, right_part, stated_of, stated_strict_of
from gkod_bench.stats import mean_ci, median, rate

TIER_ORDER = ("t1", "t2", "t3", "edit")
CEILING_NOTE = (
    "create prompts only: the share whose reference, made again with every size the request leaves out at its train "
    "median, still reaches the right-part overlap; not a hard limit, a better guesser can beat it"
)


def _right(records: list[dict]) -> dict:
    verdicts = [right_part(r["scores"]) for r in records]
    failed = Counter(g for v in verdicts for g in v["failed"])
    return {
        **rate(sum(v["ok"] for v in verdicts), len(verdicts)),
        "iou_threshold": RIGHT_PART_IOU,
        # each answer that is not right counts once under every check it missed; no part counts only as compiles
        "failed": {g: failed[g] for g in RIGHT_PART_GATES if failed[g]},
    }


def _ceiling(records: list[dict], ceiling: dict | None) -> dict | None:
    creates = [r for r in records if r["task"] == "create"]
    if not creates:
        return None
    if ceiling is None:
        return {"note": "not worked out for this split yet: run gkod_bench summarize"}
    got = share(ceiling, [r["id"] for r in creates])
    known = [r for r in creates if r["id"] in ceiling["prompts"]]
    return {
        **rate(got["k"], got["n"]),
        "iou_threshold": RIGHT_PART_IOU,
        "right_part_on_these": rate(sum(right_part(r["scores"])["ok"] for r in known), len(known)),
        # prompts with a size train has no guess for (a tier 3 family's own name): the ceiling kept the true value
        "kept_a_true_value": got["kept_a_true_value"],
        "note": CEILING_NOTE,
    }


def _group(records: list[dict], ceiling: dict | None = None) -> dict:
    n = len(records)
    s = [r["scores"] for r in records]
    compiled = [x for x in s if x["compiles"]]
    out: dict = {"prompts": n}
    out["right_part"] = _right(records)
    guessed = _ceiling(records, ceiling)
    if guessed is not None:
        out["guess_ceiling"] = guessed
    out["compiles"] = rate(sum(x["compiles"] for x in s), n)
    out["checks_pass"] = rate(sum(x["checks_pass"] for x in s), n)
    judged = [v for v in (stated_of(x) for x in s) if v is not None]
    out["stated_sizes_match"] = {
        **rate(sum(judged), len(judged)),
        "prompts_with_nothing_measured": n - len(judged),
        "note": "every measured stated fact (overall sizes, hole counts) passes; loose: a solid block of the right size passes for a tray",
    }
    strict = [v for v in (stated_strict_of(x) for x in s) if v is not None]
    out["stated_sizes_match_strict_axes"] = {
        **rate(sum(strict), len(strict)),
        "note": "overall sizes on the axes the reference part is drawn with, which no prompt states; a column, not a score",
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
    # named sizes are the point of the site's code: the share of compiled answers that have any
    out["has_named_sizes"] = rate(sum(bool(x["compile"]["params"]) for x in compiled), len(compiled))
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
    # answers with no code because the engine turned the prompt down, or ran out of time or turns
    out["engine_failures"] = dict(Counter(r["engine_meta"].get("failure", "other") for r in records if r.get("engine_error")))
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


def summarize(records: list[dict], expected: list[dict], config: dict, ceiling: dict | None = None) -> dict:
    """`records` are every saved record of the row and split; `expected` the prompts the split holds (id, tier,
    family) after any tier filter; `ceiling` the split's saved guess ceiling, if it has one."""
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
        "engine_failures_scored": sum(1 for r in done if r.get("engine_error")),
        "complete": not missing,
        "overall": _group(done, ceiling) if done else None,
        "tiers": {},
        "t3_families": {},
        "dates": sorted({(r["engine_meta"].get("date") or r["at"])[:10] for r in done}),
        "harness_commits": sorted({r["harness"]["commit"] for r in done}),
    }
    for tier in TIER_ORDER:
        group = [r for r in done if r["tier"] == tier]
        if group:
            out["tiers"][tier] = _group(group, ceiling)
    for family in sorted({r["family"] for r in done if r["tier"] == "t3"}):
        out["t3_families"][family] = _group([r for r in done if r["tier"] == "t3" and r["family"] == family], ceiling)
    if not out["complete"]:
        out["note"] = f"{len(missing)} of {len(expected)} prompts have no scored answer yet; the rates cover the {len(done)} done."
    return out
