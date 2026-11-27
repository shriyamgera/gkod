"""The pieces on their own: reading the stream, finding the code, the pairing file and the child's settings."""

import asyncio
import os
import stat
import time

from conftest import PART, good_lines, init, result, say, tool_result, tool_use

from gkod_bridge import pairing
from gkod_bridge.claude import ClaudeInfo, child_env
from gkod_bridge.stream import Answer, Failure, StreamParser, classify_failure, extract_answer


def feed_all(lines):
    parser = StreamParser()
    seen = []
    for line in lines:
        seen += parser.feed(line)
    return parser, seen


def test_steps_follow_the_tool_calls():
    parser, seen = feed_all(good_lines())
    assert seen == ["Writing the part", "Compiling", "Checking", "Looking at the picture", "Fixing", "Looking at the picture"]
    assert parser.tools_seen == ["compile_part", "check_part", "render_part", "compile_part", "render_part"]


def test_a_failed_compile_makes_the_next_compile_a_fix():
    lines = [
        init(),
        tool_use("a", "compile_part", {"code": "x"}),
        tool_result("a", '{"ok": false, "error": "Parser error in line 3"}'),
        tool_use("b", "compile_part", {"code": "y"}),
        tool_result("b", '{"ok": true}'),
        tool_use("c", "compile_part", {"code": "y"}),
    ]
    _, seen = feed_all(lines)
    assert seen == ["Writing the part", "Compiling", "Fixing", "Compiling"]


def test_a_tool_error_counts_as_a_problem():
    lines = [init(), tool_use("a", "render_part", {"code": "x"}), tool_result("a", "boom", is_error=True), tool_use("b", "render_part", {"code": "x"})]
    _, seen = feed_all(lines)
    assert seen == ["Writing the part", "Looking at the picture", "Fixing"]


def test_the_same_step_twice_is_said_once():
    lines = [init(), tool_use("a", "check_part", {}), tool_result("a", '{"ready": true}'), tool_use("b", "check_part", {})]
    _, seen = feed_all(lines)
    assert seen == ["Writing the part", "Checking"]


def test_unknown_lines_are_ignored():
    _, seen = feed_all([{"type": "rate_limit_event"}, {"type": "stream_event"}, {}, init()])
    assert seen == ["Writing the part"]


def test_outcome_has_the_code_session_model_and_turns():
    parser, _ = feed_all(good_lines())
    outcome = parser.outcome(0, "")
    assert isinstance(outcome, Answer)
    assert outcome.code == PART and outcome.turns == 6 and outcome.model == "claude-test-model"


def test_no_result_line_is_a_failure():
    parser, _ = feed_all([init(), say("thinking")])
    outcome = parser.outcome(1, "")
    assert isinstance(outcome, Failure) and outcome.problem == "failed"


def test_extract_takes_the_last_openscad_block_and_the_assumptions():
    text = (
        "First try:\n```openscad\ncube(1);\n```\nBetter:\n```python\nprint(1)\n```\n"
        "```openscad\ncube(2);\n```\n**Assumptions:** the hole is 5.5 mm."
    )
    code, assumptions = extract_answer(text)
    assert code == "cube(2);\n"
    assert assumptions == "the hole is 5.5 mm."


def test_extract_falls_back_to_an_unmarked_block_and_handles_crlf():
    code, assumptions = extract_answer("```\r\ncube(3);\r\n```\r\n")
    assert code == "cube(3);\n" and assumptions is None


def test_extract_finds_nothing_in_words():
    assert extract_answer("I would make a cube.") == (None, None)


def test_a_rejected_rate_limit_event_is_the_usage_limit_with_its_reset_time():
    stamp = 1795753200
    lines = [
        init(),
        {"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "resetsAt": stamp, "rateLimitType": "five_hour"}},
        result("API Error", is_error=True),
    ]
    parser, _ = feed_all(lines)
    outcome = parser.outcome(1, "")
    assert isinstance(outcome, Failure) and outcome.problem == "usage-limit"
    assert time.strftime("%H:%M", time.localtime(stamp)) in outcome.message


def test_an_allowed_rate_limit_event_changes_nothing():
    lines = [init(), {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "resetsAt": 1795753200}}, *good_lines()[1:]]
    parser, _ = feed_all(lines)
    assert isinstance(parser.outcome(0, ""), Answer)


def test_failure_classes():
    assert classify_failure("Invalid API key · Please run /login", "", 1).problem == "not-logged-in"
    assert classify_failure("", "OAuth token has expired", 1).problem == "not-logged-in"
    assert classify_failure("You've hit your limit · resets 3pm", "", 1).problem == "usage-limit"
    assert classify_failure("", "No conversation found with session ID: abc", 1).session_gone
    assert classify_failure("API Error: 500", "", 1).problem == "failed"


def test_pairing_file_is_made_once_owner_only_and_reused(tmp_path):
    path = tmp_path / ".pairing"
    code, made = pairing.load_or_create(path)
    assert made and pairing.is_valid(code)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    again, made_again = pairing.load_or_create(path)
    assert again == code and not made_again
    renewed, made_new = pairing.load_or_create(path, renew=True)
    assert made_new and renewed != code


def test_a_damaged_pairing_file_gets_a_new_code(tmp_path):
    path = tmp_path / ".pairing"
    path.write_text("not a code\n")
    code, made = pairing.load_or_create(path)
    assert made and pairing.is_valid(code)


def test_pairing_match():
    assert pairing.matches("abcd-efgh-jkmn", "ABCD-EFGH-JKMN")
    assert pairing.matches("ABCDEFGHJKMN", "ABCD-EFGH-JKMN")
    assert not pairing.matches("ABCD-EFGH-JKMP", "ABCD-EFGH-JKMN")
    assert not pairing.matches(None, "ABCD-EFGH-JKMN")
    assert not pairing.matches("", "ABCD-EFGH-JKMN")


def test_child_env_drops_parent_session_markers_and_keeps_auth():
    env = child_env(
        {
            "PATH": "/usr/bin",
            "HOME": "/Users/x",
            "CLAUDECODE": "1",
            "CLAUDE_CODE_ENTRYPOINT": "cli",
            "CLAUDE_CODE_SESSION_ID": "abc",
            "CLAUDE_CODE_MESSAGING_SOCKET": "/tmp/s.sock",
            "CLAUDE_CODE_OAUTH_TOKEN": "kept",
            "ANTHROPIC_MODEL": "kept",
        }
    )
    assert env["PATH"] == "/usr/bin" and env["HOME"] == "/Users/x"
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "kept" and env["ANTHROPIC_MODEL"] == "kept"
    for gone in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET"):
        assert gone not in env


def test_claude_info_when_the_command_is_missing(tmp_path):
    info = asyncio.run(ClaudeInfo(str(tmp_path / "no-such-claude")).get())
    assert info == {"claude_found": False, "claude_version": None, "logged_in": None}


def test_claude_info_reads_only_logged_in_from_auth_status(tmp_path):
    from conftest import Fake

    fake = Fake(tmp_path)
    info = asyncio.run(ClaudeInfo(fake.make({"version": "2.1.276 (Claude Code)", "logged_in": False})).get())
    assert info == {"claude_found": True, "claude_version": "2.1.276", "logged_in": False}


def test_a_tool_result_given_as_plain_text_is_read_too():
    # Claude Code passes an MCP tool's JSON answer as one string, not a list of blocks
    failed = tool_result("a", "")
    failed["message"]["content"][0]["content"] = '{"ok":false,"error":"Parser error in line 4"}'
    lines = [init(), tool_use("a", "compile_part", {"code": "x"}), failed, tool_use("b", "compile_part", {"code": "y"})]
    _, seen = feed_all(lines)
    assert seen == ["Writing the part", "Compiling", "Fixing"]


def test_the_gkod_tools_status_in_the_init_line():
    for status, failed in (("connected", False), ("pending", False), ("failed", True), ("needs-auth", True), ("disabled", True)):
        parser, seen = feed_all([init(mcp_status=status)])
        assert parser.tools_failed is failed, status
        assert seen == ([] if failed else ["Writing the part"])
    # no gkod server listed at all
    line = init()
    line["mcp_servers"] = [{"name": "other", "status": "connected"}]
    assert feed_all([line])[0].tools_failed is True
    # an init line that lists no servers says nothing either way
    del line["mcp_servers"]
    assert feed_all([line])[0].tools_failed is False


def test_tools_that_did_not_start_win_over_any_answer():
    lines = [init(mcp_status="failed"), *good_lines()[1:]]
    parser, _ = feed_all(lines)
    outcome = parser.outcome(0, "")
    assert isinstance(outcome, Failure) and outcome.problem == "tools-failed"


def test_the_main_checkout_is_found_from_a_linked_worktree(tmp_path):
    from gkod_bridge.config import main_checkout

    main = tmp_path / "gkod"
    (main / ".git" / "worktrees" / "gkod-cc").mkdir(parents=True)
    (main / ".git" / "worktrees" / "gkod-cc" / "commondir").write_text("../..\n")
    linked = tmp_path / "gkod-cc"
    linked.mkdir()
    (linked / ".git").write_text(f"gitdir: {main / '.git' / 'worktrees' / 'gkod-cc'}\n")
    assert main_checkout(linked) == main.resolve()
    # the main checkout itself, and a folder that is no checkout
    assert main_checkout(main) is None
    assert main_checkout(tmp_path) is None

