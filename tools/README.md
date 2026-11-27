# @gkod/tools

The `gkod` command: the site's compiler, print checks and a picture of the part, from the command line. The [MCP server](../mcp/README.md) calls it. Needs Node 22.18 or later (it runs the TypeScript sources directly) and the OpenSCAD web build (`npm run fetch:openscad`).

```sh
npx gkod compile part.scad [-o out.stl] [-D width=100 ...] [--json]
npx gkod check part.stl [--printer kobra2neo|p1s|a1|ender3v2|mk4 | --bed 220x220x250] [--json]
npx gkod render part.stl|part.scad [-o out.png] [--size 900] [--view iso|front|side|top] [--mark-overhangs] [-D name=value ...] [--json]
npx gkod batch [--workers 4] [--printer kobra2neo|p1s|a1|ender3v2|mk4 | --bed 220x220x250] < jobs.jsonl
```

- **compile** uses the same OpenSCAD web build and rules as the site's compile worker: Manifold backend, `--hardwarnings`, no `minkowski()` or `text()`, a 10 second limit, and the same plain error messages. A path of `-` reads the code from standard input. Without `-o` the STL goes beside the code. `--json` prints `{ok, stl, triangles, params, log, ms, error}`, where `params` are the named sizes from OpenSCAD's parameter export.
- **check** runs [the print checks](../checks/README.md) for a printer's bed; the Anycubic Kobra 2 Neo is the default. The bed sizes are from each maker's spec page.
- **render** draws a PNG with a small rasterizer of our own (depth buffer, flat shading from two lights, drawn at three times the size and shrunk for smooth edges), encoded with `node:zlib`. `--mark-overhangs` paints the faces the overhang check flags in the accent colour. The bed grid has a line every 10 mm; for a part so big that those lines would crowd together it uses 100 mm, 1 m and so on, so drawing time does not grow with the part's size. `--json` gives the spacing in mm as `grid`.

- **batch** is for the [benchmark harness](../ml/README.md): one Node process that takes jobs as JSON lines on standard input and answers each with one JSON line, in the order they finish, each carrying its job's `id`. A `compile` job (`{id, op: "compile", code, defines?, stl?, check?}`) is compiled as `compile` does, with up to `--workers` compiles at a time, and gets `{ok, error, triangles, params, ms, log_tail, stl, stl_sha256, checks}`; the STL is written only to the `stl` path given, and `checks` is the print checks for the printer's bed with the 45 degree overhang rule. A `prompt` job (`{id, op: "prompt", request, answer?}`, the request a create `{kind, prompt}` or an edit `{kind, instruction, code}`) gets the site's system prompt and the words the site sends for that request, read from [app/src/engine/prompts.ts](../app/src/engine/prompts.ts), and `answer` written as one code block the way training rows write it. A line that is not a job gets an `error` and the batch carries on.

Exit codes: 0 done, 1 the part failed to compile or a check failed, 2 wrong options or a file that cannot be read.

`npm test` covers the option parsing, the batch jobs, replies and command, the benchmark's extractor cases against the site's `extractCode`, compiles that fail from deep recursion or too much detail, the PNG file, the view and framing maths, the rasterizer, and full pictures of the examples.
