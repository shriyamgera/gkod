"""The frozen sets, as the benchmark reads them. The test split stays closed: nothing here opens a test file unless
it is called with final=True, which only the day 10 run passes (as --final)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from gkod_bench.paths import SETS, SETS_HASHES

FROZEN = "The test split is frozen until the final run. Only the final run passes --final to read it."
SPLITS = ("dev", "test")
TASKS = ("create", "edit")
TIERS = ("t1", "t2", "t3", "edit")

# The fixed few-shot examples, all from the train split. For each family (or edit kind), in this order, the first
# row of train/<task>.jsonl that fits: a part with exactly one feature; an edit whose code A is at most 40 lines.
# They are fixed by rule, not picked by how well they work, and their ids go into every few-shot row's record.
FEWSHOT_CREATE_FAMILIES = ("spacer", "plate", "bracket")
FEWSHOT_EDIT_KINDS = ("size", "add", "remove")
FEWSHOT_EDIT_MAX_LINES = 40


class SplitClosed(PermissionError):
    pass


@dataclass(frozen=True)
class Item:
    """One prompt of a split: a part to make (create) or a change to make (edit)."""

    id: str
    task: str
    tier: str
    family: str
    row: dict


def check_open(split: str, final: bool = False) -> None:
    """Refuses the test split without final; refuses anything that is not a benchmark split."""
    if split == "test" and final is not True:
        raise SplitClosed(FROZEN)
    if split not in SPLITS:
        raise ValueError(f"The benchmark scores the dev or test split, not {split!r}.")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def frozen_hashes(hashes: Path = SETS_HASHES) -> dict[str, str]:
    out = {}
    for line in hashes.read_text().splitlines():
        if line.strip():
            digest, name = line.split(maxsplit=1)
            out[name.strip()] = digest
    return out


def verify(sets_dir: Path, name: str, hashes: Path = SETS_HASHES) -> str:
    """The file's sha256, after checking it against the frozen list in the repo."""
    want = frozen_hashes(hashes).get(name)
    if want is None:
        raise ValueError(f"{name} is not in {hashes.name}.")
    got = sha256_file(sets_dir / name)
    if got != want:
        raise ValueError(f"{sets_dir / name} has sha256 {got}, not the frozen {want}. The set has changed; make it again.")
    return got


def _read_jsonl(path: Path) -> list[dict]:
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def order_key(item_id: str) -> str:
    """A fixed order that mixes the tiers, so a run cut short with --limit still covers every tier."""
    return hashlib.sha256(item_id.encode()).hexdigest()


def load_split(split: str, final: bool = False, sets_dir: Path = SETS, hashes: Path = SETS_HASHES, check_hashes: bool = True) -> tuple[list[Item], dict]:
    """Every prompt of a split in the fixed order, and the sha256 of each file read. The guard runs before any
    file is touched."""
    check_open(split, final)
    items: list[Item] = []
    files = {}
    for task in TASKS:
        name = f"{split}/{task}.jsonl"
        files[name] = verify(sets_dir, name, hashes) if check_hashes else sha256_file(sets_dir / name)
        for row in _read_jsonl(sets_dir / name):
            if row.get("split") != split:
                raise ValueError(f"{name} holds a row of the {row.get('split')!r} split ({row.get('id')}).")
            items.append(Item(id=row["id"], task=task, tier=row["tier"], family=row["family"], row=row))
    items.sort(key=lambda item: order_key(item.id))
    return items, files


def fewshot(task: str, sets_dir: Path = SETS, hashes: Path = SETS_HASHES, check_hashes: bool = True) -> tuple[list[dict], dict]:
    """The three fixed train examples for a task, and a record of where they came from."""
    name = f"train/{task}.jsonl"
    digest = verify(sets_dir, name, hashes) if check_hashes else sha256_file(sets_dir / name)
    rows = _read_jsonl(sets_dir / name)
    picked = []
    if task == "create":
        for family in FEWSHOT_CREATE_FAMILIES:
            picked.append(next(r for r in rows if r["family"] == family and len(r["tree"]["features"]) == 1))
    elif task == "edit":
        for kind in FEWSHOT_EDIT_KINDS:
            picked.append(next(r for r in rows if r["op"]["kind"] == kind and len(r["a"]["code"].splitlines()) <= FEWSHOT_EDIT_MAX_LINES))
    else:
        raise ValueError(f"unknown task {task!r}")
    for r in picked:
        if r.get("split") != "train":
            raise ValueError(f"few-shot example {r['id']} is not from the train split")
    record = {"file": name, "sha256": digest, "ids": [r["id"] for r in picked], "families": [r["family"] for r in picked]}
    return picked, record
