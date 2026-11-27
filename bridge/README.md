# GKod bridge for Claude Code

A small local service that lets the GKod site hand a request to Claude Code on the owner's own Mac. The site sends the request to the bridge; the bridge runs `claude` headless with GKod's MCP tools, streams its progress back, and returns the OpenSCAD code. The site then compiles the code, runs the print checks and makes a version, exactly as it does for Gemini, so nothing from Claude Code is trusted without being checked.

It is a Python 3.12 package (`gkod_bridge`, FastAPI and uvicorn). It runs natively, not in Docker, because it starts the owner's own `claude` command with the owner's own login.

## Start it

Needs Claude Code installed and logged in (run `claude` once in a terminal), and the [MCP server](../mcp/README.md) set up in `mcp/.venv`.

```sh
python3.12 -m venv bridge/.venv
bridge/.venv/bin/python -m pip install -r bridge/requirements.txt -e bridge
bridge/.venv/bin/python -m gkod_bridge
```

It prints the pairing code, whether Claude Code was found and is logged in, and where the GKod tools are. Leave it running; Ctrl+C stops it.

If making the virtualenv or running pip fails with `Symbol not found: _XML_SetAllocTrackerActivationThreshold`, put `DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib"` in front of those two commands, as for the MCP server.

Settings, all optional:

| Variable | What it does |
|---|---|
| `GKOD_CLAUDE` | Path of the `claude` command. Without it the bridge looks on the `PATH`, then in `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. |
| `GKOD_MCP_PYTHON` | The MCP server's Python. Default: `mcp/.venv/bin/python` in this checkout. |
| `GKOD_BRIDGE_WORK` | Where job folders go. Default: `gkod-bridge` in the system temp folder. A folder inside the repository is refused. |
| `GKOD_BRIDGE_PAIRING_FILE` | Where the pairing code is kept. Default: `bridge/.pairing` (git-ignored). |

`--new-code` makes a new pairing code; pages that remembered the old one must pair again.

## Pairing and who may call it

- It listens on `127.0.0.1:8765` only, so nothing else on the network can reach it, and it refuses any `Host` other than `127.0.0.1:8765` or `localhost:8765` (no DNS rebinding).
- On first start it makes a random pairing code, such as `K7QX-M2PD-9HTR`, and keeps it in `bridge/.pairing` (owner-only file, git-ignored), so a restart keeps the same code. Every request except `GET /health` must send it in the `X-GKod-Pairing` header. Case, spaces and dashes do not matter.
- Pages may call it only from `https://shriyamgera.github.io` and the local dev and preview servers (`http://localhost:5173`, `http://localhost:4173`, `http://127.0.0.1:5173`, `http://127.0.0.1:4173`). Any other `Origin` gets 403. Preflights are answered, including Chrome's Private Network Access header (`Access-Control-Allow-Private-Network: true`).

## What a job runs

`POST /run` with a JSON body: `kind` (`create`, `edit` or `repair`), and `prompt`, `instruction`, `code`, `error`, `request`, `image` (base64 JPEG or PNG, at most 4 MB, new parts only), `session_id` and `model` (`sonnet`, `opus`, `haiku`, `fable` or a full `claude-...` name) as that kind needs.

One job runs at a time; a second one gets 409. Each runs in a fresh folder in the system temp folder, outside the repository, as:

```
claude -p --input-format stream-json --output-format stream-json --verbose
  --system-prompt <GKod's prompt> --setting-sources ""
  --strict-mcp-config --mcp-config <only the GKod MCP server>
  --tools "" --allowedTools mcp__gkod__list_examples,...,mcp__gkod__preview_example
  --disallowedTools Bash,Edit,Write,Read,WebFetch,WebSearch,Task,Agent,...
  --permission-mode dontAsk [--model <model>] [--resume <session_id>]
```

- `--tools ""` switches off every built-in tool (no shell, files, web or agents), and the allow-list holds only GKod's five MCP tools. `dontAsk` refuses anything else without asking.
- `--setting-sources ""` loads none of the owner's settings files, so their memory, CLAUDE.md files, hooks and plugins stay out. The owner's normal login still works. (`--bare` would also skip them, but it only accepts an API key, not a Claude plan login.)
- The request goes in on stdin as one stream-json message. A picture goes in as an image block in that message, so no file tool is needed.
- The system prompt is in [gkod_bridge/prompts.py](gkod_bridge/prompts.py): the site's own code rules (a test keeps them the same as `app/src/engine/prompts.ts`), the Kobra 2 Neo's 220 x 220 x 250 mm build space, and how to test: compile, check, look at the picture, fix, at most 4 rounds. The answer ends with one OpenSCAD code block and one "Assumptions:" line.
- An edit sends `session_id`, and the job runs `--resume` in the folder that session was made in, so the same Claude Code session continues. Only a session the bridge made itself (one listed in its `sessions.json`) is continued; any other id starts a new session, so a page can never continue another of the owner's Claude Code sessions. If the session is gone, a new one starts (the edit holds the whole current code, so nothing is lost) and the answer says `resumed: false`. Job folders older than 7 days are deleted when the bridge starts.
- The time limit is 300 seconds. When it runs out, when the page goes away or on `POST /stop`, the whole process group (claude, the MCP server and what it started) gets SIGTERM, then SIGKILL 3 seconds later.

The answer is a stream of Server-Sent Events:

- `progress` `{"step": ...}`: plain steps from the tool calls: "Writing the part", "Compiling", "Checking", "Looking at the picture", "Fixing" (a compile after a failed compile or check), "Looking at the examples", "Starting a new session".
- `final` `{"code", "assumptions", "session_id", "resumed", "model", "ms", "turns"}`.
- `error` `{"problem", "message"}`, with `problem` one of `claude-missing`, `not-logged-in`, `usage-limit`, `timeout`, `no-code`, `stopped`, `failed`, and a plain message.

`GET /health` answers `{"ok", "bridge", "claude_found", "claude_version", "logged_in", "busy"}`. Only the logged-in flag is read from `claude auth status`; nothing about the account is passed on.

## Privacy and training

The request, the code and any picture go only to the owner's own Claude Code, under the owner's own plan. The bridge keeps no copy beyond the job folder; Claude Code keeps its session as it does for any session. Claude Code's output is shown to the owner only. It is never used to train the GKod model: the training data comes only from GKod's own seeded generator.

## Tests

```sh
bridge/.venv/bin/python -m pip install -r bridge/requirements-dev.txt
bridge/.venv/bin/python -m pytest bridge
```

The tests start the bridge on a free port with a fake `claude` ([tests/fake_claude.py](tests/fake_claude.py)) that prints hand-written stream-json lines, records how it was started and calls no model. They cover pairing, CORS and the preflight, the Host check, bad requests, progress steps, the code and Assumptions line, sessions, pictures, 409 when busy, stop, the time limit (killing a process that ignores SIGTERM, and its child), the page going away, and each error message.

One test uses the real `claude` and the owner's plan, so it only runs when asked:

```sh
GKOD_REAL_CLAUDE=1 bridge/.venv/bin/python -m pytest bridge/tests/test_real.py
```
