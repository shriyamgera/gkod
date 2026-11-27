"""Gemini through the Interactions API, the way the site calls it (app/src/engine/gemini.ts): the same body (model,
system instruction, input, store false, thinking level low) and the same reading of the answer from the steps.

Differences from the site, on purpose: there is no fallback to another model (a row is one model), and a request
that got no answer (rate limit, busy, network) is sent again after a wait, since no answer was given; an answer,
once received, is final. A prompt the model turns down (400, after the try without the thinking setting) is an
answer with no code, so it counts against the row instead of dropping out of the rates. The key is read from .env when a request is sent and is never printed, logged or saved.
"""

from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from gkod_bench.engines.base import Answer
from gkod_bench.paths import ENV_FILE
from gkod_bench.prompts import Messages

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
DEFAULT_MODEL = "gemini-3.1-flash-lite"
TIMEOUT_S = 90
KEY_NAME = "GEMINI_API_KEY"


class GeminiStop(RuntimeError):
    """A failure that every later request would hit too, so the run stops."""


def read_key(env_file: Path = ENV_FILE) -> str:
    """The key from .env (or the environment's .env-style file). Raises without saying what was found."""
    try:
        lines = env_file.read_text().splitlines()
    except OSError:
        raise RuntimeError(f"No {env_file.name} file with {KEY_NAME}.") from None
    for line in lines:
        name, _, value = line.partition("=")
        if name.strip() == KEY_NAME:
            value = value.strip().strip('"').strip("'")
            if value:
                return value
    raise RuntimeError(f"{env_file.name} has no {KEY_NAME}.")


def body(messages: Messages, model: str, thinking: bool = True) -> dict:
    """The site's request body. Few-shot examples go in as earlier turns; zero-shot sends the plain text, as the
    site does."""
    if len(messages.turns) == 1:
        input_: object = messages.user
    else:
        # this API version takes earlier turns as a list of steps, shaped like the steps it answers with
        input_ = [
            {"type": "user_input" if t["role"] == "user" else "model_output", "content": [{"type": "text", "text": t["content"]}]}
            for t in messages.turns
        ]
    out = {"model": model, "system_instruction": messages.system, "input": input_, "store": False}
    if thinking:
        out["generation_config"] = {"thinking_level": "low"}
    return out


def answer_text(data: object) -> str:
    """The text parts of the model_output steps, joined, as the site reads them."""
    steps = data.get("steps") if isinstance(data, dict) else None
    out = []
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict) or step.get("type") != "model_output":
            continue
        for part in step.get("content") or []:
            if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
                out.append(part["text"])
    return "".join(out)


class GeminiEngine:
    kind = "gemini"
    with_tools = False

    def __init__(self, model: str = DEFAULT_MODEL, rpm: float = 10.0, retries: int = 4, timeout: float = TIMEOUT_S, env_file: Path = ENV_FILE, sender=None, sleep=time.sleep):
        self.model = model
        self.interval = 60.0 / rpm if rpm > 0 else 0.0
        self.retries = retries
        self.timeout = timeout
        self.env_file = env_file
        self._send = sender or self._post
        self._sleep = sleep
        self._last = 0.0
        self._started = datetime.now(UTC).date().isoformat()

    def settings(self) -> dict:
        return {
            "engine": "gemini",
            "model": self.model,
            "api": "interactions",
            "endpoint": ENDPOINT,
            "generation_config": {"thinking_level": "low"},
            "store": False,
            "fallback_models": None,
            "requests_per_minute": round(60.0 / self.interval, 2) if self.interval else None,
            "date": self._started,
        }

    def _post(self, payload: dict, key: str) -> tuple[int, object]:
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json", "x-goog-api-key": key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read() or b"null")
            except (json.JSONDecodeError, OSError):
                data = None
            return error.code, data

    def _wait_turn(self) -> None:
        gap = self.interval - (time.monotonic() - self._last)
        if gap > 0:
            self._sleep(gap)
        self._last = time.monotonic()

    def answer(self, messages: Messages) -> Answer:
        started = time.perf_counter()
        key = read_key(self.env_file)
        thinking = True
        tries: list[dict] = []
        for attempt in range(self.retries + 1):
            self._wait_turn()
            try:
                status, data = self._send(body(messages, self.model, thinking), key)
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as error:
                status, data = None, {"network": type(error).__name__}
            if status == 200:
                meta = {"model": self.model, "date": datetime.now(UTC).isoformat(timespec="seconds"), "tries": tries}
                if isinstance(data, dict):
                    for field in ("model", "usage", "status"):
                        if field in data:
                            meta[f"reply_{field}"] = data[field]
                return Answer(text=answer_text(data), seconds=time.perf_counter() - started, meta=meta)
            message = _error_text(data)
            tries.append({"status": status, "error": message[:300]})
            if status == 400 and "thinking" in message.lower() and thinking:
                # the site sends the same request without the thinking setting when a model refuses it
                thinking = False
                continue
            if status in (401, 403, 404):
                # a wrong key or a model this key cannot use: nothing later in the run would work either
                raise GeminiStop(f"Gemini answered {status} for model {self.model}: {message[:200]}")
            if status == 400:
                # turned down: that is the model's answer to this prompt, and it has no code
                meta = {"model": self.model, "date": datetime.now(UTC).isoformat(timespec="seconds"), "tries": tries, "failure": "turned-down"}
                return Answer(text="", seconds=time.perf_counter() - started, error=f"turned down: {message[:200]}", meta=meta)
            # no answer yet: rate limit, busy or network; wait and send the same request again
            if attempt < self.retries:
                self._sleep(min(120.0, 15.0 * (attempt + 1)) if status == 429 else min(60.0, 5.0 * (attempt + 1)))
        return Answer(text=None, seconds=time.perf_counter() - started, error=f"no answer after {len(tries)} tries: {tries[-1] if tries else ''}", meta={"model": self.model, "tries": tries})

    def close(self) -> None:
        pass


def _error_text(data: object) -> str:
    body = data[0] if isinstance(data, list) and data else data
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        return " ".join(str(error.get(k)) for k in ("message", "status", "code") if error.get(k) is not None)
    if isinstance(body, dict) and "network" in body:
        return f"network: {body['network']}"
    return ""
