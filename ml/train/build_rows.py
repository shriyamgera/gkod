"""Training rows for mlx-lm, from the frozen v1 train split only.

    ml/.venv/bin/python ml/train/build_rows.py --config ml/configs/run1-insurance.toml [--rows N] [--batch-size N] \
        --out data/train-rows/run1-insurance

Writes three files to --out:

- train.jsonl: one chat row a line, {"messages": [system, user, assistant]}. The system prompt and the user words are
  the site's own, read at run time from app/src/engine/prompts.ts through `gkod batch` (as the benchmark reads them),
  so the wording cannot drift. The assistant answer is the generator's code in one openscad block, the way the site
  reads an answer.
- valid.jsonl: the fixed validation rows (100 train rows no run trains on; never dev rows).
- meta.json: the row ids in file order with their token counts, the sha256 of every file read, the generator
  commits, the tokenizer, the selection report and every refusal with its reason.

A row is refused when it is not a train row, has no generator provenance or was made by a dirty generator, has a
failed or missing label, has a tree whose hash is in dev, shares text with the site's examples (app/src/examples/
*.scad), or is longer than the token limit (the whole chat, counted with the model's own tokenizer, on the CPU). Any
path under data/sets/v1/test is refused before it is opened.

Row order: mlx-lm 0.32.2 sorts rows by `CacheDataset.itemlen`, which for chat rows is the length of the row's dict
(1 key), so every row ties and batches are runs of `batch_size` rows in file order. This file is therefore written in
length buckets one batch long: rows sorted by token count (ties by a seeded hash), cut into batches, and the batches
put in a seeded order. Same inputs, same bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
if str(ML) not in sys.path:
    sys.path.insert(0, str(ML))

from gkod_bench.data import load_split, sha256_file, verify  # noqa: E402
from gkod_bench.paths import REPO, SETS, SETS_HASHES  # noqa: E402
from gkod_bench.prompts import answer_of, request_of  # noqa: E402

from train.config import canonical_sha256, display, load_config, repo_path  # noqa: E402
from train.selection import group_of, groups_from_config, order_key, pick_rows, pick_valid  # noqa: E402

FORMAT = "gkod-train-rows/1"
EXAMPLES = REPO / "app" / "src" / "examples"
PROMPTS_TS = REPO / "app" / "src" / "engine" / "prompts.ts"
TASKS = ("create", "edit")
GENERATOR = "gkod-datagen"
COMMIT = re.compile(r"^[0-9a-f]{40}$")
# A row shares text with an example when this many lines in a row (blank lines skipped, spaces trimmed) are the same.
# Shorter runs are common generic lines ("}", "difference() {", "/* [Hidden] */"); on 27 Nov no v1 train row shared
# even 4 such lines with any example, and 3-line matches were only braces and "difference() { union() {".
EXAMPLE_WINDOW = 4
# Paths the build reads, by commit, for the meta's builder record.
BUILD_PATHS = ("ml/train", "ml/configs", "ml/bench/gkod_bench", "app/src/engine/prompts.ts", "datagen/src/splits/tokens.ts", "tools/src/batch.ts")

# Refusal reasons, as they appear in meta.json.
NOT_TRAIN = "not a train row"
NO_PROVENANCE = "no generator provenance"
DIRTY = "made by a dirty generator"
LABEL_MISSING = "a label is missing"
LABEL_FAILED = "a failed label"
NO_TREE = "no tree hash"
DEV_TREE = "its tree is in dev"
EXAMPLE_TEXT = "text from the site's examples"
TOO_LONG = "over the token limit"


class TestSplitRefused(PermissionError):
    pass


def test_dirs(sets_dir: Path) -> list[Path]:
    return [(Path(sets_dir) / "test").resolve(), (SETS / "test").resolve()]


def refuse_test_path(path: Path, sets_dir: Path = SETS) -> None:
    """Refuses any path under a test split folder, before anything opens it: data/sets/v1/test, <sets>/test, and
    any folder named `test` next to a `train` or `dev` folder. Links are followed first."""
    resolved = Path(path).resolve()
    for folder in test_dirs(sets_dir):
        if resolved == folder or resolved.is_relative_to(folder):
            raise TestSplitRefused(f"{path} is under the test split ({display(folder)}). Training never reads it.")
    for folder in (resolved, *resolved.parents):
        if folder.name == "test" and ((folder.parent / "train").is_dir() or (folder.parent / "dev").is_dir()):
            raise TestSplitRefused(f"{path} is under a test split folder ({display(folder)}). Training never reads it.")


# The guards


def provenance_problem(gen) -> str | None:
    if not isinstance(gen, dict) or gen.get("name") != GENERATOR or not isinstance(gen.get("commit"), str) or not COMMIT.match(gen["commit"]):
        return NO_PROVENANCE
    if gen.get("dirty") is not False:
        return DIRTY
    return None


REQUIRED_LABELS = {
    "create": (("compile", "ok"), ("checks", "ok"), ("params_ok",), ("facts_ok",)),
    "edit": (("compile", "ok"), ("checks", "ok"), ("params_ok",), ("facts_ok",), ("a_compile_ok",), ("sizes_ok",)),
}


def _failed_anywhere(value) -> bool:
    """Any `ok` or `..._ok` key under the labels that is not true."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if (key == "ok" or key.endswith("_ok")) and isinstance(inner, bool) and inner is not True:
                return True
            if _failed_anywhere(inner):
                return True
    elif isinstance(value, list):
        return any(_failed_anywhere(v) for v in value)
    return False


def label_problem(task: str, labels) -> str | None:
    if not isinstance(labels, dict):
        return LABEL_MISSING
    for path in REQUIRED_LABELS[task]:
        value = labels
        for key in path:
            value = value.get(key) if isinstance(value, dict) else None
        if value is None:
            return LABEL_MISSING
        if value is not True:
            return LABEL_FAILED
    return LABEL_FAILED if _failed_anywhere(labels) else None


def trees_of(task: str, row: dict) -> list:
    if task == "create":
        return [row.get("tree_sha256")]
    return [(row.get("a") or {}).get("tree_sha256"), (row.get("b") or {}).get("tree_sha256")]


def row_problem(task: str, row: dict, dev_trees: set[str]) -> str | None:
    """Why a train row cannot be a training row, or None. The token limit and the example text are checked after
    the row is worded."""
    if row.get("split") != "train" or (task == "edit" and row.get("source_tier") != "train"):
        return NOT_TRAIN
    gens = [row.get("generator")] + ([(row.get("source") or {}).get("generator")] if task == "edit" else [])
    for gen in gens:
        if problem := provenance_problem(gen):
            return problem
    if problem := label_problem(task, row.get("labels")):
        return problem
    trees = trees_of(task, row)
    if any(not isinstance(t, str) or not t for t in trees):
        return NO_TREE
    if any(t in dev_trees for t in trees):
        return DEV_TREE
    return None


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def example_windows(examples_dir: Path = EXAMPLES) -> tuple[set[tuple[str, ...]], dict[str, str]]:
    """Every run of EXAMPLE_WINDOW lines in the site's example files (a shorter file counts whole), and each file's
    sha256."""
    windows: set[tuple[str, ...]] = set()
    files = {}
    for path in sorted(Path(examples_dir).glob("*.scad")):
        text = path.read_text()
        files[path.name] = hashlib.sha256(text.encode()).hexdigest()
        lines = _lines(text)
        if 0 < len(lines) < EXAMPLE_WINDOW:
            windows.add(tuple(lines))
        for i in range(len(lines) - EXAMPLE_WINDOW + 1):
            windows.add(tuple(lines[i : i + EXAMPLE_WINDOW]))
    if not files:
        raise FileNotFoundError(f"no example files in {examples_dir}; the example check needs them")
    return windows, files


def shares_example_text(text: str, windows: set[tuple[str, ...]]) -> bool:
    lines = _lines(text)
    for size in {len(w) for w in windows}:
        for i in range(len(lines) - size + 1):
            if tuple(lines[i : i + size]) in windows:
                return True
    return False


# Words and tokens


def word_rows(gkod, items: list[tuple[str, dict]]) -> tuple[str, list[tuple[str, str]]]:
    """The site's system prompt, and the user words and the fenced answer for each row, from `gkod batch`."""
    jobs = [{"op": "prompt", "request": request_of(task, row), "answer": answer_of(task, row)} for task, row in items]
    replies = gkod.run(jobs)
    systems = set()
    out = []
    for (task, row), reply in zip(items, replies):
        if "system" not in reply or "answer" not in reply:
            raise RuntimeError(f"gkod batch could not word {row.get('id')}: {reply.get('error')}")
        systems.add(reply["system"])
        out.append((reply["user"], reply["answer"]))
    if len(systems) > 1:
        raise RuntimeError("the site gave more than one system prompt")
    return (systems.pop() if systems else ""), out


def chat(system: str, user: str, answer: str) -> list[dict]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user}, {"role": "assistant", "content": answer}]


def count_tokens(tokenizer, messages: list[dict]) -> tuple[int, int]:
    """(prompt tokens, all tokens) exactly as mlx-lm 0.32.2's ChatDataset.process with mask_prompt counts them: the
    whole chat through the chat template, and the chat without the answer plus the assistant opening."""
    total = len(tokenizer.apply_chat_template(messages, tools=None, return_dict=False))
    prompt = len(tokenizer.apply_chat_template(messages[:-1], tools=None, add_generation_prompt=True, return_dict=False))
    return prompt, total


def load_tokenizer(model_dir: Path):
    """The model's tokenizer as mlx-lm loads it for training (no weights are read)."""
    from mlx_lm.utils import load_tokenizer as mlx_load_tokenizer

    return mlx_load_tokenizer(Path(model_dir))


def tokenizer_record(model_dir: Path) -> dict:
    record = {"model": Path(model_dir).name}
    for name in ("tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt"):
        path = Path(model_dir) / name
        if path.is_file():
            record[name] = sha256_file(path)
    return record


# Order


def padded(length: int, max_seq_length: int) -> int:
    """The width mlx-lm pads a batch to: one more than the next multiple of 32, at most max_seq_length."""
    return min(1 + 32 * ((length + 31) // 32), max_seq_length)


def bucket_order(ids: list[str], lengths: dict[str, int], batch_size: int, salt: str, longest_first: bool = False) -> list[str]:
    """Rows sorted by length (ties by sha256(id + salt)), cut into batches of batch_size, the batches in a seeded
    order (or longest first, for the memory probe)."""
    rows = sorted(ids, key=lambda i: (lengths[i], order_key(i, salt)))
    batches = [rows[i : i + batch_size] for i in range(0, len(rows), batch_size)]
    if longest_first:
        batches.sort(key=lambda b: (-max(lengths[i] for i in b), order_key("|".join(b), salt)))
    else:
        batches.sort(key=lambda b: order_key("|".join(b), salt))
    return [i for b in batches for i in b]


def token_summary(ids: list[str], tokens: dict[str, tuple[int, int]], batch_size: int, max_seq_length: int) -> dict:
    prompt = sum(tokens[i][0] for i in ids)
    total = sum(tokens[i][1] for i in ids)
    batches = [ids[k : k + batch_size] for k in range(0, len(ids), batch_size)]
    padded_total = sum(len(b) * padded(max(tokens[i][1] for i in b), max_seq_length) for b in batches)
    return {
        "prompt": prompt,
        "answer": total - prompt,
        "total": total,
        "longest": max((tokens[i][1] for i in ids), default=0),
        "padded_total": padded_total,
        "batches": len(batches),
    }


def git_commit(paths: tuple[str, ...] = BUILD_PATHS) -> str:
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", *paths], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    return f"{head}{' (uncommitted changes)' if dirty else ''}" if head else "unknown"


# The build


def read_train(sets_dir: Path, hashes: Path, check_hashes: bool) -> tuple[list[tuple[str, dict]], dict[str, str]]:
    items: list[tuple[str, dict]] = []
    files = {}
    for task in TASKS:
        name = f"train/{task}.jsonl"
        path = Path(sets_dir) / name
        refuse_test_path(path, sets_dir)
        files[name] = verify(Path(sets_dir), name, hashes) if check_hashes else sha256_file(path)
        with path.open() as f:
            items += [(task, json.loads(line)) for line in f if line.strip()]
    return items, files


def read_dev_trees(sets_dir: Path, hashes: Path, check_hashes: bool) -> tuple[set[str], dict[str, str]]:
    for task in TASKS:
        refuse_test_path(Path(sets_dir) / f"dev/{task}.jsonl", sets_dir)
    items, files = load_split("dev", sets_dir=Path(sets_dir), hashes=hashes, check_hashes=check_hashes)
    trees = set()
    for item in items:
        trees.update(t for t in trees_of(item.task, item.row) if t)
    return trees, files


def build(
    config: dict,
    rows: int,
    out: Path,
    batch_size: int,
    *,
    tokenizer,
    gkod,
    sets_dir: Path = SETS,
    hashes: Path = SETS_HASHES,
    examples_dir: Path = EXAMPLES,
    check_hashes: bool = True,
    longest_first: bool = False,
    tokenizer_info: dict | None = None,
    log=print,
) -> dict:
    out = Path(out)
    refuse_test_path(out, sets_dir)
    if out.resolve().is_relative_to(Path(sets_dir).resolve()):
        raise ValueError(f"--out must not be inside the frozen sets ({display(Path(sets_dir))})")
    train_cfg = config.get("train", {})
    rows_cfg = config.get("rows", {})
    valid_cfg = config.get("valid", {})
    effective = int(train_cfg.get("effective_batch", 8))
    max_tokens = int(rows_cfg.get("max_tokens", 2048))
    max_seq_length = int(train_cfg.get("max_seq_length", 2048))
    if max_tokens > max_seq_length:
        raise ValueError(f"rows.max_tokens ({max_tokens}) is over train.max_seq_length ({max_seq_length}); mlx-lm would cut such rows")
    if batch_size < 1 or effective % batch_size:
        raise ValueError(f"--batch-size must divide the effective batch ({effective})")
    salt = rows_cfg.get("salt")
    if not salt or not valid_cfg.get("salt"):
        raise ValueError("the config needs rows.salt and valid.salt")

    items, train_files = read_train(sets_dir, hashes, check_hashes)
    ids = [row.get("id") for _, row in items]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        raise ValueError("the train split has missing or repeated row ids")
    dev_trees, dev_files = read_dev_trees(sets_dir, hashes, check_hashes)
    windows, example_files = example_windows(examples_dir)
    log(f"read {len(items)} train rows and {len(dev_trees)} dev trees")

    refused: dict[str, list[str]] = {}
    kept: list[tuple[str, dict]] = []
    for task, row in items:
        if problem := row_problem(task, row, dev_trees):
            refused.setdefault(problem, []).append(row["id"])
        else:
            kept.append((task, row))

    system, worded = word_rows(gkod, kept)
    messages: dict[str, list[dict]] = {}
    tokens: dict[str, tuple[int, int]] = {}
    groups: dict[str, str] = {}
    for (task, row), (user, answer) in zip(kept, worded):
        rid = row["id"]
        if shares_example_text(user, windows) or shares_example_text(answer, windows):
            refused.setdefault(EXAMPLE_TEXT, []).append(rid)
            continue
        msgs = chat(system, user, answer)
        prompt, total = count_tokens(tokenizer, msgs)
        if total > max_tokens:
            refused.setdefault(TOO_LONG, []).append(rid)
            continue
        messages[rid] = msgs
        tokens[rid] = (prompt, total)
        groups[rid] = group_of(task, row)
    log(f"{len(messages)} rows pass every check; refused: " + (", ".join(f"{k} {len(v)}" for k, v in sorted(refused.items())) or "none"))

    candidates: dict[str, list[str]] = {}
    for rid, group in groups.items():
        candidates.setdefault(group, []).append(rid)
    valid_ids = pick_valid(candidates, int(valid_cfg.get("create", 75)), int(valid_cfg.get("edit", 25)), valid_cfg["salt"])
    taken = set(valid_ids)
    open_rows = {g: [i for i in v if i not in taken] for g, v in candidates.items()}
    families = sorted({g.split(":", 1)[1] for g in candidates if g.startswith("create:")})
    weighted = groups_from_config(rows_cfg, families)
    train_ids, report = pick_rows(open_rows, weighted, rows, salt, effective)
    if taken & set(train_ids):
        raise AssertionError("a validation row was picked for training")

    train_order = bucket_order(train_ids, {i: tokens[i][1] for i in train_ids}, batch_size, salt, longest_first)
    valid_order = bucket_order(valid_ids, {i: tokens[i][1] for i in valid_ids}, batch_size, valid_cfg["salt"])

    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, order in (("train.jsonl", train_order), ("valid.jsonl", valid_order)):
        text = "".join(json.dumps({"messages": messages[i]}, ensure_ascii=False) + "\n" for i in order)
        (out / name).write_text(text, encoding="utf-8")
        files[name] = hashlib.sha256(text.encode("utf-8")).hexdigest()

    commits = sorted(
        {row["generator"]["commit"] for task, row in kept if row["id"] in messages}
        | {row["source"]["generator"]["commit"] for task, row in kept if task == "edit" and row["id"] in messages}
    )
    meta = {
        "format": FORMAT,
        "name": config.get("name"),
        "method": config.get("method"),
        "config": {"files": config.get("files", []), "rows": rows_cfg, "valid": valid_cfg, "sha256": canonical_sha256({"rows": rows_cfg, "valid": valid_cfg})},
        "asked_rows": rows,
        "batch_size": batch_size,
        "effective_batch": effective,
        "max_tokens": max_tokens,
        "max_seq_length": max_seq_length,
        "order": "longest first (probe only)" if longest_first else "length buckets one batch long, seeded",
        "sources": {**train_files, **dev_files},
        "hashes_file": {"file": display(Path(hashes)), "sha256": sha256_file(Path(hashes))},
        "examples": example_files,
        "generator_commits": commits,
        "system_sha256": hashlib.sha256(system.encode()).hexdigest(),
        "prompts_ts_sha256": sha256_file(PROMPTS_TS) if PROMPTS_TS.is_file() else None,
        "tokenizer": tokenizer_info or {},
        "builder_commit": git_commit(),
        "refused": {k: len(v) for k, v in sorted(refused.items())},
        "refused_ids": {k: sorted(v) for k, v in sorted(refused.items())},
        "candidates": {g: len(v) for g, v in sorted(candidates.items())},
        "selection": report,
        "files": files,
    }
    for name, order in (("train", train_order), ("valid", valid_order)):
        meta[name] = {
            "rows": len(order),
            "groups": {g: sum(1 for i in order if groups[i] == g) for g in sorted({groups[i] for i in order})},
            "tokens": token_summary(order, tokens, batch_size, max_seq_length),
            # one entry per row, in file order: [id, group, prompt tokens, answer tokens]
            "rows_detail": [[i, groups[i], tokens[i][0], tokens[i][1] - tokens[i][0]] for i in order],
        }
    (out / "meta.json").write_text(json.dumps(meta, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    t = meta["train"]["tokens"]
    log(
        f"wrote {len(train_order)} train rows ({t['total']:,} tokens, {t['answer']:,} answer tokens, padded {t['padded_total']:,}) "
        f"and {len(valid_order)} validation rows to {display(out)}"
    )
    if report["short"]:
        log("groups short of their share: " + ", ".join(f"{g} {n}" for g, n in report["short"].items()))
    return meta


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="build_rows", description="Build mlx-lm chat rows from the frozen v1 train split.")
    p.add_argument("--config", required=True, type=Path, help="a run config in ml/configs")
    p.add_argument("--rows", type=int, help="training rows (rounded down to whole updates); the config's [rows] count by default")
    p.add_argument("--batch-size", type=int, help="rows per forward pass, for the length buckets (the config's by default)")
    p.add_argument("--out", required=True, type=Path, help="folder for train.jsonl, valid.jsonl and meta.json")
    p.add_argument("--sets", type=Path, default=SETS, help="the frozen sets folder (data/sets/v1)")
    p.add_argument("--longest-first", action="store_true", help="put the longest batches first (for the memory probe only)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    for path in (args.sets / "train", args.sets / "dev", args.out):
        refuse_test_path(path, args.sets)
    config = load_config(args.config)
    rows = args.rows if args.rows is not None else config.get("rows", {}).get("count")
    if not rows:
        sys.stderr.write("build_rows: give --rows, or set [rows] count in the config\n")
        return 2
    batch_size = args.batch_size or int(config.get("train", {}).get("batch_size", 1))
    model_dir = repo_path(config["model"]["path"])
    from gkod_bench.gkod import Gkod

    tokenizer = load_tokenizer(model_dir)
    with Gkod(workers=1) as gkod:
        build(config, rows, repo_path(args.out), batch_size, tokenizer=tokenizer, gkod=gkod, sets_dir=args.sets, longest_first=args.longest_first, tokenizer_info=tokenizer_record(model_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
