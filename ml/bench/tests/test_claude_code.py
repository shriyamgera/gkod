import json
import os

import pytest
from messages import THREE, ZERO

from gkod_bench.engines import claude_code
from gkod_bench.engines.claude_code import ALLOWED_TOOLS, ClaudeCodeEngine, ClaudeCodeStop


# ---- Claude Code ----


def stream(tools=ALLOWED_TOOLS, result="```openscad\ncube(3);\n```", is_error=False, servers=None):
    events = [
        {"type": "system", "subtype": "init", "tools": list(tools), "mcp_servers": servers or [{"name": "gkod", "status": "connected"}], "model": "some-model"},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "mcp__gkod__compile_part", "input": {}}]}},
        {"type": "user", "message": {"content": [{"type": "tool_result"}]}},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": result}]}},
        {"type": "result", "subtype": "success" if not is_error else "error_during_execution", "is_error": is_error, "result": result, "num_turns": 3, "duration_ms": 1200, "total_cost_usd": 0.01, "modelUsage": {"some-model": {}}},
    ]
    return [json.dumps(e) for e in events]


@pytest.fixture
def mcp_python(monkeypatch, tmp_path):
    fake = tmp_path / "python"
    fake.write_text("")
    monkeypatch.setattr(claude_code, "MCP_PYTHON", fake)
    return fake


def test_claude_code_command_has_only_the_gkod_tools(mcp_python):
    calls = []

    def runner(cmd, stdin, cwd, env):
        calls.append((cmd, stdin, cwd, env))
        return 0, stream(), ""

    engine = ClaudeCodeEngine(runner=runner)
    answer = engine.answer(ZERO)
    assert answer.text == "```openscad\ncube(3);\n```"
    assert answer.meta["tool_calls"] == ["mcp__gkod__compile_part"] and answer.meta["models"] == ["some-model"]
    cmd, stdin, cwd, env = calls[0]
    # the request goes in on standard input, not as an argument
    assert stdin == "Make this part: a box" and "Make this part: a box" not in cmd
    assert cmd[cmd.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in cmd and cmd[cmd.index("--system-prompt") + 1] == "SYSTEM"
    assert cmd[cmd.index("--setting-sources") + 1] == "local" and "--no-session-persistence" in cmd
    assert cmd[cmd.index("--allowedTools") + 1] == ",".join(ALLOWED_TOOLS)
    assert "mcp__gkod__list_examples" in cmd[cmd.index("--disallowedTools") + 1]
    config = json.loads(cmd[cmd.index("--mcp-config") + 1])
    assert list(config["mcpServers"]) == ["gkod"] and config["mcpServers"]["gkod"]["env"]["GKOD_OUT"].startswith(cwd)
    assert not os.path.exists(cwd)


def test_claude_code_stops_on_other_tools_or_no_server(mcp_python):
    with pytest.raises(ClaudeCodeStop, match="Read"):
        ClaudeCodeEngine(runner=lambda *a: (0, stream(tools=[*ALLOWED_TOOLS, "Read"]), "")).answer(ZERO)
    with pytest.raises(ClaudeCodeStop, match="did not connect"):
        ClaudeCodeEngine(runner=lambda *a: (0, stream(servers=[{"name": "gkod", "status": "failed"}]), "")).answer(ZERO)
    with pytest.raises(ClaudeCodeStop, match="zero-shot"):
        ClaudeCodeEngine(runner=lambda *a: (0, stream(), "")).answer(THREE)


def test_claude_code_without_an_answer(mcp_python):
    failed = ClaudeCodeEngine(runner=lambda *a: (1, stream(is_error=True, result="usage limit reached"), "")).answer(ZERO)
    assert failed.text is None and "usage limit" in failed.error
    timed_out = ClaudeCodeEngine(runner=lambda *a: (None, [], "timeout")).answer(ZERO)
    assert timed_out.text is None and "within" in timed_out.error
    no_start = ClaudeCodeEngine(runner=lambda *a: (1, [], "not logged in")).answer(ZERO)
    assert no_start.text is None and "not logged in" in no_start.error
