"""Which training checkpoints to keep: the last two and the one with the lowest validation loss.

mlx-lm's LoRA trainer writes `0000200_adapters.safetensors` every --save-every steps (plus `adapters.safetensors`, the
latest) and prints a validation line every --steps-per-eval steps: `  200    val 1.234    3.21s` in mlx-lm 0.32 (with
colour codes), `Iter 200: Val loss 1.234, ...` in older versions. A trainer can also append `{"step": 200, "val_loss":
1.234}` lines to `val_loss.jsonl` in the checkpoint folder. A checkpoint's loss is the one reported at its own step, so
set --save-every to the same number as --steps-per-eval. A checkpoint with no loss at its step is never picked as the
best; it is kept only while it is one of the last two.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

CHECKPOINT = re.compile(r"^(\d+)_adapters\.safetensors$")
NUMBER = r"([0-9]+(?:\.[0-9]+)?(?:[eE][-+]?\d+)?|nan|inf)"
VAL_LINES = (
    re.compile(r"^\s*(\d+)\s+val\s+" + NUMBER + r"\s+[0-9.]+s\s*$"),
    re.compile(r"\bIter (\d+): Val loss " + NUMBER),
)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
BEST_FILE = "best.json"
LOSS_FILE = "val_loss.jsonl"


@dataclass(frozen=True)
class Checkpoint:
    step: int
    path: Path


def find_checkpoints(folder: Path) -> list[Checkpoint]:
    """The step checkpoints in a folder, oldest first."""
    if not folder.is_dir():
        return []
    found = [Checkpoint(int(m.group(1)), p) for p in folder.iterdir() if (m := CHECKPOINT.match(p.name)) and p.is_file()]
    return sorted(found, key=lambda c: c.step)


def strip_ansi(text: str) -> str:
    return ANSI.sub("", text)


def read_val_loss(line: str) -> tuple[int, float] | None:
    """The step and validation loss from one line of trainer output, if the line has them."""
    text = strip_ansi(line).rstrip("\r\n")
    for pattern in VAL_LINES:
        if m := pattern.search(text):
            return int(m.group(1)), float(m.group(2))
    return None


def read_loss_file(folder: Path) -> dict[int, float]:
    """Losses a trainer wrote to val_loss.jsonl in the checkpoint folder; a broken line is skipped."""
    losses: dict[int, float] = {}
    path = folder / LOSS_FILE
    if not path.is_file():
        return losses
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
            losses[int(row["step"])] = float(row["val_loss"])
        except (ValueError, KeyError, TypeError):
            continue
    return losses


def best_checkpoint(checkpoints: list[Checkpoint], losses: dict[int, float]) -> Checkpoint | None:
    """The checkpoint with the lowest loss at its own step; the earlier one wins a tie. A NaN loss never wins."""
    scored = [c for c in checkpoints if c.step in losses and not math.isnan(losses[c.step])]
    return min(scored, key=lambda c: (losses[c.step], c.step)) if scored else None


def prune(folder: Path, losses: dict[int, float], keep_last: int = 2) -> dict:
    """Delete every step checkpoint except the last `keep_last` and the best, and write best.json.

    `adapters.safetensors`, `adapter_config.json` and any other file are never touched. Returns what was kept and
    deleted, for the log.
    """
    checkpoints = find_checkpoints(folder)
    best = best_checkpoint(checkpoints, losses)
    keep = {c.step for c in checkpoints[-keep_last:]} if keep_last > 0 else set()
    if best:
        keep.add(best.step)
    deleted = []
    for c in checkpoints:
        if c.step not in keep:
            c.path.unlink(missing_ok=True)
            deleted.append(c.step)
    if best:
        record = {"step": best.step, "val_loss": losses[best.step], "file": best.path.name}
        (folder / BEST_FILE).write_text(json.dumps(record, indent=2) + "\n")
    return {"kept": sorted(keep), "deleted": deleted, "best": best.step if best else None}


def latest_checkpoint(folder: Path) -> Path | None:
    """The newest step checkpoint, to resume from after a crash."""
    checkpoints = find_checkpoints(folder)
    return checkpoints[-1].path if checkpoints else None
