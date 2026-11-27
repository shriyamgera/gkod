"""gkod-bench run | summarize | rescore | compare | fewshot"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from gkod_bench.data import FROZEN, SplitClosed, check_open, fewshot
from gkod_bench.paths import LOCAL_MODEL, RESULTS, SETS

ENGINES = ("local", "gemini", "claude-code")


def default_row(args: argparse.Namespace) -> str:
    if args.engine == "claude-code":
        return "claude-code-tools" + (f"-{args.model}" if args.model else "")
    if args.engine == "gemini":
        return f"gemini-{args.model or 'gemini-3.1-flash-lite'}-{args.shots}shot".replace("gemini-gemini", "gemini")
    name = Path(args.model).name if args.model else LOCAL_MODEL.name
    trained = "-" + Path(args.adapter).name if args.adapter else ""
    return f"local-{name}{trained}-{args.shots}shot"


def make_engine(args: argparse.Namespace):
    if args.engine == "local":
        from gkod_bench.engines.local import LocalEngine

        return LocalEngine(Path(args.model) if args.model else LOCAL_MODEL, adapter=args.adapter, max_tokens=args.max_tokens, temperature=args.temperature, seed=args.seed)
    if args.engine == "gemini":
        from gkod_bench.engines.gemini import DEFAULT_MODEL, GeminiEngine

        return GeminiEngine(args.model or DEFAULT_MODEL, rpm=args.rpm, retries=args.retries)
    from gkod_bench.engines.claude_code import ClaudeCodeEngine

    return ClaudeCodeEngine(model=args.model, effort=args.effort)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="gkod-bench", description="Run engines on the frozen sets and score every answer by code.")
    sub = p.add_subparsers(dest="command", required=True)

    def split_args(q: argparse.ArgumentParser) -> None:
        q.add_argument("--split", default="dev", choices=["dev", "test"])
        q.add_argument("--final", action="store_true", help="the final run only: opens the test split")
        q.add_argument("--results", type=Path, default=RESULTS)
        q.add_argument("--sets", type=Path, default=SETS)

    r = sub.add_parser("run", help="run a row on a split, resuming where it stopped")
    r.add_argument("--engine", required=True, choices=ENGINES)
    r.add_argument("--row", help="the row's name (default from the engine, model and shots)")
    split_args(r)
    r.add_argument("--shots", type=int, default=0, choices=[0, 3], help="0, or the 3 fixed train examples")
    r.add_argument("--limit", type=int, help="run at most this many prompts now (the rest on a later run)")
    r.add_argument("--tiers", help="only these tiers, e.g. t1,t3 (a row keeps the tiers it began with)")
    r.add_argument("--model", help="local: model folder; gemini: model id; claude-code: model name")
    r.add_argument("--adapter", help="local: a trained LoRA adapter folder")
    r.add_argument("--max-tokens", type=int, default=1024)
    r.add_argument("--temperature", type=float, default=0.0)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--rpm", type=float, default=10.0, help="gemini: requests per minute")
    r.add_argument("--retries", type=int, default=4, help="gemini: times to send a request again that got no answer")
    r.add_argument("--effort", help="claude-code: effort level")
    r.add_argument("--workers", type=int, default=4, help="compiles at the same time while scoring")
    r.add_argument("--no-slider-ends", action="store_true", help="skip compiling at both ends of every slider")

    s = sub.add_parser("summarize", help="write the summary again from the saved records")
    s.add_argument("--row", required=True)
    split_args(s)

    rs = sub.add_parser("rescore", help="score the saved answers again with the current scorer")
    rs.add_argument("--row", required=True)
    split_args(rs)
    rs.add_argument("--workers", type=int, default=4)

    c = sub.add_parser("compare", help="two rows on the same prompts")
    c.add_argument("a")
    c.add_argument("b")
    split_args(c)

    f = sub.add_parser("fewshot", help="show the fixed few-shot examples")
    f.add_argument("--sets", type=Path, default=SETS)
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if hasattr(args, "split"):
            # before anything else: no engine is started and no file is read for a closed split
            check_open(args.split, args.final)
        if args.command == "run":
            from gkod_bench.run import run_row

            tiers = tuple(t.strip() for t in args.tiers.split(",")) if args.tiers else None
            engine = make_engine(args)
            try:
                summary = run_row(
                    engine,
                    args.row or default_row(args),
                    args.split,
                    final=args.final,
                    shots=args.shots,
                    limit=args.limit,
                    tiers=tiers,
                    results=args.results,
                    sets_dir=args.sets,
                    workers=args.workers,
                    slider_ends=not args.no_slider_ends,
                )
            finally:
                engine.close()
            print(headline(summary))
        elif args.command == "summarize":
            from gkod_bench.run import summarize_row

            print(headline(summarize_row(args.row, args.split, final=args.final, results=args.results, sets_dir=args.sets)))
        elif args.command == "rescore":
            from gkod_bench.run import rescore_row

            print(headline(rescore_row(args.row, args.split, final=args.final, results=args.results, sets_dir=args.sets, workers=args.workers)))
        elif args.command == "compare":
            from gkod_bench.compare import compare_rows, table

            print(table(compare_rows(args.a, args.b, args.split, final=args.final, results=args.results)))
        elif args.command == "fewshot":
            for task in ("create", "edit"):
                _, record = fewshot(task, sets_dir=args.sets)
                print(json.dumps({task: record}))
    except SplitClosed:
        print(FROZEN, file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Stopped. Every finished prompt is saved; run the same command again to go on.", file=sys.stderr)
        return 130
    return 0


def headline(summary: dict) -> str:
    o = summary.get("overall")
    head = f"{summary['row']} on {summary['split']}: {summary['done']} of {summary['prompts']} prompts scored"
    if not o:
        return head
    def pct(r: dict) -> str:
        if r["rate"] is None:
            return "n/a"
        return f"{r['rate']:.1%} [{r['ci95'][0]:.1%}, {r['ci95'][1]:.1%}]"
    lines = [
        head,
        f"  compiles      {pct(o['compiles'])}",
        f"  print checks  {pct(o['checks_pass'])}",
        f"  meets request {pct(o['meets_request'])} ({o['meets_request']['prompts_with_nothing_measured']} with nothing measured)",
        f"  iou           {o['iou']['mean']:.3f} mean",
    ]
    for tier, g in summary["tiers"].items():
        extra = f", sizes kept {pct(g['edit_sizes_ok'])}" if "edit_sizes_ok" in g else ""
        lines.append(f"  {tier:5} compiles {pct(g['compiles'])}, meets {pct(g['meets_request'])}{extra}")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
