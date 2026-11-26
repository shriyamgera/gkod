"""Runs the Node "gkod" command (tools/bin/gkod.mjs) and reads its JSON."""

import functools
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from mcp.server.mcpserver.exceptions import ToolError

from gkod_mcp.paths import GKOD, REPO

# gkod uses Node's built-in TypeScript support, which needs 22.18 or later.
MIN_NODE = (22, 18)
PLACES = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]


class GkodError(ToolError):
    """A failure with a plain message for the client."""


def _version(node: str) -> tuple[int, int] | None:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.match(r"v(\d+)\.(\d+)", out.strip())
    return (int(match[1]), int(match[2])) if match else None


@functools.cache
def find_node() -> str:
    """The absolute path of a Node new enough for gkod: GKOD_NODE, then PATH, then the usual places."""
    tried = []
    for candidate in [os.environ.get("GKOD_NODE"), shutil.which("node"), *PLACES]:
        if not candidate or candidate in tried or not Path(candidate).is_file():
            continue
        tried.append(candidate)
        version = _version(candidate)
        if version and version >= MIN_NODE:
            return str(Path(candidate).resolve())
    found = f" (found {', '.join(tried)})" if tried else ""
    raise GkodError(f"Node {MIN_NODE[0]}.{MIN_NODE[1]} or later is needed{found}. Install it or set GKOD_NODE to its path.")


def run_gkod(args: list[str], timeout: float) -> dict[str, Any]:
    """Runs `gkod <args> --json` and returns the JSON it printed. Wrong options or unreadable files raise GkodError."""
    command = [find_node(), str(GKOD), *args, "--json"]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=timeout, cwd=REPO)
    except subprocess.TimeoutExpired:
        raise GkodError(f"gkod {args[0]} took longer than {timeout:g} s and was stopped.") from None
    except OSError as error:
        raise GkodError(f"Could not start gkod: {error.strerror or error}.") from None
    lines = done.stdout.strip().splitlines()
    if done.returncode == 2 or not lines:
        message = next((line for line in done.stderr.splitlines() if line.strip()), "") or "it printed nothing"
        raise GkodError(f"gkod {args[0]} failed: {message}")
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        raise GkodError(f"gkod {args[0]} printed something that is not JSON: {lines[-1][:200]}") from None
