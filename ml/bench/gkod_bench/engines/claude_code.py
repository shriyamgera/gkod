"""Claude Code, headless (`claude -p`), with the GKod MCP tools and nothing else: the "with tools" row.

It gets the site's system prompt and the site's words for the request, plus one recorded line saying the tools are
there. It may compile, check and look at the part before it answers; its final message is read with the same rule
as every other row. Built-in tools are off (`--tools ""`), only the GKod server is loaded (`--strict-mcp-config`),
and only compile_part, check_part and render_part are allowed: list_examples and preview_example are denied, since
they show the site's hand-written example parts. Every run checks the tool list the session reports and stops if
anything else is there. It runs on the owner's plan, so rows are run in stages with --limit and resumed.
"""

from __future__ import annotations

import functools
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import UTC, datetime

from gkod_bench.engines.base import Answer
from gkod_bench.paths import MCP_PYTHON
from gkod_bench.prompts import Messages

ALLOWED_TOOLS = ("mcp__gkod__compile_part", "mcp__gkod__check_part", "mcp__gkod__render_part")
DENIED_TOOLS = ("mcp__gkod__list_examples", "mcp__gkod__preview_example")
TOOL_NOTE = (
    "You have tools that compile OpenSCAD with the same compiler as the site, run its print checks and draw the part. "
    "You may use them to test the code before you answer. Your last message is read as the answer."
)
TIMEOUT_S = 900
# results that end a session that ran without giving an answer: counted as answers with no code
FAILED_RESULTS = ("error_max_turns", "error_max_budget_usd")


@functools.cache
def cli_version() -> str | None:
    try:
        return subprocess.run([shutil.which("claude") or "claude", "--version"], capture_output=True, text=True, timeout=30).stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


class ClaudeCodeStop(RuntimeError):
    """The session was not set up as the row needs (other tools, no GKod server), so the run stops."""


def command(messages: Messages, model: str | None, effort: str | None, mcp_config: dict) -> list[str]:
    claude = shutil.which("claude") or "claude"
    cmd = [
        claude,
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--system-prompt", messages.system,
        "--append-system-prompt", TOOL_NOTE,
        "--tools", "",
        "--mcp-config", json.dumps(mcp_config),
        "--strict-mcp-config",
        "--allowedTools", ",".join(ALLOWED_TOOLS),
        "--disallowedTools", ",".join(DENIED_TOOLS),
        "--permission-mode", "dontAsk",
        "--disable-slash-commands",
        "--no-session-persistence",
        # no user or project settings: no hooks, plugins or permission rules of the machine's own setup
        "--setting-sources", "local",
    ]  # fmt: skip
    if model:
        cmd += ["--model", model]
    if effort:
        cmd += ["--effort", effort]
    return cmd


def read_stream(lines: list[str]) -> dict:
    """The init event's tools and servers, the tool calls made, and the final result."""
    out: dict = {"tools": None, "mcp_servers": None, "session_model": None, "tool_calls": [], "result": None}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = event.get("type")
        if kind == "system" and event.get("subtype") == "init":
            out["tools"] = event.get("tools")
            out["mcp_servers"] = event.get("mcp_servers")
            out["session_model"] = event.get("model")
        elif kind == "assistant":
            for part in (event.get("message") or {}).get("content") or []:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    out["tool_calls"].append(part.get("name"))
        elif kind == "result":
            out["result"] = event
    return out


def check_session(stream: dict) -> None:
    tools = stream.get("tools")
    if tools is None:
        raise ClaudeCodeStop("The session did not report its tools, so the tool limit cannot be checked.")
    extra = sorted(set(tools) - set(ALLOWED_TOOLS))
    if extra:
        raise ClaudeCodeStop(f"The session had tools other than the GKod ones: {', '.join(extra)}.")
    servers = {s.get("name"): s.get("status") for s in stream.get("mcp_servers") or [] if isinstance(s, dict)}
    if servers.get("gkod") != "connected":
        raise ClaudeCodeStop(f"The GKod MCP server did not connect: {servers or 'no servers'}.")


class ClaudeCodeEngine:
    kind = "claude-code"
    with_tools = True

    def __init__(self, model: str | None = None, effort: str | None = None, timeout: float = TIMEOUT_S, runner=None):
        if not MCP_PYTHON.exists():
            raise FileNotFoundError(f"The GKod MCP server's Python is missing ({MCP_PYTHON}); see mcp/README.md.")
        self.model = model
        self.effort = effort
        self.timeout = timeout
        self._run = runner or self._subprocess
        self._started = datetime.now(UTC).date().isoformat()

    def settings(self) -> dict:
        return {
            "engine": "claude-code",
            "with_tools": True,
            "model": self.model or "the CLI's default",
            "effort": self.effort or "the CLI's default",
            "cli_version": cli_version(),
            "tools": list(ALLOWED_TOOLS),
            "denied": list(DENIED_TOOLS),
            "tool_note": TOOL_NOTE,
            "timeout_s": self.timeout,
            "date": self._started,
        }

    def _subprocess(self, cmd: list[str], stdin: str, cwd: str, env: dict) -> tuple[int | None, list[str], str]:
        try:
            done = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=self.timeout, cwd=cwd, env=env)
        except subprocess.TimeoutExpired as expired:
            out = expired.stdout.decode() if isinstance(expired.stdout, bytes) else (expired.stdout or "")
            return None, out.splitlines(), "timeout"
        return done.returncode, done.stdout.splitlines(), done.stderr[-2000:]

    def answer(self, messages: Messages) -> Answer:
        if len(messages.turns) != 1:
            raise ClaudeCodeStop("The with-tools row is zero-shot only.")
        started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix="gkod-cc-") as tmp:
            out_dir = os.path.join(tmp, "out")
            os.mkdir(out_dir)
            mcp_config = {"mcpServers": {"gkod": {"command": str(MCP_PYTHON), "args": ["-m", "gkod_mcp"], "env": {"GKOD_OUT": out_dir}}}}
            env = {k: v for k, v in os.environ.items() if k not in ("GKOD_OUT",)}
            code, lines, stderr = self._run(command(messages, self.model, self.effort, mcp_config), messages.user, tmp, env)
        seconds = time.perf_counter() - started
        stream = read_stream(lines)
        if stream["tools"] is not None:
            check_session(stream)
        result = stream["result"] or {}
        meta = {
            "date": datetime.now(UTC).isoformat(timespec="seconds"),
            "session_model": stream["session_model"],
            "models": sorted((result.get("modelUsage") or {}).keys()),
            "num_turns": result.get("num_turns"),
            "tool_calls": stream["tool_calls"],
            "duration_ms": result.get("duration_ms"),
            "total_cost_usd": result.get("total_cost_usd"),
            "usage": result.get("usage"),
        }
        if code is None:
            # out of time: that is this session's answer, with no code, not a missing one
            return Answer(text="", seconds=seconds, error=f"no answer within {self.timeout:g} s", meta={**meta, "failure": "timeout"})
        if stream["tools"] is None:
            return Answer(text=None, seconds=seconds, error=f"the session did not start (exit {code}): {stderr[-300:]}", meta=meta)
        if result.get("subtype") in FAILED_RESULTS:
            # the session ran and ended without an answer (out of turns or budget): no code
            return Answer(text="", seconds=seconds, error=f"no answer: {result.get('subtype')}", meta={**meta, "failure": result.get("subtype")})
        if not result or result.get("is_error") or result.get("subtype") != "success":
            # an API error, a usage limit or a crash: no answer yet, so a later run asks again
            detail = result.get("result") or result.get("subtype") or stderr[-300:]
            return Answer(text=None, seconds=seconds, error=f"no answer: {str(detail)[:300]}", meta=meta)
        return Answer(text=result.get("result") or "", seconds=seconds, meta=meta)

    def close(self) -> None:
        pass
