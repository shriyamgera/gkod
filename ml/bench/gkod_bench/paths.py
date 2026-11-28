"""Where things are in the repository."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
GKOD_BIN = REPO / "tools" / "bin" / "gkod.mjs"
SETS = REPO / "data" / "sets" / "v1"
SETS_HASHES = REPO / "datagen" / "sets-v1.sha256"
RESULTS = REPO / "results"
ENV_FILE = REPO / ".env"
MCP_PYTHON = REPO / "mcp" / ".venv" / "bin" / "python"
LOCAL_MODEL = REPO / "ml" / "models" / "qwen2.5-coder-1.5b-instruct"
# fixed dev subsets (lists of prompt ids), for learning curves
SUBSETS = REPO / "ml" / "bench" / "subsets"
