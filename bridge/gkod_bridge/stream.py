"""Reads Claude Code's stream-json output: plain progress steps while it works, then the answer or a plain error."""

import re
from datetime import datetime
from dataclasses import dataclass
from typing import Any

from .config import MCP_SERVER_NAME
from .prompts import MAX_ASSUMPTIONS

WRITING = "Writing the part"
COMPILING = "Compiling"
CHECKING = "Checking"
LOOKING = "Looking at the picture"
FIXING = "Fixing"
EXAMPLES = "Looking at the examples"

TOOL_PREFIX = f"mcp__{MCP_SERVER_NAME}__"

MESSAGES = {
    "claude-missing": "Claude Code is not installed on this Mac, or the bridge cannot find the claude command. Install it, or start the bridge with GKOD_CLAUDE set to its path.",
    "not-logged-in": "Claude Code is not logged in on this Mac. Run claude in a terminal, log in, then try again.",
    "usage-limit": "Your Claude plan's usage limit is reached. Try again when it resets.",
    "timeout": "Claude Code took longer than 5 minutes, so it was stopped. Try again, or ask for a simpler part.",
    "no-code": "Claude Code did not send any OpenSCAD code. Try again, or say it another way.",
    "stopped": "Stopped.",
    "failed": "Claude Code stopped with an error. Try again.",
}


@dataclass
class Answer:
    code: str
    assumptions: str | None
    session_id: str | None
    model: str | None
    turns: int | None


@dataclass
class Failure:
    problem: str
    message: str
    # Claude Code could not find the session to resume, so the job is tried again as a new session
    session_gone: bool = False


def _blocks(message: Any) -> list[dict[str, Any]]:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [block for block in content or [] if isinstance(block, dict)]


def _result_text(block: dict[str, Any]) -> str:
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def shows_problem(tool: str, text: str, is_error: bool) -> bool:
    """A tool result that says the part does not compile or does not pass the print checks."""
    if is_error:
        return True
    if tool == "compile_part":
        return bool(re.search(r'"ok"\s*:\s*false', text))
    if tool in ("check_part", "render_part"):
        return bool(re.search(r'"ready"\s*:\s*false|needs changes', text, re.IGNORECASE))
    return False


class StreamParser:
    """Fed one parsed stream-json line at a time; returns the new progress steps for each."""

    def __init__(self) -> None:
        self.session_id: str | None = None
        self.model: str | None = None
        self.result: dict[str, Any] | None = None
        self.tools_seen: list[str] = []
        self._names: dict[str, str] = {}
        self._problem = False
        self._last: str | None = None

    def _step(self, step: str | None) -> list[str]:
        if not step or step == self._last:
            return []
        self._last = step
        return [step]

    def feed(self, line: dict[str, Any]) -> list[str]:
        kind = line.get("type")
        if isinstance(line.get("session_id"), str) and line["session_id"]:
            self.session_id = line["session_id"]
        if kind == "system" and line.get("subtype") == "init":
            if isinstance(line.get("model"), str):
                self.model = line["model"]
            return self._step(WRITING)
        if kind == "assistant":
            message = line.get("message") or {}
            if isinstance(message.get("model"), str) and not self.model:
                self.model = message["model"]
            steps: list[str] = []
            for block in _blocks(message):
                if block.get("type") == "tool_use":
                    steps += self._step(self._tool_step(block))
            return steps
        if kind == "user":
            for block in _blocks(line.get("message")):
                if block.get("type") != "tool_result":
                    continue
                tool = self._names.get(str(block.get("tool_use_id")), "")
                if shows_problem(tool, _result_text(block), bool(block.get("is_error"))):
                    self._problem = True
            return []
        if kind == "result":
            self.result = line
        return []

    def _tool_step(self, block: dict[str, Any]) -> str | None:
        name = str(block.get("name", ""))
        tool = name[len(TOOL_PREFIX):] if name.startswith(TOOL_PREFIX) else name
        self._names[str(block.get("id"))] = tool
        self.tools_seen.append(tool)
        writes_code = tool == "compile_part" or (tool == "render_part" and bool((block.get("input") or {}).get("code")))
        if writes_code and self._problem:
            self._problem = False
            return FIXING
        if tool == "compile_part":
            return COMPILING
        if tool == "check_part":
            return CHECKING
        if tool == "render_part":
            return LOOKING
        if tool in ("list_examples", "preview_example"):
            return EXAMPLES
        return None

    def outcome(self, returncode: int | None, stderr: str) -> Answer | Failure:
        result = self.result
        text = result.get("result") if result else None
        text = text if isinstance(text, str) else ""
        failed = result is None or result.get("is_error") or result.get("subtype") != "success"
        if failed:
            return classify_failure(text, stderr, returncode)
        code, assumptions = extract_answer(text)
        if not code:
            return Failure("no-code", MESSAGES["no-code"])
        turns = result.get("num_turns")
        return Answer(
            code=code,
            assumptions=assumptions,
            session_id=self.session_id,
            model=self.model,
            turns=turns if isinstance(turns, int) else None,
        )


_FENCE_OPEN = re.compile(r"^[ \t]*```[ \t]*([\w+-]*)[ \t]*$")
_FENCE_CLOSE = re.compile(r"^[ \t]*```[ \t]*$")


def extract_answer(text: str) -> tuple[str | None, str | None]:
    """The last OpenSCAD code block (or, failing that, the last unmarked one) and the Assumptions line."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        opened = _FENCE_OPEN.match(lines[i])
        if not opened:
            i += 1
            continue
        end = i + 1
        while end < len(lines) and not _FENCE_CLOSE.match(lines[end]):
            end += 1
        blocks.append((opened.group(1).lower(), "\n".join(lines[i + 1 : end])))
        i = end + 1
    scad = [body for tag, body in blocks if tag in ("openscad", "scad")]
    plain = [body for tag, body in blocks if tag == ""]
    body = (scad or plain or [""])[-1].strip()
    code = body + "\n" if body else None
    assumptions = None
    for line in lines:
        found = re.match(r"^\s*\**assumptions?\**\s*:\s*\**\s*(.+)$", line, re.IGNORECASE)
        if found:
            assumptions = found.group(1).strip().strip("*").strip()[:MAX_ASSUMPTIONS] or None
    return code, assumptions


_NOT_LOGGED_IN = re.compile(
    r"not logged in|please run /login|invalid api key|oauth token (has )?(expired|revoked)|authentication_error|"
    r"credit balance is too low|/login",
    re.IGNORECASE,
)
_USAGE_LIMIT = re.compile(
    r"usage limit|limit reached|rate_limit_error|rate limit|hit your limit|out of (extra )?usage|quota", re.IGNORECASE
)
_SESSION_GONE = re.compile(r"no conversation found|session .*not found|could not find session", re.IGNORECASE)


def usage_limit_message(text: str) -> str:
    """Claude Code writes the reset time as a Unix time after a bar ("...limit reached|1764300000")."""
    found = re.search(r"\|(\d{10})\b", text)
    if not found:
        return MESSAGES["usage-limit"]
    reset = datetime.fromtimestamp(int(found.group(1)))
    return f"Your Claude plan's usage limit is reached. It resets at {reset:%H:%M} on {reset:%d %b}."


def classify_failure(result_text: str, stderr: str, returncode: int | None) -> Failure:
    both = f"{result_text}\n{stderr}"
    if _SESSION_GONE.search(both):
        return Failure("failed", MESSAGES["failed"], session_gone=True)
    if _NOT_LOGGED_IN.search(both):
        return Failure("not-logged-in", MESSAGES["not-logged-in"])
    if _USAGE_LIMIT.search(both):
        return Failure("usage-limit", usage_limit_message(both))
    return Failure("failed", MESSAGES["failed"])
