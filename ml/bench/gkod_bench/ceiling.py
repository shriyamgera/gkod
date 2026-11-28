"""The guess ceiling: how many create prompts a model could still get right if it guessed every size the request
leaves out.

A request states some of a part's named sizes; others (a tray's floor, a bracket's gussets) are never said, so even a
perfect model has to guess them, and its part then differs from the reference. For each create prompt the reference
code is compiled again with every unstated named size set to its train median, and compared with the reference by the
same overlap the answers get (best of 24 turns). The ceiling is the share of prompts where that guess still reaches
RIGHT_PART_IOU. It is not a hard limit: a model that guesses better than the median can beat it.

The guess for a size comes from the train split only (train/create.jsonl, hash checked): the median of that name over
train parts of the same family; for a family train does not have (tier 3), the median of that name over every train
part; then the median of its last two words (arm1_hole_d as hole_d). A name with none of these keeps the reference
value, so the ceiling leans high on those prompts; they are counted (`kept`). The guess is not clamped into the
reference's slider range: the generator builds each range around the true value, so clamping would leak it. The
median is the lower middle value when the count is even, so every guess is a value the generator really used.

The result is kept in results/ceiling/<split>.json with the sha256 of the files it came from, and worked out again
when they change. It reads only the split's own create rows, which the caller has already loaded through the split
guard, and the train file.
"""

from __future__ import annotations

import json
import re
import statistics
import tempfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from gkod_bench.data import Item, verify
from gkod_bench.gkod import Gkod
from gkod_bench.mesh import measure
from gkod_bench.paths import SETS, SETS_HASHES
from gkod_bench.score import RIGHT_PART_IOU
from gkod_bench.stl import read_stl
from gkod_bench.voxel import RESOLUTION, best_turn_iou

VERSION = 1
TRAIN = "train/create.jsonl"
# a named size as the generator writes it: `width = 80; // [50:1:160]`
NAMED_SIZE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9.]+)\s*;\s*//\s*\[[^\]]*\]", re.M)
# a stated count that fixes a named size under another name: n compartments are n - 1 dividers
ALIASES = {"compartment_count": "divider_count"}
METHOD = (
    "each create prompt's reference compiled again with every unstated named size at its train median (same family, "
    "else any family, else the name's last two words; else the reference value is kept), overlap with the reference "
    "best of 24 turns; the ceiling is the share at or above the right-part threshold"
)


def named_sizes(code: str) -> dict[str, float]:
    """The named sizes of generator code, before the hidden block."""
    head = code.split("/* [Hidden] */")[0]
    return {m[1]: float(m[2]) for m in NAMED_SIZE.finditer(head)}


def stated_names(facts: list[dict]) -> set[str]:
    keys = {f["key"] for f in facts}
    return keys | {ALIASES[k] for k in keys if k in ALIASES}


def train_medians(sets_dir: Path = SETS, hashes: Path = SETS_HASHES, check_hashes: bool = True) -> tuple[dict, str]:
    """{"family": {(family, name): median}, "name": {name: median}} from the train split, and the file's sha256."""
    digest = verify(sets_dir, TRAIN, hashes) if check_hashes else None
    by_family: dict = defaultdict(list)
    by_name: dict = defaultdict(list)
    with (sets_dir / TRAIN).open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("split") != "train":
                raise ValueError(f"{TRAIN} holds a row of the {row.get('split')!r} split ({row.get('id')}).")
            for name, value in named_sizes(row["code"]).items():
                by_family[(row["family"], name)].append(value)
                by_name[name].append(value)
    medians = {
        "family": {k: statistics.median_low(v) for k, v in by_family.items()},
        "name": {k: statistics.median_low(v) for k, v in by_name.items()},
    }
    return medians, digest


def guess(family: str, name: str, medians: dict) -> tuple[float | None, str | None]:
    """The train median for one unstated size, and where it came from."""
    if (family, name) in medians["family"]:
        return medians["family"][(family, name)], "family"
    if name in medians["name"]:
        return medians["name"][name], "any family"
    words = name.split("_")
    if len(words) > 2 and "_".join(words[-2:]) in medians["name"]:
        return medians["name"]["_".join(words[-2:])], "last two words"
    return None, None


def guesses(row: dict, names: list[str], medians: dict) -> tuple[dict, list[str]]:
    """{name: {"was", "guess", "from"}} for every unstated size that train can guess, and the names it cannot."""
    stated = stated_names(row["facts"])
    values = named_sizes(row["code"])
    out, kept = {}, []
    for name in names:
        if name in stated:
            continue
        value, source = guess(row["family"], name, medians)
        if value is None:
            kept.append(name)
        else:
            out[name] = {"was": values.get(name), "guess": value, "from": source}
    return out, kept


def compute(items: list[Item], medians: dict, gkod: Gkod) -> dict:
    """The guess and its overlap for every create prompt in `items`."""
    out = {}
    with tempfile.TemporaryDirectory(prefix="gkod-ceiling-") as tmp:
        ref_stl, guess_stl = Path(tmp) / "reference.stl", Path(tmp) / "guess.stl"
        for item in items:
            if item.task != "create":
                continue
            row = item.row
            ref = gkod.compile(row["code"], stl=ref_stl, check=False)
            if not ref.get("ok"):
                raise RuntimeError(f"the reference part of {row['id']} did not compile: {ref.get('error')}")
            # the compiler's own list of named sizes, as the site's sliders read them
            names = [p["name"] for p in ref.get("params") or []]
            guessed, kept = guesses(row, names, medians)
            entry = {"tier": item.tier, "family": item.family, "guessed": guessed, "kept": kept}
            if not guessed:
                entry.update(compiles=True, iou=1.0)
            else:
                made = gkod.compile(row["code"], defines={k: v["guess"] for k, v in guessed.items()}, stl=guess_stl, check=False)
                if not made.get("ok"):
                    entry.update(compiles=False, iou=0.0, error=made.get("error"))
                else:
                    ref_tri, guess_tri = read_stl(ref_stl), read_stl(guess_stl)
                    overlap = best_turn_iou(guess_tri, ref_tri)
                    a, b = measure(guess_tri), measure(ref_tri)
                    entry.update(
                        compiles=True,
                        iou=overlap["iou"] if overlap["iou"] is not None else 0.0,
                        same_pieces=a.shells == b.shells,
                        same_holes=a.holes == b.holes,
                    )
            out[row["id"]] = entry
    return out


def path_of(results: Path, split: str) -> Path:
    return results / "ceiling" / f"{split}.json"


def load(results: Path, split: str, files: dict) -> dict | None:
    """The saved ceiling for this split's create file, or None when there is none or the file has changed since."""
    path = path_of(results, split)
    if not path.exists():
        return None
    try:
        saved = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    name = f"{split}/create.jsonl"
    if saved.get("version") != VERSION or saved.get("voxel_resolution") != RESOLUTION or saved.get("files", {}).get(name) != files.get(name):
        return None
    return saved


def ensure(results: Path, split: str, items: list[Item], files: dict, *, sets_dir: Path = SETS, hashes: Path = SETS_HASHES, gkod: Gkod | None = None) -> dict:
    """The saved ceiling, or a new one worked out and saved. `items` must come from load_split, so the split guard has
    already run."""
    saved = load(results, split, files)
    if saved is not None:
        return saved
    from gkod_bench.run import write_json

    medians, train_sha = train_medians(sets_dir, hashes)
    if gkod is None:
        with Gkod() as own:
            prompts = compute(items, medians, own)
    else:
        prompts = compute(items, medians, gkod)
    name = f"{split}/create.jsonl"
    data = {
        "version": VERSION,
        "split": split,
        "method": METHOD,
        "voxel_resolution": RESOLUTION,
        "files": {name: files.get(name), TRAIN: train_sha},
        "made": datetime.now(UTC).isoformat(timespec="seconds"),
        "prompts": prompts,
    }
    write_json(path_of(results, split), data)
    return data


def share(saved: dict | None, ids: list[str], threshold: float = RIGHT_PART_IOU) -> dict | None:
    """How many of these create prompts' guesses reach the threshold, as (k, n), with how many kept a value train
    could not guess."""
    if saved is None:
        return None
    entries = [saved["prompts"][i] for i in ids if i in saved["prompts"]]
    return {
        "k": sum((e.get("iou") or 0.0) >= threshold for e in entries),
        "n": len(entries),
        "kept_a_true_value": sum(bool(e.get("kept")) for e in entries),
    }
