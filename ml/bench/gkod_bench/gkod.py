"""Client for `gkod batch`: one Node process that compiles with the site's compiler, runs the print checks and gives
the site's prompt wording. Jobs go in as JSON lines; a reader thread collects the replies by id."""

from __future__ import annotations

import functools
import itertools
import json
import os
import queue
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from gkod_bench.paths import GKOD_BIN, REPO

MIN_NODE = (22, 18)
PLACES = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
# the site's message for a compile that hit the 10 second limit (app/src/scad/messages.ts)
TIMEOUT_MESSAGE = "This took too long and was stopped."
DEFAULT_PRINTER = "kobra2neo"


class GkodError(RuntimeError):
    """The batch process could not be started or stopped answering."""


def _version(node: str) -> tuple[int, int] | None:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.match(r"v(\d+)\.(\d+)", out.strip())
    return (int(match[1]), int(match[2])) if match else None


@functools.cache
def find_node() -> str:
    """A Node new enough for gkod: GKOD_NODE, then PATH, then the usual places."""
    tried = []
    for candidate in [os.environ.get("GKOD_NODE"), shutil.which("node"), *PLACES]:
        if not candidate or candidate in tried or not Path(candidate).is_file():
            continue
        tried.append(candidate)
        version = _version(candidate)
        if version and version >= MIN_NODE:
            return str(Path(candidate).resolve())
    raise GkodError(f"Node {MIN_NODE[0]}.{MIN_NODE[1]} or later is needed (tried {', '.join(tried) or 'nothing'}).")


class Gkod:
    """A running `gkod batch`. Use as a context manager, or call close()."""

    def __init__(self, workers: int = 4, printer: str = DEFAULT_PRINTER, timeout: float = 600.0):
        self.workers = workers
        self.printer = printer
        self.timeout = timeout
        self._ids = itertools.count()
        self._replies: queue.Queue = queue.Queue()
        command = [find_node(), str(GKOD_BIN), "batch", "--workers", str(workers), "--printer", printer]
        try:
            self._proc = subprocess.Popen(
                command,
                cwd=REPO,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except OSError as error:
            raise GkodError(f"Could not start gkod batch: {error}") from None
        self._stderr: list[str] = []
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()

    def _read(self) -> None:
        assert self._proc.stdout is not None
        for line in self._proc.stdout:
            line = line.strip()
            if line:
                self._replies.put(json.loads(line))
        self._replies.put(None)

    def _read_errors(self) -> None:
        assert self._proc.stderr is not None
        for line in self._proc.stderr:
            self._stderr.append(line.rstrip())
            del self._stderr[:-50]

    def run(self, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Sends the jobs and returns their replies in the same order."""
        if not jobs:
            return []
        if self._proc.poll() is not None:
            raise GkodError(f"gkod batch has stopped: {' | '.join(self._stderr[-5:])}")
        ids = []
        lines = []
        for job in jobs:
            job_id = f"j{next(self._ids)}"
            ids.append(job_id)
            lines.append(json.dumps({**job, "id": job_id}))
        assert self._proc.stdin is not None
        try:
            self._proc.stdin.write("\n".join(lines) + "\n")
            self._proc.stdin.flush()
        except BrokenPipeError:
            raise GkodError(f"gkod batch has stopped: {' | '.join(self._stderr[-5:])}") from None
        wanted = set(ids)
        got: dict[str, dict] = {}
        while wanted - got.keys():
            try:
                reply = self._replies.get(timeout=self.timeout)
            except queue.Empty:
                raise GkodError(f"gkod batch sent nothing for {self.timeout:g} s") from None
            if reply is None:
                raise GkodError(f"gkod batch has stopped: {' | '.join(self._stderr[-5:])}")
            if reply.get("id") in wanted:
                got[reply["id"]] = reply
        return [got[i] for i in ids]

    def compile(self, code: str, defines: dict[str, float] | None = None, stl: str | Path | None = None, check: bool = True) -> dict:
        return self.compile_many([{"code": code, "defines": defines, "stl": stl, "check": check}])[0]

    def compile_many(self, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Compiles in parallel. A compile that hit the time limit while others ran is compiled again on its own,
        so a busy machine does not count against the code; both tries are recorded."""
        sent = [
            {"op": "compile", "code": j["code"], "check": j.get("check", True), **({"defines": j["defines"]} if j.get("defines") else {}), **({"stl": str(j["stl"])} if j.get("stl") else {})}
            for j in jobs
        ]
        replies = self.run(sent)
        if len(sent) > 1:
            for i, reply in enumerate(replies):
                if not reply.get("ok") and reply.get("error") == TIMEOUT_MESSAGE:
                    again = self.run([sent[i]])[0]
                    again["first_try"] = {"error": reply.get("error"), "ms": reply.get("ms")}
                    replies[i] = again
        return replies

    def prompt(self, request: dict, answer: str | None = None) -> dict:
        job: dict[str, Any] = {"op": "prompt", "request": request}
        if answer is not None:
            job["answer"] = answer
        reply = self.run([job])[0]
        if "error" in reply and "system" not in reply:
            raise GkodError(reply["error"])
        return reply

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                assert self._proc.stdin is not None
                self._proc.stdin.close()
                self._proc.wait(timeout=30)
            except (subprocess.TimeoutExpired, BrokenPipeError, OSError):
                self._proc.kill()

    def __enter__(self) -> Gkod:
        return self

    def __exit__(self, *exc) -> None:
        self.close()
