"""Which train rows a run uses. Rule, not judgement: nothing here looks at how well a row trains.

- Every row belongs to one group: `create:<family>` or `edit:<kind>`.
- The validation rows are picked first, by their own salt, the same for every run, so validation losses of different
  runs are comparable. They are never trained on.
- A run's config gives each group a weight. `--rows N` (rounded down to a whole number of updates) is shared out in
  proportion to the weights (largest remainder), and each group takes its first rows in the order of
  sha256(id + salt). So a smaller run is the first part of every group of a bigger one with the same salt.
- A group with fewer rows than its share gives all it has; the shortfall is reported, not filled from other groups.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from fractions import Fraction

EDIT_KINDS = ("size", "hole_d", "move", "count", "scale", "add", "remove")


def order_key(row_id: str, salt: str) -> str:
    return hashlib.sha256((row_id + salt).encode()).hexdigest()


def group_of(task: str, row: dict) -> str:
    if task == "create":
        return f"create:{row['family']}"
    if task == "edit":
        return f"edit:{row['op']['kind']}"
    raise ValueError(f"unknown task {task!r}")


@dataclass(frozen=True)
class Group:
    name: str
    weight: Fraction


def groups_from_config(rows_cfg: dict, families: list[str]) -> list[Group]:
    """The weighted groups of a run. `[rows.create]` takes family names, or "*" for every train family;
    `[rows.edit]` takes edit kinds. A group left out, or with weight 0, gets no rows."""
    create = dict(rows_cfg.get("create", {}))
    edit = dict(rows_cfg.get("edit", {}))
    unknown = sorted(k for k in create if k != "*" and k not in families)
    if unknown:
        raise ValueError(f"[rows.create] names families that are not in the train split: {', '.join(unknown)}")
    unknown = sorted(k for k in edit if k not in EDIT_KINDS)
    if unknown:
        raise ValueError(f"[rows.edit] names unknown edit kinds: {', '.join(unknown)} (kinds: {', '.join(EDIT_KINDS)})")
    groups = []
    for family in sorted(families):
        weight = create.get(family, create.get("*", 0))
        if weight < 0:
            raise ValueError(f"[rows.create] {family}: a weight cannot be negative")
        if weight:
            groups.append(Group(f"create:{family}", Fraction(weight)))
    for kind in sorted(edit):
        if edit[kind] < 0:
            raise ValueError(f"[rows.edit] {kind}: a weight cannot be negative")
        if edit[kind]:
            groups.append(Group(f"edit:{kind}", Fraction(edit[kind])))
    if not groups:
        raise ValueError("the config gives no group any weight")
    return groups


def quotas(groups: list[Group], total: int) -> dict[str, int]:
    """`total` shared out by weight: whole parts first, then one more for the largest remainders (ties to the group
    that comes first by name)."""
    weight = sum(g.weight for g in groups)
    exact = {g.name: total * g.weight / weight for g in groups}
    out = {name: int(value) for name, value in exact.items()}
    left = total - sum(out.values())
    by_remainder = sorted(exact, key=lambda name: (-(exact[name] - out[name]), name))
    for name in by_remainder[:left]:
        out[name] += 1
    return out


def pick_rows(candidates: dict[str, list[str]], groups: list[Group], total: int, salt: str, multiple: int) -> tuple[list[str], dict]:
    """The run's training rows, group by group, and a report of the shares. `total` is first rounded down to a
    multiple of `multiple` (rows per optimizer update); if a shortfall breaks that, rows come off the end of the
    biggest group until it holds again."""
    if total < multiple:
        raise ValueError(f"--rows must be at least {multiple} (one update)")
    rounded = total // multiple * multiple
    want = quotas(groups, rounded)
    picked: dict[str, list[str]] = {}
    short = {}
    for g in groups:
        ordered = sorted(candidates.get(g.name, []), key=lambda i: order_key(i, salt))
        picked[g.name] = ordered[: want[g.name]]
        if len(picked[g.name]) < want[g.name]:
            short[g.name] = want[g.name] - len(picked[g.name])
    trimmed: dict[str, int] = {}
    while sum(len(v) for v in picked.values()) % multiple:
        biggest = min(picked, key=lambda name: (-len(picked[name]), name))
        picked[biggest].pop()
        trimmed[biggest] = trimmed.get(biggest, 0) + 1
    rows = [i for g in groups for i in picked[g.name]]
    report = {
        "asked": total,
        "rounded_to": rounded,
        "multiple": multiple,
        "salt": salt,
        "weights": {g.name: float(g.weight) for g in groups},
        "quotas": want,
        "picked": {name: len(ids) for name, ids in picked.items()},
        "short": short,
        "trimmed": trimmed,
        "rows": len(rows),
    }
    return rows, report


def pick_valid(candidates: dict[str, list[str]], creates: int, edits: int, salt: str) -> list[str]:
    """The fixed validation rows: `creates` taken round-robin over the create groups (by name), then `edits` over
    the edit groups, each group in the order of sha256(id + salt)."""
    out = []
    for prefix, count in (("create:", creates), ("edit:", edits)):
        queues = [sorted(candidates[name], key=lambda i: order_key(i, salt)) for name in sorted(candidates) if name.startswith(prefix)]
        queues = [q for q in queues if q]
        taken = 0
        at = [0] * len(queues)
        while taken < count and any(at[k] < len(q) for k, q in enumerate(queues)):
            for k, q in enumerate(queues):
                if taken == count:
                    break
                if at[k] < len(q):
                    out.append(q[at[k]])
                    at[k] += 1
                    taken += 1
        if taken < count:
            raise ValueError(f"only {taken} {prefix[:-1]} rows can be validation rows, not {count}")
    return out
