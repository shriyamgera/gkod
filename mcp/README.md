# GKod MCP server

Lets an MCP client compile GKod parts, run the print checks on them and look at them as pictures. It is a small Python server (package `gkod_mcp`, official MCP Python SDK 2.3.0) that talks over stdio and calls the Node [`gkod` command](../tools/README.md) for the real work, so it uses the same OpenSCAD build, flags and checks as the site.

## Tools

| Tool | What it does |
|---|---|
| `list_examples()` | The built-in parts (phone stand, wall hook, cable clip) with their named sizes: value, range and caption. |
| `compile_part(code, sizes=None)` | Compiles OpenSCAD code to an STL with the site's compiler and 10 second limit. `sizes` overrides named sizes without editing the code, e.g. `{"width": 100}`. Returns `ok`, `stl_path`, `params` (the named sizes), `error` (plain, with the line number), `log_tail` and `ms`. |
| `check_part(stl_path, printer="kobra2neo")` | The print checks: closed, fits the bed, sits flat, no steep overhangs. Returns a plain-words `summary` and the `checks` as JSON, with a fix for each failed check. |
| `render_part(code=None, stl_path=None, view="iso", mark_overhangs=True, sizes=None, printer="kobra2neo")` | A PNG picture of the part plus one line: size, triangles, and ready to print or what to fix. Give code (compiled first) or an STL path. |
| `preview_example(name, view="iso", printer="kobra2neo")` | Compile, check and picture of one example in one call, with its sizes and code. |

Views: `iso` (front right, from above, like the site's viewer), `front`, `side` (from the right) and `top`.

Printers: `kobra2neo` (Anycubic Kobra 2 Neo, 220 x 220 x 250 mm, the default), `p1s` and `a1` (Bambu Lab, 256 x 256 x 256 mm), `ender3v2` (Creality Ender-3 V2, 220 x 220 x 250 mm) and `mk4` (Original Prusa MK4, 250 x 210 x 220 mm).

The pictures use the site's paper and ink colours. The part sits on its patch of print bed with a 10 mm grid, sharp edges are inked, and its size in mm is written in the bottom left corner. Faces the overhang check flags are orange, and show through the part when they are underneath it.

Files go to `.gkod-out/` at the repository root (git-ignored), named by a short hash of the code and sizes. Set `GKOD_OUT` to use another folder.

`check_part` and `render_part` only read `.stl` files inside the repository or that output folder. A relative path starts at the repository root, and symlinks are followed before the test, so a link that points elsewhere is refused.

## Set up

Needs Python 3.12 and Node 22.18 or later, with the repository's Node packages and the OpenSCAD web build in place:

```sh
npm ci
npm run fetch:openscad
python3.12 -m venv mcp/.venv
mcp/.venv/bin/python -m pip install -r mcp/requirements.txt -e mcp
```

The server looks for Node in `GKOD_NODE`, then on the `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`, and uses the first one that is 22.18 or later.

If making the virtualenv or running pip fails with `Symbol not found: _XML_SetAllocTrackerActivationThreshold`, that Homebrew Python's XML module is linked against an older system libexpat. Putting `DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib"` in front of those two commands works around it; the server and the tests do not need it.

## Register it with an MCP client

It is a stdio server. The command is the virtualenv's Python with `-m gkod_mcp`, run from the repository root:

- command: `<repo>/mcp/.venv/bin/python`
- arguments: `-m gkod_mcp`
- working directory: `<repo>`

For a client that reads the common `mcpServers` JSON:

```json
{
  "mcpServers": {
    "gkod": {
      "command": "/path/to/gkod/mcp/.venv/bin/python",
      "args": ["-m", "gkod_mcp"],
      "cwd": "/path/to/gkod"
    }
  }
}
```

The package is installed into the virtualenv, so the server also starts from any other working directory; its files still go to `<repo>/.gkod-out` unless `GKOD_OUT` is set.

## Tests

```sh
mcp/.venv/bin/python -m pip install -r mcp/requirements-dev.txt
mcp/.venv/bin/python -m pytest mcp
```

The tests call every tool in-process, and one starts the server over stdio with the SDK's client, lists the tools and calls `preview_example("phone_stand")`.
