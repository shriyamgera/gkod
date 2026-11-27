import json
import os
import shlex
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn

from gkod_bridge.app import create_app
from gkod_bridge.config import Settings

HERE = Path(__file__).resolve().parent
CODE = "TEST-CODE-2345"
SESSION = "11111111-2222-4333-8444-555555555555"
MODEL = "claude-test-model"

PART = """// Spacer length (mm)
length = 20; // [5:1:60]
// Outside diameter (mm)
outer = 10; // [6:0.5:30]
// Hole diameter (mm)
hole = 5.5; // [3:0.1:12]
/* [Hidden] */
$fn = 64;
difference() {
  cylinder(h = length, d = outer);
  translate([0, 0, -1]) cylinder(h = length + 2, d = hole);
}
"""


# Stream-json lines in the shape Claude Code prints them, written by hand.
def init(session: str = SESSION, model: str = MODEL, mcp_status: str = "connected") -> dict[str, Any]:
    return {
        "type": "system",
        "subtype": "init",
        "cwd": "/tmp/job",
        "session_id": session,
        "tools": [f"mcp__gkod__{t}" for t in ("list_examples", "compile_part", "check_part", "render_part", "preview_example")],
        "mcp_servers": [{"name": "gkod", "status": mcp_status, "source": "dynamic"}],
        "model": model,
        "permissionMode": "dontAsk",
        "apiKeySource": "none",
    }


def tool_use(tool_id: str, name: str, payload: dict[str, Any], session: str = SESSION) -> dict[str, Any]:
    return {
        "type": "assistant",
        "message": {
            "id": f"msg_{tool_id}",
            "type": "message",
            "role": "assistant",
            "model": MODEL,
            "content": [{"type": "tool_use", "id": tool_id, "name": f"mcp__gkod__{name}", "input": payload}],
            "stop_reason": None,
        },
        "parent_tool_use_id": None,
        "session_id": session,
    }


def tool_result(tool_id: str, text: str, is_error: bool = False, session: str = SESSION) -> dict[str, Any]:
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"tool_use_id": tool_id, "type": "tool_result", "content": [{"type": "text", "text": text}], "is_error": is_error}],
        },
        "parent_tool_use_id": None,
        "session_id": session,
    }


def say(text: str, session: str = SESSION) -> dict[str, Any]:
    return {
        "type": "assistant",
        "message": {"id": "msg_text", "type": "message", "role": "assistant", "model": MODEL, "content": [{"type": "text", "text": text}]},
        "parent_tool_use_id": None,
        "session_id": session,
    }


def result(text: str, session: str = SESSION, turns: int = 6, is_error: bool = False, subtype: str = "success") -> dict[str, Any]:
    return {
        "type": "result",
        "subtype": subtype,
        "is_error": is_error,
        "duration_ms": 41234,
        "num_turns": turns,
        "result": text,
        "session_id": session,
        "total_cost_usd": 0.0,
    }


def answer(code: str = PART, assumptions: str = "The hole is 5.5 mm so an M5 bolt slides through.") -> str:
    return f"The spacer passes every check.\n\n```openscad\n{code}```\n\nAssumptions: {assumptions}"


def good_lines(session: str = SESSION, code: str = PART) -> list[dict[str, Any]]:
    """A job that compiles, fails a check, fixes it and finishes."""
    return [
        init(session),
        tool_use("t1", "compile_part", {"code": code}),
        tool_result("t1", json.dumps({"ok": True, "stl_path": "/x/part-1.stl", "params": [], "error": None})),
        tool_use("t2", "check_part", {"stl_path": "/x/part-1.stl"}),
        tool_result("t2", json.dumps({"ready": False, "summary": "Needs changes on the Anycubic Kobra 2 Neo"})),
        tool_use("t3", "render_part", {"stl_path": "/x/part-1.stl"}),
        tool_result("t3", "iso view, 10 x 10 x 20 mm, 128 triangles, needs changes: Sits flat"),
        tool_use("t4", "compile_part", {"code": code}),
        tool_result("t4", json.dumps({"ok": True, "stl_path": "/x/part-2.stl", "params": [], "error": None})),
        tool_use("t5", "render_part", {"code": code}),
        tool_result("t5", "iso view, 10 x 10 x 20 mm, 128 triangles, ready to print on the Anycubic Kobra 2 Neo."),
        say(answer(code)),
        result(answer(code), session),
    ]


@dataclass
class Fake:
    folder: Path

    def make(self, scenario: dict[str, Any]) -> str:
        """A claude command that plays the scenario. Returns its path."""
        n = len(list(self.folder.glob("scenario-*.json")))
        scenario_file = self.folder / f"scenario-{n}.json"
        scenario_file.write_text(json.dumps(scenario))
        script = self.folder / f"claude-{n}"
        script.write_text(
            "#!/bin/sh\n"
            f"FAKE_CLAUDE_SCENARIO={shlex.quote(str(scenario_file))} FAKE_CLAUDE_RECORD={shlex.quote(str(self.record))} "
            f"exec {shlex.quote(sys.executable)} {shlex.quote(str(HERE / 'fake_claude.py'))} \"$@\"\n"
        )
        script.chmod(0o755)
        return str(script)

    @property
    def record(self) -> Path:
        return self.folder / "record.jsonl"

    def calls(self) -> list[dict[str, Any]]:
        if not self.record.exists():
            return []
        return [json.loads(line) for line in self.record.read_text().splitlines() if line.strip()]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@dataclass
class Bridge:
    url: str
    settings: Settings
    fake: Fake
    app: Any

    def client(self, **headers: str) -> httpx.Client:
        return httpx.Client(base_url=self.url, headers=headers, timeout=30)

    def use(self, scenario: dict[str, Any]) -> None:
        self.settings.claude_path = self.fake.make(scenario)


@pytest.fixture
def bridge(tmp_path: Path):
    fake = Fake(tmp_path / "fake")
    fake.folder.mkdir()
    port = free_port()
    # stands in for the MCP server's Python: it only has to exist, since the fake claude never starts it
    mcp_python = tmp_path / "mcp" / ".venv" / "bin" / "python"
    mcp_python.parent.mkdir(parents=True)
    mcp_python.write_text("#!/bin/sh\nexit 1\n")
    mcp_python.chmod(0o755)
    settings = Settings(
        pairing_code=CODE,
        port=port,
        timeout_s=20,
        claude_path=fake.make({"lines": good_lines()}),
        mcp_python=mcp_python,
        work_root=tmp_path / "work",
        attach_timeout_s=5,
        heartbeat_s=0.5,
        kill_grace_s=0.5,
    )
    app = create_app(settings)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline:
            raise RuntimeError("the test bridge did not start")
        time.sleep(0.02)
    yield Bridge(url=f"http://127.0.0.1:{port}", settings=settings, fake=fake, app=app)
    server.should_exit = True
    thread.join(10)


def read_events(response: httpx.Response) -> list[tuple[str, dict[str, Any]]]:
    events = []
    event = None
    for line in response.iter_lines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: ") and event:
            events.append((event, json.loads(line[6:])))
            event = None
    return events


def alive(pid: int) -> bool:
    """Running, and not a finished process waiting to be reaped."""
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith("Z")


def wait_until(check, timeout: float = 10) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.05)
    return check()
