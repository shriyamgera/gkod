"""Two rows on the same prompts: for each score, the difference A - B with a 95% interval for paired data and an
exact paired test, overall and per tier. Only prompts both rows have a scored answer for are compared."""

from __future__ import annotations

from pathlib import Path

from gkod_bench.data import check_open
from gkod_bench.paths import RESULTS
from gkod_bench.run import read_records, write_json
from gkod_bench.stats import paired_means, paired_rates
from gkod_bench.summary import TIER_ORDER

BOOLEAN = {
    "compiles": lambda s: s["compiles"],
    "checks_pass": lambda s: s["checks_pass"],
    # a prompt with nothing measured counts as not met here, the same on both sides
    "meets_request": lambda s: s["meets_request"] is True,
}


def _block(pairs: list[tuple[dict, dict]]) -> dict:
    out = {"prompts": len(pairs)}
    for name, get in BOOLEAN.items():
        out[name] = paired_rates([get(a) for a, _ in pairs], [get(b) for _, b in pairs])
    out["iou"] = paired_means([a["iou"] for a, _ in pairs], [b["iou"] for _, b in pairs])
    edits = [(a, b) for a, b in pairs if "edit" in a and "edit" in b]
    if edits:
        out["edit_sizes_ok"] = paired_rates([a["edit"]["sizes_ok"] for a, _ in edits], [b["edit"]["sizes_ok"] for _, b in edits])
    return out


def compare_rows(row_a: str, row_b: str, split: str, *, final: bool = False, results: Path = RESULTS) -> dict:
    check_open(split, final)
    a = {r["id"]: r for r in read_records(results, row_a, split) if r.get("status") == "done"}
    b = {r["id"]: r for r in read_records(results, row_b, split) if r.get("status") == "done"}
    if not a or not b:
        raise FileNotFoundError(f"Both rows need scored answers on {split}: {row_a} has {len(a)}, {row_b} has {len(b)}.")
    common = sorted(a.keys() & b.keys())
    out = {
        "a": row_a,
        "b": row_b,
        "split": split,
        "prompts": {"a": len(a), "b": len(b), "both": len(common)},
        "method": "differences are A - B; rates: Newcombe's paired interval (method 10) and the exact McNemar test; iou: mean paired difference with a normal interval and the exact sign test",
        "overall": _block([(a[i]["scores"], b[i]["scores"]) for i in common]) if common else None,
        "tiers": {},
    }
    for tier in TIER_ORDER:
        ids = [i for i in common if a[i]["tier"] == tier]
        if ids:
            out["tiers"][tier] = _block([(a[i]["scores"], b[i]["scores"]) for i in ids])
    write_json(results / "compare" / f"{row_a}__vs__{row_b}" / f"{split}.json", out)
    return out


def table(result: dict) -> str:
    """A short text table of the overall differences."""
    lines = [f"{result['a']} vs {result['b']} on {result['split']}: {result['prompts']['both']} prompts both have"]
    block = result["overall"] or {}
    for name in [*BOOLEAN, "edit_sizes_ok"]:
        r = block.get(name)
        if not r or r.get("diff") is None:
            continue
        low, high = r["ci95"]
        lines.append(
            f"  {name:14} A {r['rate_a']:.1%}  B {r['rate_b']:.1%}  A-B {r['diff']:+.1%} [{low:+.1%}, {high:+.1%}]  "
            f"only A {r['only_a']}, only B {r['only_b']}, p {r['mcnemar_p']:.3g}"
        )
    r = block.get("iou")
    if r and r.get("diff") is not None:
        ci = f"[{r['ci95'][0]:+.3f}, {r['ci95'][1]:+.3f}]" if r["ci95"] else ""
        lines.append(f"  {'iou':14} A {r['mean_a']:.3f}  B {r['mean_b']:.3f}  A-B {r['diff']:+.3f} {ci}  sign p {r['sign_p']:.3g}")
    return "\n".join(lines)
