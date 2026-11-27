"""One Claude Code job at a time: run it in its own temp folder, stream its progress, stop it on request."""

import asyncio
import contextlib
import json
import os
import shutil
import signal
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import prompts
from .claude import build_command, child_env, find_claude, user_message
from .config import KEEP_DAYS, Settings
from .stream import MESSAGES, Answer, Failure, StreamParser

LINE_LIMIT = 64 * 1024 * 1024
STDERR_KEEP = 8 * 1024


class Busy(Exception):
    pass


@dataclass
class JobRequest:
    kind: str
    prompt: str = ""
    instruction: str = ""
    code: str = ""
    error: str = ""
    request: str = ""
    image: tuple[bytes, str] | None = None
    session_id: str | None = None
    model: str | None = None

    def text(self) -> str:
        if self.kind == "create":
            return prompts.create_text(self.prompt, self.image is not None)
        if self.kind == "edit":
            return prompts.edit_text(self.instruction, self.code)
        return prompts.repair_text(self.code, self.error, self.request or "the part")


class Sessions:
    """Which job folder each session was made in. Claude Code keeps a session with its folder, so an edit runs
    in the folder of the session it continues."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.file = root / "sessions.json"

    def _read(self) -> dict[str, str]:
        try:
            data = json.loads(self.file.read_text())
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(data, dict) else {}

    def folder(self, session_id: str) -> Path | None:
        name = self._read().get(session_id)
        if not name:
            return None
        path = self.root / name
        return path if path.is_dir() and path.parent == self.root else None

    def remember(self, session_id: str, folder: Path) -> None:
        data = self._read()
        data[session_id] = folder.name
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(self.file)

    def clean(self, keep_days: float = KEEP_DAYS) -> None:
        """Deletes job folders older than keep_days, with their entries."""
        cutoff = time.time() - keep_days * 86400
        for path in self.root.glob("job-*"):
            with contextlib.suppress(OSError):
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    shutil.rmtree(path)
        data = {k: v for k, v in self._read().items() if (self.root / v).is_dir()}
        with contextlib.suppress(OSError):
            self.file.write_text(json.dumps(data))


def new_folder(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / f"job-{uuid.uuid4().hex[:12]}"
    path.mkdir(mode=0o700)
    return path


async def _tail(stream: asyncio.StreamReader) -> str:
    kept: deque[bytes] = deque()
    size = 0
    while chunk := await stream.read(4096):
        kept.append(chunk)
        size += len(chunk)
        while size > STDERR_KEEP and len(kept) > 1:
            size -= len(kept.popleft())
    return b"".join(kept).decode(errors="replace")[-STDERR_KEEP:]


def _signal_group(proc: asyncio.subprocess.Process, sig: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, sig)


async def kill_tree(proc: asyncio.subprocess.Process, grace_s: float) -> None:
    """SIGTERM to the whole process group (claude, the MCP server and what it started), SIGKILL after grace_s."""
    if proc.returncode is None:
        _signal_group(proc, signal.SIGTERM)
        try:
            await asyncio.wait_for(asyncio.shield(proc.wait()), grace_s)
        except TimeoutError:
            pass
    # anything left in the group, such as a tool the MCP server started, goes too
    _signal_group(proc, signal.SIGKILL)
    if proc.returncode is None:
        await proc.wait()


class Job:
    def __init__(self, runner: "Runner", req: JobRequest) -> None:
        self.runner = runner
        self.req = req
        self.settings = runner.settings
        self.queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.attached = asyncio.Event()
        self.proc: asyncio.subprocess.Process | None = None
        self.stop_reason: str | None = None
        self.began = time.monotonic()
        self.task: asyncio.Task[None] | None = None

    def emit(self, event: str, data: dict[str, Any]) -> None:
        self.queue.put_nowait({"event": event, "data": data})

    def fail(self, problem: str, message: str | None = None) -> None:
        self.emit("error", {"problem": problem, "message": message or MESSAGES[problem]})

    def stop(self, reason: str = "stopped") -> None:
        self.stop_reason = self.stop_reason or reason
        if self.task and not self.task.done():
            self.task.cancel()

    async def main(self) -> None:
        try:
            try:
                await asyncio.wait_for(self.attached.wait(), self.settings.attach_timeout_s)
            except TimeoutError:
                return
            try:
                async with asyncio.timeout(self.settings.timeout_s):
                    await self._run()
            except TimeoutError:
                self.fail("timeout")
        except asyncio.CancelledError:
            self.fail("stopped")
        finally:
            if self.proc:
                await asyncio.shield(kill_tree(self.proc, self.settings.kill_grace_s))
            self.queue.put_nowait(None)
            self.runner.release(self)

    async def _run(self) -> None:
        claude = find_claude(self.settings.claude_path)
        if not claude:
            self.fail("claude-missing")
            return
        sessions = self.runner.sessions
        resume = self.req.session_id
        folder = (sessions.folder(resume) if resume else None) or new_folder(self.settings.work_root)
        outcome = await self._once(claude, folder, resume)
        resumed = bool(resume)
        if isinstance(outcome, Failure) and outcome.session_gone and resume:
            # the session that made the part is gone (cleaned up, or made on another Mac): start a new one.
            # The edit request holds the whole current code, so nothing is lost.
            self.emit("progress", {"step": "Starting a new session"})
            folder = new_folder(self.settings.work_root)
            outcome = await self._once(claude, folder, None)
            resumed = False
        if isinstance(outcome, Failure):
            self.fail(outcome.problem, outcome.message)
            return
        assert isinstance(outcome, Answer)
        if outcome.session_id:
            sessions.remember(outcome.session_id, folder)
        self.emit(
            "final",
            {
                "code": outcome.code,
                "assumptions": outcome.assumptions,
                "session_id": outcome.session_id,
                "resumed": resumed,
                "model": outcome.model,
                "ms": round((time.monotonic() - self.began) * 1000),
                "turns": outcome.turns,
            },
        )

    async def _once(self, claude: str, folder: Path, resume: str | None) -> Answer | Failure:
        command = build_command(claude, self.settings.mcp_python, self.req.model, resume)
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=folder,
                env=child_env(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
                limit=LINE_LIMIT,
            )
        except OSError:
            return Failure("claude-missing", MESSAGES["claude-missing"])
        self.proc = proc
        assert proc.stdin and proc.stdout and proc.stderr
        stderr = asyncio.create_task(_tail(proc.stderr))
        try:
            proc.stdin.write(user_message(self.req.text(), self.req.image))
            await proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            proc.stdin.close()
        parser = StreamParser()
        try:
            while line := await proc.stdout.readline():
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if isinstance(item, dict):
                    for step in parser.feed(item):
                        self.emit("progress", {"step": step})
            returncode = await proc.wait()
            self.proc = None
            return parser.outcome(returncode, await stderr)
        finally:
            if not stderr.done():
                stderr.cancel()

    async def events(self) -> AsyncIterator[dict[str, Any] | None]:
        """The job's events for the page. None is a keep-alive. Leaving early (the page went away) stops the job."""
        self.attached.set()
        try:
            while True:
                try:
                    item = await asyncio.wait_for(self.queue.get(), self.settings.heartbeat_s)
                except TimeoutError:
                    yield None
                    continue
                if item is None:
                    return
                yield item
        finally:
            self.stop("disconnected")


class Runner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sessions = Sessions(settings.work_root)
        self.job: Job | None = None

    @property
    def busy(self) -> bool:
        return self.job is not None

    def start(self, req: JobRequest) -> Job:
        if self.job is not None:
            raise Busy
        job = Job(self, req)
        self.job = job
        job.task = asyncio.create_task(job.main())
        return job

    def release(self, job: Job) -> None:
        if self.job is job:
            self.job = None

    def stop(self) -> bool:
        if not self.job:
            return False
        self.job.stop()
        return True

    async def shutdown(self) -> None:
        job = self.job
        if job and job.task:
            job.stop("shutdown")
            with contextlib.suppress(asyncio.CancelledError):
                await job.task
