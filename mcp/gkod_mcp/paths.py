import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GKOD = REPO / "tools" / "bin" / "gkod.mjs"
EXAMPLES = REPO / "app" / "src" / "examples"


def out_dir() -> Path:
    """Where compiled parts and pictures go: <repo>/.gkod-out, or the GKOD_OUT folder."""
    path = Path(os.environ.get("GKOD_OUT") or REPO / ".gkod-out").expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path
