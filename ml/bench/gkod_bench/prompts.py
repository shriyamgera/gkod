"""The messages every engine gets: the site's system prompt and the site's words for the request, read from the site's
own code through `gkod batch` (app/src/engine/prompts.ts). Few-shot rows put the fixed train examples first, as
earlier turns: the site's words for each example's request, then its code as one block, the way training rows
write their answers."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from gkod_bench.data import Item
from gkod_bench.gkod import Gkod


@dataclass(frozen=True)
class Messages:
    system: str
    # the turns in order (examples first, if any), ending with the request
    turns: list[dict] = field(default_factory=list)
    shots: tuple[str, ...] = ()

    @property
    def user(self) -> str:
        return self.turns[-1]["content"]

    def record(self) -> dict:
        return {
            "system_sha256": hashlib.sha256(self.system.encode()).hexdigest(),
            "user": self.user,
            "shots": list(self.shots),
            "turns": len(self.turns),
        }


def request_of(task: str, row: dict) -> dict:
    if task == "create":
        return {"kind": "create", "prompt": row["request"]}
    return {"kind": "edit", "instruction": row["instruction"], "code": row["a"]["code"]}


def answer_of(task: str, row: dict) -> str:
    return row["code"] if task == "create" else row["b"]["code"]


def build(gkod: Gkod, items: list[Item], shots: dict[str, list[dict]] | None = None) -> dict[str, Messages]:
    """Messages for every item, keyed by id. `shots` maps a task to its fixed examples (empty for zero-shot)."""
    shots = shots or {}
    jobs = [{"op": "prompt", "request": request_of(item.task, item.row)} for item in items]
    shot_jobs = {task: [{"op": "prompt", "request": request_of(task, r), "answer": answer_of(task, r)} for r in rows] for task, rows in shots.items()}
    flat = [j for js in shot_jobs.values() for j in js]
    replies = gkod.run(jobs + flat)
    for reply in replies:
        if "system" not in reply:
            raise RuntimeError(f"gkod batch could not word a prompt: {reply.get('error')}")
    systems = {r["system"] for r in replies}
    if len(systems) != 1:
        raise RuntimeError("the site gave more than one system prompt")
    system = systems.pop()
    shot_turns: dict[str, list[dict]] = {}
    at = len(jobs)
    for task, js in shot_jobs.items():
        turns = []
        for reply in replies[at : at + len(js)]:
            turns += [{"role": "user", "content": reply["user"]}, {"role": "assistant", "content": reply["answer"]}]
        shot_turns[task] = turns
        at += len(js)
    out = {}
    for item, reply in zip(items, replies[: len(jobs)]):
        ids = tuple(r["id"] for r in shots.get(item.task, []))
        out[item.id] = Messages(system=system, turns=[*shot_turns.get(item.task, []), {"role": "user", "content": reply["user"]}], shots=ids)
    return out
