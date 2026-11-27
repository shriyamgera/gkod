"""One job with the real claude command and the real GKod tools. It uses the owner's Claude plan, so it only runs
when asked: GKOD_REAL_CLAUDE=1 bridge/.venv/bin/python -m pytest bridge/tests/test_real.py"""

import os

import pytest
from conftest import CODE, read_events

from gkod_bridge.claude import find_claude
from gkod_bridge.config import default_mcp_python

pytestmark = [
    pytest.mark.real,
    pytest.mark.skipif(os.environ.get("GKOD_REAL_CLAUDE") != "1", reason="uses the owner's Claude plan; set GKOD_REAL_CLAUDE=1"),
]


def test_a_real_part(bridge):
    claude = find_claude(os.environ.get("GKOD_CLAUDE"))
    assert claude, "the claude command was not found"
    assert default_mcp_python().is_file(), "set up mcp/ or set GKOD_MCP_PYTHON"
    bridge.settings.claude_path = claude
    bridge.settings.mcp_python = default_mcp_python()
    bridge.settings.timeout_s = 300
    body = {"kind": "create", "prompt": "Spacer for an M5 bolt, 20 mm long, 10 mm outside diameter", "model": "sonnet"}
    with bridge.client(**{"X-GKod-Pairing": CODE}) as client:
        client.timeout = 320
        with client.stream("POST", "/run", json=body) as response:
            events = read_events(response)
    steps = [data["step"] for event, data in events if event == "progress"]
    event, final = events[-1]
    assert event == "final", final
    assert "Compiling" in steps
    assert "cylinder" in final["code"]
    assert final["session_id"]
