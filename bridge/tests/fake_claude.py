"""A stand-in for the claude command. It reads a scenario (JSON) named by FAKE_CLAUDE_SCENARIO, writes what it
was started with to FAKE_CLAUDE_RECORD, and prints stream-json lines written by hand in the shape Claude Code
uses. No model is called."""

import json
import os
import signal
import subprocess
import sys
import time


def record(entry: dict) -> None:
    path = os.environ.get("FAKE_CLAUDE_RECORD")
    if path:
        with open(path, "a") as file:
            file.write(json.dumps(entry) + "\n")


def main() -> int:
    args = sys.argv[1:]
    with open(os.environ["FAKE_CLAUDE_SCENARIO"]) as file:
        scenario = json.load(file)
    if args == ["--version"]:
        print(scenario.get("version", "2.1.0 (Claude Code)"))
        return 0
    if args[:2] == ["auth", "status"]:
        print(json.dumps({"loggedIn": scenario.get("logged_in", True), "authMethod": "claude.ai", "email": "someone@example.com"}))
        return 0 if scenario.get("logged_in", True) else 1

    if "--resume" in args and "on_resume" in scenario:
        scenario = scenario["on_resume"]
    stdin = sys.stdin.read()
    record(
        {
            "argv": args,
            "cwd": os.getcwd(),
            "stdin": stdin,
            "env": {k: v for k, v in os.environ.items() if k.startswith("CLAUDE") or k in ("ENABLE_TOOL_SEARCH",)},
            "pid": os.getpid(),
        }
    )
    if scenario.get("ignore_term"):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    for line in scenario.get("lines", []):
        if "sleep" in line and len(line) == 1:
            time.sleep(line["sleep"])
            continue
        print(json.dumps(line), flush=True)
    if scenario.get("stderr"):
        print(scenario["stderr"], file=sys.stderr, flush=True)
    if scenario.get("hang"):
        # a grandchild, like the MCP server Claude Code starts, to show the whole tree is stopped
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
        record({"grandchild": child.pid})
        time.sleep(300)
    return scenario.get("exit", 0)


if __name__ == "__main__":
    sys.exit(main())
