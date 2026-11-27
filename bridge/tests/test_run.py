"""Running jobs with the fake claude: progress, the answer, sessions, pictures, busy, stop, timeout and errors."""

import base64
import json
import tempfile
import threading
import time
from pathlib import Path

from conftest import CODE, MODEL, PART, SESSION, alive, good_lines, init, read_events, result, tool_use, wait_until

from gkod_bridge.config import REPO

PAIRED = {"X-GKod-Pairing": CODE}
CREATE = {"kind": "create", "prompt": "Spacer for an M5 bolt, 20 mm long, 10 mm outside diameter", "model": "sonnet"}


def run(bridge, body):
    with bridge.client(**PAIRED) as client, client.stream("POST", "/run", json=body) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        return read_events(response)


def steps(events):
    return [data["step"] for event, data in events if event == "progress"]


def last(events):
    return events[-1]


def test_create_streams_plain_steps_then_the_code(bridge):
    events = run(bridge, CREATE)
    assert steps(events) == ["Writing the part", "Compiling", "Checking", "Looking at the picture", "Fixing", "Looking at the picture"]
    event, final = last(events)
    assert event == "final"
    assert final["code"] == PART
    assert final["assumptions"] == "The hole is 5.5 mm so an M5 bolt slides through."
    assert final["session_id"] == SESSION
    assert final["model"] == MODEL
    assert final["turns"] == 6
    assert final["resumed"] is False
    assert isinstance(final["ms"], int) and final["ms"] >= 0


def test_claude_is_started_headless_with_only_the_gkod_tools(bridge):
    run(bridge, CREATE)
    (call,) = bridge.fake.calls()
    argv = call["argv"]

    def value(flag):
        return argv[argv.index(flag) + 1]

    assert "-p" in argv and "--verbose" in argv and "--strict-mcp-config" in argv
    assert value("--output-format") == "stream-json"
    assert value("--input-format") == "stream-json"
    # none of the owner's settings, memory or project instructions, and no built-in tools
    assert value("--setting-sources") == ""
    assert value("--tools") == ""
    assert value("--permission-mode") == "dontAsk"
    assert value("--model") == "sonnet"
    allowed = value("--allowedTools").split(",")
    assert allowed and all(tool.startswith("mcp__gkod__") for tool in allowed)
    assert {"mcp__gkod__compile_part", "mcp__gkod__check_part", "mcp__gkod__render_part"} <= set(allowed)
    denied = value("--disallowedTools").split(",")
    assert {"Bash", "Edit", "Write", "Read", "WebFetch", "WebSearch", "Task", "Agent"} <= set(denied)
    servers = json.loads(value("--mcp-config"))["mcpServers"]
    assert list(servers) == ["gkod"]
    assert servers["gkod"]["command"] == str(bridge.settings.mcp_python)
    assert servers["gkod"]["args"] == ["-m", "gkod_mcp"]
    # the tools write the job's code, STL files and pictures into the job's own folder
    assert servers["gkod"]["env"] == {"GKOD_OUT": str(Path(call["cwd"]) / "out")}
    prompt = value("--system-prompt")
    assert "220 x 220 x 250 mm" in prompt and "compile_part" in prompt and "at most 4" in prompt
    assert "--resume" not in argv

    # a fresh folder of its own, outside the repository
    cwd = Path(call["cwd"]).resolve()
    assert cwd.parent == bridge.settings.work_root.resolve()
    assert REPO not in cwd.parents

    message = json.loads(call["stdin"])
    assert message["type"] == "user"
    assert message["message"]["content"] == [{"type": "text", "text": f"Make this part: {CREATE['prompt']}"}]
    # nothing that marks a parent Claude Code session reaches the child
    assert "CLAUDECODE" not in call["env"] and "CLAUDE_CODE_SESSION_ID" not in call["env"]
    assert call["env"]["ENABLE_TOOL_SEARCH"] == "false"


def test_the_system_prompt_uses_the_site_code_rules():
    from gkod_bridge.prompts import CODE_RULES, SYSTEM_PROMPT

    site = (REPO / "app" / "src" / "engine" / "prompts.ts").read_text()
    start = site.index("Rules for the code:")
    end = site.index("`;", start)
    assert site[start:end] == CODE_RULES
    assert CODE_RULES in SYSTEM_PROMPT


def test_an_edit_continues_the_session_in_its_own_folder(bridge):
    first = run(bridge, CREATE)
    session = last(first)[1]["session_id"]
    edit = {"kind": "edit", "instruction": "make it 30 mm long", "code": PART, "session_id": session}
    second = run(bridge, edit)
    assert last(second)[0] == "final"
    assert last(second)[1]["resumed"] is True
    create_call, edit_call = bridge.fake.calls()
    argv = edit_call["argv"]
    assert argv[argv.index("--resume") + 1] == session
    assert edit_call["cwd"] == create_call["cwd"]
    # the same session keeps its own files, in its own folder
    out = [json.loads(c["argv"][c["argv"].index("--mcp-config") + 1])["mcpServers"]["gkod"]["env"]["GKOD_OUT"] for c in (create_call, edit_call)]
    assert out[0] == out[1] == str(Path(create_call["cwd"]) / "out")
    text = json.loads(edit_call["stdin"])["message"]["content"][0]["text"]
    assert "Change it like this: make it 30 mm long" in text
    assert PART.strip() in text


def test_a_lost_session_starts_a_new_one(bridge):
    run(bridge, CREATE)
    bridge.use({"lines": good_lines(), "on_resume": {"stderr": f"No conversation found with session ID: {SESSION}", "exit": 1}})
    events = run(bridge, {"kind": "edit", "instruction": "make it 30 mm long", "code": PART, "session_id": SESSION})
    assert "Starting a new session" in steps(events)
    event, final = last(events)
    assert event == "final" and final["resumed"] is False
    _, resumed, fresh = bridge.fake.calls()
    assert "--resume" in resumed["argv"] and "--resume" not in fresh["argv"]
    assert fresh["cwd"] != resumed["cwd"]


def test_a_session_the_bridge_did_not_make_is_never_resumed(bridge):
    # a well-formed id that is not in the bridge's own sessions.json, such as another Claude Code session
    other = "abcdefab-cdef-4abc-8def-abcdefabcdef"
    events = run(bridge, {"kind": "edit", "instruction": "make it 30 mm long", "code": PART, "session_id": other})
    assert steps(events)[0] == "Starting a new session"
    event, final = last(events)
    assert event == "final" and final["resumed"] is False
    (call,) = bridge.fake.calls()
    assert "--resume" not in call["argv"]
    assert other not in " ".join(call["argv"])
    assert Path(call["cwd"]).resolve().parent == bridge.settings.work_root.resolve()


def test_a_picture_goes_in_as_an_image_block(bridge):
    png = b"\x89PNG\r\n\x1a\n" + b"\0" * 100
    run(bridge, {**CREATE, "image": base64.b64encode(png).decode()})
    (call,) = bridge.fake.calls()
    content = json.loads(call["stdin"])["message"]["content"]
    assert content[0]["type"] == "text" and "A photo or sketch of the object is attached." in content[0]["text"]
    assert content[1] == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(png).decode()}}
    # the picture goes in on stdin, so no file tool is needed or allowed
    assert call["argv"][call["argv"].index("--tools") + 1] == ""


def test_a_second_job_while_one_runs_gets_409_and_stop_ends_the_whole_tree(bridge):
    bridge.use({"lines": [init()], "hang": True})
    events = []

    def first():
        events.extend(run(bridge, CREATE))

    thread = threading.Thread(target=first)
    thread.start()
    assert wait_until(lambda: any("grandchild" in call for call in bridge.fake.calls()))
    with bridge.client(**PAIRED) as client:
        busy = client.post("/run", json=CREATE)
        assert busy.status_code == 409
        assert busy.json()["error"] == "busy"
        assert client.get("/health").json()["busy"] is True
        assert client.post("/stop").json() == {"stopped": True}
    thread.join(10)
    assert last(events) == ("error", {"problem": "stopped", "message": "Stopped."})
    pids = [call["pid"] for call in bridge.fake.calls() if "pid" in call]
    pids += [call["grandchild"] for call in bridge.fake.calls() if "grandchild" in call]
    assert wait_until(lambda: not any(alive(pid) for pid in pids), 5)
    with bridge.client() as client:
        assert wait_until(lambda: client.get("/health").json()["busy"] is False, 5)


def test_a_job_over_the_time_limit_is_killed_even_if_it_ignores_sigterm(bridge):
    bridge.settings.timeout_s = 1.5
    bridge.use({"lines": [init()], "hang": True, "ignore_term": True})
    began = time.monotonic()
    events = run(bridge, CREATE)
    took = time.monotonic() - began
    assert last(events)[0] == "error"
    assert last(events)[1]["problem"] == "timeout"
    assert "5 minutes" in last(events)[1]["message"]
    assert took < 1.5 + bridge.settings.kill_grace_s + 3
    pids = [call["pid"] for call in bridge.fake.calls() if "pid" in call]
    pids += [call["grandchild"] for call in bridge.fake.calls() if "grandchild" in call]
    assert pids and wait_until(lambda: not any(alive(pid) for pid in pids), 5)


def test_closing_the_page_stops_the_job(bridge):
    bridge.use({"lines": [init()], "hang": True})
    with bridge.client(**PAIRED) as client:
        with client.stream("POST", "/run", json=CREATE) as response:
            # kept in a name: a dropped line iterator would close the connection here already
            lines = response.iter_lines()
            for line in lines:
                if line.startswith("data: "):
                    break
            assert wait_until(lambda: any("grandchild" in call for call in bridge.fake.calls()))
            assert next(lines) is not None
        # the connection is closed here, with the job still running
    pids = [call["pid"] for call in bridge.fake.calls() if "pid" in call]
    pids += [call["grandchild"] for call in bridge.fake.calls() if "grandchild" in call]
    assert wait_until(lambda: not any(alive(pid) for pid in pids), 10)
    with bridge.client() as client:
        assert wait_until(lambda: client.get("/health").json()["busy"] is False, 5)


def test_keep_alive_comments_are_sent_while_claude_thinks(bridge):
    bridge.use({"lines": [init(), {"sleep": 1.2}, *good_lines()[1:]]})
    with bridge.client(**PAIRED) as client, client.stream("POST", "/run", json=CREATE) as response:
        lines = list(response.iter_lines())
    assert ": still working" in lines


def error_of(bridge, scenario):
    bridge.use(scenario)
    events = run(bridge, CREATE)
    event, data = last(events)
    assert event == "error"
    return data


def test_errors_are_plain(bridge, tmp_path):
    login = error_of(bridge, {"lines": [init(), result("Not logged in · Please run /login", is_error=True)], "exit": 1})
    assert login["problem"] == "not-logged-in" and "log in" in login["message"]

    stamp = 1764300000
    limit = error_of(bridge, {"lines": [init(), result(f"Claude AI usage limit reached|{stamp}", is_error=True)], "exit": 1})
    assert limit["problem"] == "usage-limit"
    assert time.strftime("%H:%M", time.localtime(stamp)) in limit["message"]

    words = error_of(bridge, {"lines": [init(), result("I would make a cylinder with a hole in it.")]})
    assert words["problem"] == "no-code" and "OpenSCAD" in words["message"]

    crash = error_of(bridge, {"stderr": "Error: something internal at /Users/x/secret/path.js:12", "exit": 1})
    assert crash == {"problem": "failed", "message": "Claude Code stopped with an error. Try again."}

    turns = error_of(bridge, {"lines": [init(), tool_use("t1", "compile_part", {"code": "x"}), result("", subtype="error_max_turns", is_error=True)]})
    assert turns["problem"] == "failed"

    bridge.settings.claude_path = str(tmp_path / "no-such-claude")
    missing = run(bridge, CREATE)
    assert last(missing) == ("error", {"problem": "claude-missing", "message": last(missing)[1]["message"]})
    assert "not installed" in last(missing)[1]["message"]


def test_job_folders_are_in_the_temp_folder_by_default(monkeypatch):
    from gkod_bridge.config import default_work_root

    monkeypatch.delenv("GKOD_BRIDGE_WORK", raising=False)
    root = default_work_root()
    assert root.parent == Path(tempfile.gettempdir()).resolve()
    assert REPO not in root.parents


def test_a_work_folder_inside_the_repo_is_refused(monkeypatch):
    import pytest

    from gkod_bridge.config import default_work_root

    monkeypatch.setenv("GKOD_BRIDGE_WORK", str(REPO / "bridge" / "work"))
    with pytest.raises(ValueError):
        default_work_root()


def test_a_job_is_refused_when_the_gkod_tools_are_not_set_up(bridge, tmp_path):
    bridge.settings.mcp_python = tmp_path / "no-such-mcp" / "python"
    with bridge.client() as client:
        assert client.get("/health").json()["tools_found"] is False
    events = run(bridge, CREATE)
    event, data = last(events)
    assert event == "error" and data["problem"] == "tools-missing"
    assert "GKod's tools are not set up" in data["message"]
    assert bridge.fake.calls() == []


def test_a_job_stops_at_once_when_the_gkod_tools_did_not_start(bridge):
    # Claude Code would go on and answer without the tools; the bridge stops it after the init line
    for status in ("failed", "needs-auth"):
        bridge.use({"lines": [init(mcp_status=status)], "hang": True})
        began = time.monotonic()
        events = run(bridge, CREATE)
        assert time.monotonic() - began < 8
        assert steps(events) == []
        event, data = last(events)
        assert event == "error" and data["problem"] == "tools-failed", status
        assert "did not start" in data["message"]
    pids = [call["pid"] for call in bridge.fake.calls() if "pid" in call]
    pids += [call["grandchild"] for call in bridge.fake.calls() if "grandchild" in call]
    assert pids and wait_until(lambda: not any(alive(pid) for pid in pids), 5)

