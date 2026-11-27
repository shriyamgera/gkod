import argparse
import asyncio
import sys

import uvicorn

from . import __version__
from .app import create_app
from .claude import ClaudeInfo
from .config import HOST, PORT, Settings, default_pairing_file
from .pairing import load_or_create


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m gkod_bridge", description="Lets the GKod site use Claude Code on this Mac.")
    parser.add_argument("--new-code", action="store_true", help="make a new pairing code (pages paired with the old one must pair again)")
    parser.add_argument("--port", type=int, default=PORT, help=argparse.SUPPRESS)
    args = parser.parse_args()
    # each line shows at once, also when the output goes to a file
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[union-attr]

    pairing_file = default_pairing_file()
    code, made = load_or_create(pairing_file, renew=args.new_code)
    settings = Settings(pairing_code=code, port=args.port, log=True)

    info = asyncio.run(ClaudeInfo(settings.claude_path).get())
    if not info["claude_found"]:
        claude = "not found (install it, or set GKOD_CLAUDE to its path)"
    else:
        logged = {True: "logged in", False: "NOT logged in: run claude and log in", None: "login not known"}[info["logged_in"]]  # type: ignore[index]
        claude = f"{info['claude_version'] or 'version not known'}, {logged}"
    mcp = settings.mcp_python
    mcp_line = str(mcp) if mcp.is_file() else f"{mcp} is MISSING: set up mcp/ (see mcp/README.md) or set GKOD_MCP_PYTHON"

    print(f"GKod bridge {__version__}")
    print(f"  Listening on   http://{HOST}:{settings.port} (this Mac only)")
    print(f"  Claude Code    {claude}")
    print(f"  GKod tools     {mcp_line}")
    print(f"  Job folders    {settings.work_root}")
    print(f"  Pairing code   {code}{'  (new)' if made else ''}")
    print()
    print("In GKod, open Engine, choose \"Claude Code (on this Mac)\" and type the pairing code.")
    print("Press Ctrl+C to stop the bridge.")

    uvicorn.run(create_app(settings), host=HOST, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
