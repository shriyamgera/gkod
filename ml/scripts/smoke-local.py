"""Smoke test for the local model on this Mac: load time, speed, peak memory, and how many answers compile.

    DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/scripts/smoke-local.py

Five prompts from five fixed dev rows (create rows 0, 100, 200 and 275: one per tier and a second new family; edit row
0), worded with the site's own system prompt and message text (app/src/engine/prompts.ts), zero-shot, greedy decoding.
Each answer's code is taken by the site's rule (app/src/engine/extract.ts, as ported in ml/bench/gkod_bench/extract.py)
and compiled with the gkod command. Answers
go to results/smoke/ (git-ignored). This is a check that the setup works, not a scored row: the benchmark harness
scores rows.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
REPO = ML.parent
MODEL = ML / "models" / "qwen2.5-coder-1.5b-instruct"
SETS = REPO / "data" / "sets" / "v1"
PROMPTS = REPO / "app" / "src" / "engine" / "prompts.ts"
GKOD = REPO / "tools" / "bin" / "gkod.mjs"
CREATE_ROWS = (0, 100, 200, 275)
EDIT_ROWS = (0,)

sys.path.insert(0, str(ML / "bench"))
from gkod_bench.extract import extract_code  # noqa: E402  the site's rule, shared with the benchmark


def read_rows(split: str, task: str, picks: tuple[int, ...]) -> list[dict]:
    if split != "dev":
        raise SystemExit("The smoke test reads dev rows only.")
    lines = (SETS / split / f"{task}.jsonl").read_text().splitlines()
    return [json.loads(lines[i]) for i in picks]


def site_messages(requests: list[dict]) -> tuple[str, list[str]]:
    """The site's system prompt and the words it sends for each request, from prompts.ts itself."""
    script = (
        f"import {{ SYSTEM_INSTRUCTION, userText }} from {json.dumps(PROMPTS.as_uri())};"
        "let input = ''; process.stdin.on('data', (d) => (input += d));"
        "process.stdin.on('end', () => { const reqs = JSON.parse(input);"
        "process.stdout.write(JSON.stringify({ system: SYSTEM_INSTRUCTION, users: reqs.map(userText) })); });"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(requests), capture_output=True, text=True, check=True)
    got = json.loads(out.stdout)
    return got["system"], got["users"]


def compile_scad(path: Path) -> dict:
    out = subprocess.run(["node", str(GKOD), "compile", str(path), "-o", str(path.with_suffix(".stl")), "--json"], capture_output=True, text=True, cwd=REPO)
    try:
        result = json.loads(out.stdout)
    except ValueError:
        return {"ok": False, "error": (out.stderr or out.stdout).strip()[:300]}
    return {"ok": bool(result.get("ok")), "error": result.get("error"), "triangles": result.get("triangles"), "ms": result.get("ms")}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--model", type=Path, default=MODEL)
    p.add_argument("--max-tokens", type=int, default=2048)
    p.add_argument("--out", type=Path, default=REPO / "results" / "smoke" / f"{datetime.now():%Y%m%d-%H%M%S}")
    args = p.parse_args()

    creates = read_rows("dev", "create", CREATE_ROWS)
    edits = read_rows("dev", "edit", EDIT_ROWS)
    rows = [(r["id"], r["tier"], r["family"], {"kind": "create", "prompt": r["request"]}) for r in creates]
    rows += [(r["id"], "edit", r["family"], {"kind": "edit", "instruction": r["instruction"], "code": r["a"]["code"]}) for r in edits]
    system, users = site_messages([req for *_, req in rows])
    args.out.mkdir(parents=True, exist_ok=True)

    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler

    mx.reset_peak_memory()
    began = time.perf_counter()
    model, tokenizer = load(str(args.model))
    load_s = time.perf_counter() - began
    load_peak = mx.get_peak_memory() / 1e9
    print(f"loaded {args.model.name} in {load_s:.1f} s, peak memory {load_peak:.2f} GB")

    sampler = make_sampler(temp=0.0)
    results = []
    for (row_id, tier, family, _req), user in zip(rows, users):
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
        mx.reset_peak_memory()
        text, last = "", None
        t0 = time.perf_counter()
        for last in stream_generate(model, tokenizer, prompt=prompt, max_tokens=args.max_tokens, sampler=sampler):
            text += last.text
        wall = time.perf_counter() - t0
        extracted = extract_code(text)
        code = extracted.get("code") if extracted["ok"] else None
        (args.out / f"{row_id}.answer.txt").write_text(text)
        compiled = {"ok": False, "error": extracted.get("problem", "")}
        if code:
            scad = args.out / f"{row_id}.scad"
            scad.write_text(code)
            compiled = compile_scad(scad)
        row = {
            "id": row_id,
            "tier": tier,
            "family": family,
            "prompt_tokens": last.prompt_tokens,
            "prompt_tps": round(last.prompt_tps, 1),
            "answer_tokens": last.generation_tokens,
            "generation_tps": round(last.generation_tps, 1),
            "finish": last.finish_reason,
            "seconds": round(wall, 2),
            "peak_gb": round(mx.get_peak_memory() / 1e9, 2),
            "has_code": code is not None,
            "compiles": compiled["ok"],
            "error": None if compiled["ok"] else (compiled.get("error") or "")[:200],
        }
        results.append(row)
        print(
            f"{row_id} {tier:<4} {family:<14} prompt {row['prompt_tokens']:>4} tok at {row['prompt_tps']:>6} tok/s, "
            f"answer {row['answer_tokens']:>4} tok at {row['generation_tps']:>5} tok/s, {row['seconds']:>5} s, "
            f"peak {row['peak_gb']} GB, {'compiles' if row['compiles'] else 'does not compile: ' + str(row['error'])[:80]}"
        )

    summary = {
        "model": str(args.model.relative_to(REPO)) if args.model.is_relative_to(REPO) else str(args.model),
        "decoding": {"temp": 0.0, "max_tokens": args.max_tokens},
        "load_seconds": round(load_s, 2),
        "load_peak_gb": round(load_peak, 2),
        "max_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2),
        "compiled": sum(r["compiles"] for r in results),
        "rows": results,
        "when": datetime.now().isoformat(timespec="seconds"),
        "pid": os.getpid(),
    }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    gen = sum(r["answer_tokens"] for r in results) / max(sum(r["seconds"] for r in results), 1e-9)
    print(f"compiled {summary['compiled']} of {len(results)}; {gen:.1f} answer tokens per second overall; max RSS {summary['max_rss_gb']} GB")
    print(f"answers and summary in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
