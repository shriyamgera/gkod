#!/usr/bin/env python3
"""Generate OpenSCAD for the held-out requests and measure tokens per second.

    python gen_bench.py --model <path-or-repo> --label small_base --no-think
    python gen_bench.py --model <path-or-repo> --adapter adapters/small --label small_lora

Writes outputs/gen_<label>.jsonl (one row per request, with the text and speeds).
"""
import argparse
import json
import statistics
import time
from pathlib import Path

import mlx.core as mx
from mlx_lm import load, stream_generate

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--adapter")
ap.add_argument("--label", required=True)
ap.add_argument("--data", default="data/test.jsonl")
ap.add_argument("--max-tokens", type=int, default=600)
ap.add_argument("--no-think", action="store_true",
                help="pass enable_thinking=False to the chat template (Qwen3 base)")
args = ap.parse_args()

t0 = time.time()
model, tok = load(args.model, adapter_path=args.adapter)
load_s = time.time() - t0
rows = [json.loads(l) for l in open(args.data)]
out = Path("outputs") / f"gen_{args.label}.jsonl"
out.parent.mkdir(exist_ok=True)

tps, results = [], []
for i, row in enumerate(rows):
    msgs = row["messages"][:-1]
    kw = {"enable_thinking": False} if args.no_think else {}
    prompt = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False, **kw)
    text, last = "", None
    t = time.time()
    for r in stream_generate(model, tok, prompt, max_tokens=args.max_tokens):
        text += r.text
        last = r
    wall = time.time() - t
    tps.append(last.generation_tps)
    results.append({
        "label": f"{args.label}#{i}",
        "request": msgs[-1]["content"],
        "output": text,
        "reference": row["messages"][-1]["content"],
        "exact_match": text.strip() == row["messages"][-1]["content"].strip(),
        "prompt_tokens": last.prompt_tokens,
        "prompt_tps": round(last.prompt_tps, 1),
        "generation_tokens": last.generation_tokens,
        "generation_tps": round(last.generation_tps, 1),
        "wall_s": round(wall, 2),
        "finish_reason": last.finish_reason,
        "peak_memory_gb": round(last.peak_memory, 2),
    })
    print(f"#{i} gen_tokens={last.generation_tokens} gen_tps={last.generation_tps:.1f} "
          f"prompt_tps={last.prompt_tps:.1f} wall={wall:.1f}s finish={last.finish_reason} "
          f"exact={results[-1]['exact_match']}", flush=True)

with open(out, "w") as f:
    for r in results:
        f.write(json.dumps(r) + "\n")
print(f"SUMMARY {args.label}: load={load_s:.1f}s mean_gen_tps={statistics.mean(tps):.1f} "
      f"min={min(tps):.1f} max={max(tps):.1f} "
      f"mean_wall={statistics.mean(r['wall_s'] for r in results):.1f}s "
      f"exact={sum(r['exact_match'] for r in results)}/{len(results)} "
      f"peak_mem={mx.get_peak_memory() / 1e9:.2f}GB")
