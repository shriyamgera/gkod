# @gkod/tools

The `gkod` command: the site's compiler, print checks and a picture of the part, from the command line. The [MCP server](../mcp/README.md) calls it. Needs Node 22.18 or later (it runs the TypeScript sources directly) and the OpenSCAD web build (`npm run fetch:openscad`).

```sh
npx gkod compile part.scad [-o out.stl] [-D width=100 ...] [--json]
npx gkod check part.stl [--printer kobra2neo|p1s|a1|ender3v2|mk4 | --bed 220x220x250] [--json]
npx gkod render part.stl|part.scad [-o out.png] [--size 900] [--view iso|front|side|top] [--mark-overhangs] [-D name=value ...] [--json]
```

- **compile** uses the same OpenSCAD web build and rules as the site's compile worker: Manifold backend, `--hardwarnings`, no `minkowski()` or `text()`, a 10 second limit, and the same plain error messages. A path of `-` reads the code from standard input. Without `-o` the STL goes beside the code. `--json` prints `{ok, stl, triangles, params, log, ms, error}`, where `params` are the named sizes from OpenSCAD's parameter export.
- **check** runs [the print checks](../checks/README.md) for a printer's bed; the Anycubic Kobra 2 Neo is the default. The bed sizes are from each maker's spec page.
- **render** draws a PNG with a small rasterizer of our own (depth buffer, flat shading from two lights, drawn at three times the size and shrunk for smooth edges), encoded with `node:zlib`. `--mark-overhangs` paints the faces the overhang check flags in the accent colour.

Exit codes: 0 done, 1 the part failed to compile or a check failed, 2 wrong options or a file that cannot be read.

`npm test` covers the option parsing, the PNG file, the view and framing maths, the rasterizer, and full pictures of the examples.
