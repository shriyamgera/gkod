"""Fixed subsets of the dev split, for learning curves: a list of prompt ids picked by a written, seeded rule, saved
in ml/bench/subsets/<name>.json with the sha256 of the dev files the ids were picked from. Dev only: there is no
subset of the test split, and nothing here opens a test file.

dev-curve (rule v1, seed "dev-curve-v1"), 50 of the 400 dev prompts:

1. Each tier is a quarter of dev, so each gets a quarter of the 50: t1 13, t2 12, t3 12, edit 13. Tiers 2 and 3 get
   12 because 12 splits their 4 and 3 families evenly.
2. Inside a tier, the prompts are sorted by their group, then by sha256("dev-curve-v1:" + id). The group is the family
   for t1, t2 and t3, and (edit kind, the tier of the part edited, family) for edits.
3. From the n prompts of a tier, the ones at places floor((i + 0.5) * n / quota) are taken, for i = 0 .. quota - 1.
   Every group then gets its share of the quota, rounded down or up, and inside a group the seeded order decides.

The first 50 prompts in the benchmark's own order (the earlier plan) had only 5 of tier 2, so a spread is picked
instead. The ids are kept in the benchmark's order (sha256 of the id), the order a row runs them in.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from gkod_bench.data import Item, load_split, order_key
from gkod_bench.paths import SETS, SETS_HASHES, SUBSETS

DEV_CURVE_SEED = "dev-curve-v1"
DEV_CURVE_QUOTAS = {"t1": 13, "t2": 12, "t3": 12, "edit": 13}
DEV_CURVE_RULE = (
    "Each tier gets a quarter of the 50: t1 13, t2 12, t3 12, edit 13 (12 splits the 4 and 3 families of tiers 2 and 3 "
    "evenly). Inside a tier the prompts are sorted by group, then by sha256('dev-curve-v1:' + id); the group is the "
    "family for t1, t2 and t3, and (edit kind, tier of the part edited, family) for edits. Of the n prompts of a tier, "
    "the ones at places floor((i + 0.5) * n / quota), i = 0 .. quota - 1, are taken, so every group gets its share of "
    "the quota rounded down or up."
)


class SubsetMismatch(ValueError):
    pass


@dataclass(frozen=True)
class Subset:
    name: str
    split: str
    ids: tuple[str, ...]
    # the sha256 of each split file the ids were picked from
    files: dict

    def record(self) -> dict:
        """What a row saves in its run.json, so summaries and resumes know the prompts without the subset file."""
        return {"name": self.name, "split": self.split, "files": dict(self.files), "ids": list(self.ids)}

    def pick(self, items: list[Item], split: str, files: dict) -> list[Item]:
        """The subset's prompts, in the order given (the benchmark's), after checking they come from the same files."""
        if split != self.split:
            raise SubsetMismatch(f"{self.name} is a subset of the {self.split} split, not {split}.")
        if files != self.files:
            raise SubsetMismatch(f"The {split} files changed since {self.name} was picked ({self.files} then, {files} now). Pick it again.")
        wanted = set(self.ids)
        picked = [i for i in items if i.id in wanted]
        if len(picked) != len(wanted):
            missing = sorted(wanted - {i.id for i in picked})
            raise SubsetMismatch(f"{len(missing)} ids of {self.name} are not in the {split} split: {missing[:5]}")
        return picked


def path_of(name: str, folder: Path = SUBSETS) -> Path:
    if not name or "/" in name or name.startswith("."):
        raise ValueError(f"not a subset name: {name!r}")
    return folder / f"{name}.json"


def load(name: str, folder: Path = SUBSETS) -> Subset:
    path = path_of(name, folder)
    if not path.is_file():
        raise FileNotFoundError(f"There is no subset {name} ({path}).")
    data = json.loads(path.read_text())
    if data.get("name") != name:
        raise SubsetMismatch(f"{path} holds the subset {data.get('name')!r}, not {name!r}.")
    if data.get("split") != "dev":
        raise SubsetMismatch(f"Subsets are of the dev split only; {path} names {data.get('split')!r}.")
    ids = tuple(data["ids"])
    if len(set(ids)) != len(ids):
        raise SubsetMismatch(f"{path} lists an id twice.")
    return Subset(name=name, split="dev", ids=ids, files=dict(data["files"]))


def _group(item: Item) -> tuple:
    if item.task == "edit":
        return (item.row["op"]["kind"], item.row.get("source_tier") or "", item.family)
    return (item.family,)


def _key(item_id: str, seed: str) -> str:
    return hashlib.sha256(f"{seed}:{item_id}".encode()).hexdigest()


def spread_pick(items: list[Item], quota: int, seed: str) -> list[Item]:
    """`quota` of the items, spread over their groups by the rule above (systematic picks over the sorted list)."""
    ordered = sorted(items, key=lambda i: (_group(i), _key(i.id, seed)))
    n = len(ordered)
    if quota > n:
        raise ValueError(f"cannot pick {quota} of {n} prompts")
    return [ordered[int((k + 0.5) * n / quota)] for k in range(quota)]


def choose_dev_curve(items: list[Item], quotas: dict = DEV_CURVE_QUOTAS, seed: str = DEV_CURVE_SEED) -> list[str]:
    """The dev-curve ids from the dev split's items, in the benchmark's order."""
    picked: list[Item] = []
    for tier, quota in quotas.items():
        picked += spread_pick([i for i in items if i.tier == tier], quota, seed)
    return [i.id for i in sorted(picked, key=lambda i: order_key(i.id))]


def spread_of(items: list[Item], ids: list[str]) -> dict:
    """How the picked ids spread over tiers, families and edit kinds (for the file and the printout)."""
    chosen = [i for i in items if i.id in set(ids)]
    out: dict = {}
    for tier in DEV_CURVE_QUOTAS:
        group = [i for i in chosen if i.tier == tier]
        entry = {"prompts": len(group), "families": _count(i.family for i in group)}
        if tier == "edit":
            entry["kinds"] = _count(i.row["op"]["kind"] for i in group)
            entry["tier_of_part"] = _count(i.row.get("source_tier") or "?" for i in group)
        out[tier] = entry
    return out


def _count(values) -> dict:
    counts: dict = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return dict(sorted(counts.items()))


def make_dev_curve(sets_dir: Path = SETS, hashes: Path = SETS_HASHES) -> dict:
    """The dev-curve file's contents, worked out again from the hash-checked dev files."""
    items, files = load_split("dev", False, sets_dir, hashes)
    ids = choose_dev_curve(items)
    return {
        "name": "dev-curve",
        "split": "dev",
        "rule_version": 1,
        "seed": DEV_CURVE_SEED,
        "rule": DEV_CURVE_RULE,
        "quotas": DEV_CURVE_QUOTAS,
        "files": files,
        "ids": ids,
        "spread": spread_of(items, ids),
    }


def write(data: dict, folder: Path = SUBSETS) -> Path:
    path = path_of(data["name"], folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) + "\n")
    return path
