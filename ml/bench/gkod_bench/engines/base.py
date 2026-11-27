"""What every engine adapter gives back: the answer text (or why there is none) and how it was made."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from gkod_bench.prompts import Messages


@dataclass
class Answer:
    # None when the engine gave no answer for a reason that passes (a network failure, a rate or usage limit, a busy
    # server, a crash): such a prompt is not done, and a later run tries it again. An engine that turns the prompt
    # down, runs out of time or turns, or ends without a result has answered: text is "" and `error` says why, so the
    # prompt scores as no code and counts in every rate, the same for every row.
    text: str | None
    seconds: float
    error: str | None = None
    meta: dict = field(default_factory=dict)


class Engine(Protocol):
    # a short name for the engine kind: local, gemini, claude-code
    kind: str
    # single-shot rows give one answer per prompt; the with-tools row may compile and check before it answers
    with_tools: bool

    def settings(self) -> dict:
        """Everything that decides the answers: model, revision, decoding, limits. Saved with the row, and a resumed
        row must have the same settings."""
        ...

    def answer(self, messages: Messages) -> Answer: ...

    def close(self) -> None: ...
