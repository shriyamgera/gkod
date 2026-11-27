import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parents[1]
REPO = BRIDGE_DIR.parent

HOST = "127.0.0.1"
PORT = 8765

# The only pages that may call the bridge: the public site and the local dev and preview servers.
ORIGINS = (
    "https://shriyamgera.github.io",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
)

PAIRING_HEADER = "x-gkod-pairing"
TIMEOUT_S = 300
MAX_IMAGE_BYTES = 4 * 1024 * 1024
# a 4 MB picture is about 5.6 MB as base64, plus the code and words
MAX_BODY_BYTES = 8 * 1024 * 1024
# job folders and their sessions are kept this long, so an edit can continue the session that made the part
KEEP_DAYS = 7

MCP_SERVER_NAME = "gkod"
MCP_TOOLS = ("list_examples", "compile_part", "check_part", "render_part", "preview_example")


def default_mcp_python() -> Path:
    """The GKod MCP server's Python: GKOD_MCP_PYTHON, or the virtualenv in this checkout's mcp/ folder."""
    chosen = os.environ.get("GKOD_MCP_PYTHON")
    return Path(chosen).expanduser() if chosen else REPO / "mcp" / ".venv" / "bin" / "python"


def default_pairing_file() -> Path:
    chosen = os.environ.get("GKOD_BRIDGE_PAIRING_FILE")
    return Path(chosen).expanduser() if chosen else BRIDGE_DIR / ".pairing"


def default_work_root() -> Path:
    """Job folders go in the system temp folder, never inside the repository."""
    chosen = os.environ.get("GKOD_BRIDGE_WORK")
    root = Path(chosen).expanduser() if chosen else Path(tempfile.gettempdir()) / "gkod-bridge"
    root = root.resolve()
    if root == REPO or REPO in root.parents:
        raise ValueError(f"The bridge's job folder must be outside the repository, not {root}.")
    return root


@dataclass
class Settings:
    pairing_code: str
    port: int = PORT
    origins: tuple[str, ...] = ORIGINS
    timeout_s: float = TIMEOUT_S
    # the claude command: GKOD_CLAUDE, else found on the PATH or in the usual install folders
    claude_path: str | None = field(default_factory=lambda: os.environ.get("GKOD_CLAUDE"))
    mcp_python: Path = field(default_factory=default_mcp_python)
    work_root: Path = field(default_factory=default_work_root)
    # seconds a started job waits for the page to start reading its events
    attach_timeout_s: float = 10
    # seconds between keep-alive comments on the event stream
    heartbeat_s: float = 15
    # seconds between SIGTERM and SIGKILL when a job is stopped
    kill_grace_s: float = 3
