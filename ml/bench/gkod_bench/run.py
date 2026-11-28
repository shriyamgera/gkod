"""Runs one row (an engine with its settings) on one split: every prompt through the engine once, every answer scored
by code, one record per prompt in results/raw/<row>/<split>/<id>.json, then results/<row>/<split>/summary.json.

A run resumes: prompts with a done record are skipped, so a crash, a stop or a --limit stage loses nothing. A
resumed row must have the same engine settings, few-shot examples, system prompt, set files and scoring settings as
when it began, and every record keeps the sha256 of the set file its prompt came from, so answers scored against two
versions of a set never mix in one summary. Prompts the
engine gave no answer for, for a reason that passes (a rate limit, a busy server, the network), are recorded as errors
and tried again by the next run. A prompt the engine turned down, or ran out of time or turns on, is an answer with no
code: it is scored, and counts in every rate.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from gkod_bench import __version__, ceiling
from gkod_bench.data import Item, check_open, fewshot, load_split
from gkod_bench.engines.base import Engine
from gkod_bench.gkod import Gkod
from gkod_bench.paths import REPO, RESULTS, SETS, SETS_HASHES
from gkod_bench.prompts import build
from gkod_bench.score import score_answer
from gkod_bench.subsets import Subset
from gkod_bench.summary import summarize

# settings that may differ between the stages of one row
VOLATILE = ("date", "cli_version")
MIN_FREE_BYTES = 5 * 1024**3


class RowMismatch(RuntimeError):
    pass


def say(line: str) -> None:
    """One progress line, flushed at once so a night log shows each prompt as it finishes."""
    print(line, flush=True)


def raw_dir(results: Path, row: str, split: str) -> Path:
    return results / "raw" / row / split


def row_dir(results: Path, row: str, split: str) -> Path:
    return results / row / split


def harness_source() -> dict:
    """The repo commit the harness ran from, and whether the harness or the site code had uncommitted changes."""
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=REPO, timeout=10).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "ml/bench", "tools", "app/src", "checks/src"], capture_output=True, text=True, cwd=REPO, timeout=10
        ).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        commit, dirty = "", ""
    return {"version": __version__, "commit": commit or None, "dirty": bool(dirty)}


def write_json(path: Path, data: dict) -> None:
    """Written to a temporary file and moved into place, so a crash never leaves half a record."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def read_records(results: Path, row: str, split: str) -> list[dict]:
    folder = raw_dir(results, row, split)
    if not folder.exists():
        return []
    out = []
    for path in sorted(folder.glob("*.json")):
        try:
            out.append(json.loads(path.read_text()))
        except json.JSONDecodeError:
            continue
    return out


def done_ids(results: Path, row: str, split: str) -> set[str]:
    return {r["id"] for r in read_records(results, row, split) if r.get("status") == "done"}


def _comparable(settings: dict) -> dict:
    return {k: v for k, v in settings.items() if k not in VOLATILE}


def _check_same_row(path: Path, config: dict) -> None:
    if not path.exists():
        return
    before = json.loads(path.read_text())
    for key in ("engine", "shots", "system_sha256", "tiers", "subset", "data", "scoring"):
        a, b = before.get(key), config.get(key)
        if key == "engine":
            a, b = _comparable(a), _comparable(b)
        if key == "data":
            # the folder may move; the files' sha256 may not
            a, b = (a or {}).get("files"), (b or {}).get("files")
        if a != b:
            raise RowMismatch(f"Row {config['row']} was started with other {key} settings ({a} then, {b} now). Use a new --row name.")


def _check_same_files(config: dict, files: dict) -> None:
    """A row's answers were scored against the set files it began with; summarising or scoring them again against
    other files would mix two sets."""
    if config.get("data", {}).get("files") != files:
        raise RowMismatch(
            f"The set's files changed since row {config['row']} began ({config.get('data', {}).get('files')} then, {files} now), "
            "so its answers do not belong to these prompts. Use a new --row name."
        )


def _current(records: list[dict], files: dict) -> list[dict]:
    """The records whose prompt came from these set files (a record from another version of the set is left out)."""
    return [r for r in records if r.get("data_sha256") is None or r["data_sha256"] == files.get(f"{r['split']}/{r['task']}.jsonl")]


def expected_of(items: list[Item]) -> list[dict]:
    return [{"id": i.id, "tier": i.tier, "family": i.family} for i in items]


def write_summary(results: Path, row: str, split: str, items: list[Item], config: dict, files: dict) -> dict:
    # the split's guess ceiling, if it has been worked out (summarize and rescore do it once per split)
    saved = ceiling.load(results, split, files)
    summary = summarize(_current(read_records(results, row, split), files), expected_of(items), config, saved)
    write_json(row_dir(results, row, split) / "summary.json", summary)
    return summary


def run_row(
    engine: Engine,
    row: str,
    split: str,
    *,
    final: bool = False,
    shots: int = 0,
    limit: int | None = None,
    tiers: tuple[str, ...] | None = None,
    subset: Subset | None = None,
    results: Path = RESULTS,
    sets_dir: Path = SETS,
    hashes: Path = SETS_HASHES,
    workers: int = 4,
    slider_ends: bool = True,
    max_errors: int = 3,
    log: Callable[[str], None] = say,
) -> dict:
    """`subset` (a fixed list of dev prompt ids, see subsets.py) runs only those prompts; the row keeps the list."""
    check_open(split, final)
    if shots not in (0, 3):
        raise ValueError("Rows are zero-shot or use the 3 fixed examples.")
    if shots and engine.with_tools:
        raise ValueError("The with-tools row is zero-shot only.")
    items, files = load_split(split, final, sets_dir, hashes)
    if tiers:
        items = [i for i in items if i.tier in tiers]
    if subset is not None:
        items = subset.pick(items, split, files)
    shot_rows, shot_record = {}, None
    if shots:
        shot_record = {}
        for task in ("create", "edit"):
            shot_rows[task], shot_record[task] = fewshot(task, sets_dir, hashes)

    config_path = row_dir(results, row, split) / "run.json"
    done = done_ids(results, row, split)
    todo = [i for i in items if i.id not in done]
    if limit is not None:
        todo = todo[:limit]

    with Gkod(workers=workers) as gkod:
        messages = build(gkod, todo or items[:1], shot_rows)
        any_messages = next(iter(messages.values()))
        config = {
            "row": row,
            "split": split,
            "engine": engine.settings(),
            "with_tools": engine.with_tools,
            "shots": shot_record,
            "system_sha256": any_messages.record()["system_sha256"],
            "tiers": list(tiers) if tiers else None,
            "subset": subset.record() if subset is not None else None,
            "data": {"dir": str(sets_dir.relative_to(REPO)) if sets_dir.is_relative_to(REPO) else str(sets_dir), "files": files},
            "scoring": {"printer": gkod.printer, "size_tolerance_mm": 0.5, "slider_ends": slider_ends, "compile_limit_s": 10},
            "harness": harness_source(),
        }
        _check_same_row(config_path, config)
        if not config_path.exists():
            write_json(config_path, {**config, "started": datetime.now(UTC).isoformat(timespec="seconds")})
        log(f"{row} on {split}: {len(done)} done before, {len(todo)} to run now, {len(items)} in all")

        errors_in_a_row = failures_in_a_row = 0
        for n, item in enumerate(todo, 1):
            if shutil.disk_usage(results.parent if not results.exists() else results).free < MIN_FREE_BYTES:
                log("Stopping: less than 5 GB of disk is free.")
                break
            msgs = messages[item.id]
            answer = engine.answer(msgs)
            record = {
                "id": item.id,
                "row": row,
                "split": split,
                "task": item.task,
                "tier": item.tier,
                "family": item.family,
                "held_out_pair": item.row.get("held_out_pair"),
                "source_tier": item.row.get("source_tier"),
                "data_sha256": files[f"{split}/{item.task}.jsonl"],
                "prompt": msgs.record(),
                "answer": answer.text,
                "engine_error": answer.error,
                "engine_meta": answer.meta,
                "at": datetime.now(UTC).isoformat(timespec="seconds"),
                "harness": config["harness"],
            }
            path = raw_dir(results, row, split) / f"{item.id}.json"
            if answer.text is None:
                errors_in_a_row += 1
                write_json(path, {**record, "status": "error", "timings": {"engine_s": round(answer.seconds, 3)}})
                log(f"[{n}/{len(todo)}] {item.id} {item.tier}: no answer ({answer.error})")
                if errors_in_a_row >= max_errors:
                    log(f"Stopping: {errors_in_a_row} prompts in a row got no answer.")
                    break
                continue
            errors_in_a_row = 0
            scores = score_answer(gkod, item.row, item.task, answer.text, slider_ends=slider_ends)
            code = scores.pop("code")
            record.update(status="done", code=code, scores=scores, timings={"engine_s": round(answer.seconds, 3), "score_s": scores.pop("score_s")})
            write_json(path, record)
            log(_line(n, len(todo), item, scores, answer.seconds) + (f" [{answer.error}]" if answer.error else ""))
            failures_in_a_row = failures_in_a_row + 1 if answer.error else 0
            if failures_in_a_row >= max_errors:
                # every prompt turned down or timed out is more likely the setup than the model: stop and look
                log(f"Stopping: {failures_in_a_row} prompts in a row were turned down or ran out of time ({answer.error}). Check the engine's settings; they are scored as no code.")
                break
    return write_summary(results, row, split, items, config, files)


def _line(n: int, total: int, item: Item, s: dict, seconds: float) -> str:
    yes = lambda v: "yes" if v else ("-" if v is None else "no")  # noqa: E731
    extra = f" sizes {yes(s['edit']['sizes_ok'])}" if "edit" in s else ""
    return (
        f"[{n}/{total}] {item.id} {item.tier} {item.family}: compiles {yes(s['compiles'])}, checks {yes(s['checks_pass'])}, "
        f"sizes match {yes(s['stated_sizes_match'])}, iou {s['iou']:.2f}{extra}, right part {yes(s['right_part'])} ({seconds:.1f} s)"
    )


def summarize_row(row: str, split: str, *, final: bool = False, results: Path = RESULTS, sets_dir: Path = SETS, hashes: Path = SETS_HASHES) -> dict:
    """The summary again from the saved records, with no engine calls. The split's guess ceiling is worked out first if
    it has none yet (one compile or two per create prompt, once per split)."""
    check_open(split, final)
    config_path = row_dir(results, row, split) / "run.json"
    if not config_path.exists():
        raise FileNotFoundError(f"There is no row {row} on {split} in {results}.")
    config = json.loads(config_path.read_text())
    items, files = load_split(split, final, sets_dir, hashes)
    _check_same_files(config, files)
    ceiling.ensure(results, split, items, files, sets_dir=sets_dir, hashes=hashes)
    if config.get("tiers"):
        items = [i for i in items if i.tier in config["tiers"]]
    if config.get("subset"):
        ids = set(config["subset"]["ids"])
        items = [i for i in items if i.id in ids]
    return write_summary(results, row, split, items, config, files)


def rescore_row(row: str, split: str, *, final: bool = False, results: Path = RESULTS, sets_dir: Path = SETS, hashes: Path = SETS_HASHES, workers: int = 4, log: Callable[[str], None] = say) -> dict:
    """Scores every saved answer again with the current scorer (for a new measurer); the answers are not asked again."""
    check_open(split, final)
    config_path = row_dir(results, row, split) / "run.json"
    if not config_path.exists():
        raise FileNotFoundError(f"There is no row {row} on {split} in {results}.")
    config = json.loads(config_path.read_text())
    items, files = load_split(split, final, sets_dir, hashes)
    _check_same_files(config, files)
    by_id = {i.id: i for i in items}
    slider_ends = config.get("scoring", {}).get("slider_ends", True)
    with Gkod(workers=workers) as gkod:
        for record in _current(read_records(results, row, split), files):
            if record.get("status") != "done" or record["id"] not in by_id:
                continue
            item = by_id[record["id"]]
            scores = score_answer(gkod, item.row, item.task, record["answer"], slider_ends=slider_ends)
            scores.pop("code")
            record["timings"]["score_s"] = scores.pop("score_s")
            record["scores"] = scores
            record["rescored"] = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "harness": harness_source()}
            write_json(raw_dir(results, row, split) / f"{record['id']}.json", record)
    log(f"rescored {row} on {split}")
    return summarize_row(row, split, final=final, results=results, sets_dir=sets_dir, hashes=hashes)
