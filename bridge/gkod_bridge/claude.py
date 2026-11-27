"""Finding the owner's claude command and building the headless command line for one job."""

import asyncio
import base64
import json
import os
import re
import shutil
import time
from pathlib import Path

from .config import MCP_SERVER_NAME, MCP_TOOLS
from .prompts import SYSTEM_PROMPT

# Built-in tools are switched off with --tools ""; these are also denied by name, in case a version keeps one.
DENIED_TOOLS = (
    "Bash",
    "BashOutput",
    "KillShell",
    "Edit",
    "MultiEdit",
    "Write",
    "NotebookEdit",
    "Read",
    "Glob",
    "Grep",
    "LS",
    "WebFetch",
    "WebSearch",
    "Task",
    "Agent",
    "TodoWrite",
    "Skill",
    "SlashCommand",
    "ExitPlanMode",
    "EnterPlanMode",
    "AskUserQuestion",
    "ListMcpResourcesTool",
    "ReadMcpResourceTool",
)

ALLOWED_TOOLS = tuple(f"mcp__{MCP_SERVER_NAME}__{tool}" for tool in MCP_TOOLS)

# model aliases and full Claude model names; anything else is refused before it reaches the command line
MODEL = re.compile(r"^(sonnet|opus|haiku|fable|claude-[a-z0-9.-]{1,60})(\[1m\])?$")

# Set when the bridge itself runs inside a Claude Code session. The child would think it is nested, or talk to
# the parent's sockets, so they are left out. Settings the owner chose (auth tokens, providers) are kept.
_PARENT_VARS = {"CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_AGENT_SDK_VERSION"}
_KEEP_CLAUDE_CODE = {
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
}


def child_env(base: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ if base is None else base)
    for name in list(env):
        if name in _PARENT_VARS or (name.startswith("CLAUDE_CODE_") and name not in _KEEP_CLAUDE_CODE):
            del env[name]
    # GKod's five tools are always loaded, never held back behind a tool search
    env["ENABLE_TOOL_SEARCH"] = "false"
    env["DISABLE_AUTOUPDATER"] = "1"
    return env


def find_claude(chosen: str | None = None) -> str | None:
    """The claude command: the chosen path, else on the PATH, else in the usual install folders."""
    if chosen:
        path = Path(chosen).expanduser()
        return str(path) if path.is_file() and os.access(path, os.X_OK) else None
    found = shutil.which("claude")
    if found:
        return found
    for candidate in (Path.home() / ".local" / "bin" / "claude", Path("/opt/homebrew/bin/claude"), Path("/usr/local/bin/claude")):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def mcp_config(mcp_python: Path, out_dir: Path) -> str:
    # GKOD_OUT keeps the job's code, STL files and pictures in its own folder, deleted with it, never shared with
    # other jobs or left in the repository's .gkod-out
    server = {"type": "stdio", "command": str(mcp_python), "args": ["-m", "gkod_mcp"], "env": {"GKOD_OUT": str(out_dir)}}
    return json.dumps({"mcpServers": {MCP_SERVER_NAME: server}})


def build_command(claude: str, mcp_python: Path, out_dir: Path, model: str | None, resume: str | None) -> list[str]:
    command = [
        claude,
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--system-prompt",
        SYSTEM_PROMPT,
        # none of the owner's settings, CLAUDE.md files, hooks or plugins
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        mcp_config(mcp_python, out_dir),
        "--tools",
        "",
        "--allowedTools",
        ",".join(ALLOWED_TOOLS),
        "--disallowedTools",
        ",".join(DENIED_TOOLS),
        "--permission-mode",
        "dontAsk",
    ]
    if model:
        command += ["--model", model]
    if resume:
        command += ["--resume", resume]
    return command


def user_message(text: str, image: tuple[bytes, str] | None = None) -> bytes:
    """One stream-json user message for stdin: the words, and the picture as an image block."""
    content: list[dict[str, object]] = [{"type": "text", "text": text}]
    if image:
        data, media_type = image
        content.append(
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode()}}
        )
    line = {"type": "user", "session_id": "", "parent_tool_use_id": None, "message": {"role": "user", "content": content}}
    return (json.dumps(line) + "\n").encode()


async def _output(command: list[str], timeout: float) -> tuple[int | None, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=child_env(),
            start_new_session=True,
        )
    except OSError:
        return None, ""
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return None, ""
    return proc.returncode, out.decode(errors="replace")


class ClaudeInfo:
    """What /health reports about the claude command, looked up at most every 30 seconds."""

    def __init__(self, chosen: str | None, max_age_s: float = 30) -> None:
        self.chosen = chosen
        self.max_age_s = max_age_s
        self._at = 0.0
        self._info: dict[str, object] = {}
        self._lock = asyncio.Lock()

    async def get(self) -> dict[str, object]:
        async with self._lock:
            if time.monotonic() - self._at > self.max_age_s or not self._info:
                self._info = await self._look()
                self._at = time.monotonic()
            return self._info

    async def _look(self) -> dict[str, object]:
        path = find_claude(self.chosen)
        if not path:
            return {"claude_found": False, "claude_version": None, "logged_in": None}
        code, out = await _output([path, "--version"], 15)
        version = out.strip().split()[0] if code == 0 and out.strip() else None
        code, out = await _output([path, "auth", "status"], 15)
        logged_in = None
        if code is not None:
            try:
                # only this one field is read; the rest of the status (the account) is never passed on
                logged_in = bool(json.loads(out).get("loggedIn"))
            except (ValueError, AttributeError):
                logged_in = None
        return {"claude_found": True, "claude_version": version, "logged_in": logged_in}
