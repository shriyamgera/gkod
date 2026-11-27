# ml

The Python side of GKod: the benchmark harness ([bench/](bench)), the local model, the night-run script and, from
day 8, training. Everything here runs on the Mac (Apple silicon) in one virtualenv, `ml/.venv`.

## Setup

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" /opt/homebrew/bin/python3.12 -m venv ml/.venv
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python -m pip install -r ml/requirements.txt
ml/.venv/bin/python ml/scripts/fetch-model.py
```

Every pin is in [requirements.txt](requirements.txt) (mlx 0.32.4, mlx-lm 0.32.2, huggingface_hub 2.4.0,
transformers 5.23.0 and what they pull in). The tests also need [requirements-dev.txt](requirements-dev.txt)
(pytest 9.2.0): `ml/.venv/bin/python -m pip install -r ml/requirements-dev.txt`, then `ml/.venv/bin/python -m pytest
ml/train`.

On this Mac, Homebrew's Python 3.12 cannot load its XML module against the system's expat, and Python then also fails
to read the macOS version, which huggingface_hub needs. `DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib"` in front of
the command fixes it. Run pip as `ml/.venv/bin/python -m pip`, not `ml/.venv/bin/pip`: the repo path has a space, so
pip's launcher goes through `/bin/sh`, and macOS drops `DYLD_*` settings for system programs (`/bin/sh`,
`/usr/bin/time`, `/usr/bin/env`, `caffeinate`).

## The local model

| | |
|---|---|
| Model | [Qwen/Qwen2.5-Coder-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct) |
| Revision | `2e1fd397ee46e1388853d2af2c993145b0f1098a` (12 Jan 2025) |
| Licence | Apache-2.0 (its `LICENSE` file comes with the download) |
| Weights | `model.safetensors`, bf16, 3,087,467,144 bytes, sha256 `c1b9b30e907950516ba3c646bdf570d8084c25a6410a0cdca80cf04b11bc13a8` |
| Folder | `ml/models/qwen2.5-coder-1.5b-instruct` (git-ignored), 2.9 GB |

[scripts/fetch-model.py](scripts/fetch-model.py) downloads that revision, checks the weights' sha256, and refuses to
start if less than 8 GB of disk would be left. mlx-lm reads Qwen's bf16 safetensors directly, so nothing is converted:
the file on disk is the one Qwen published. The `mlx-community/Qwen2.5-Coder-1.5B-Instruct-bf16` conversion was not
used: it was made in September 2024 from an older revision, its chat template has a different default system line, and
it has no `generation_config.json`.

### Measured on this Mac

[scripts/smoke-local.py](scripts/smoke-local.py), 27 Nov 2026: five prompts from five fixed dev rows (create rows 0,
100, 200 and 275, so one per tier and a second new family, and edit row 0). Each prompt has the site's system prompt
and message wording, taken from [app/src/engine/prompts.ts](../app/src/engine/prompts.ts) itself. Zero-shot, greedy, at
most 2,048 answer tokens. The code is read by the site's rule ([bench/gkod_bench/extract.py](bench/gkod_bench/extract.py))
and compiled with the gkod command. This checks that the setup works. It is not a scored row.

M4 (10 cores), 16 GB, macOS 26.2, mlx 0.32.4, mlx-lm 0.32.2, bf16. The Mac was on battery (low power mode off).

| | |
|---|---|
| Load | 1.1 s (the weights had just been downloaded, so they were still in the disk cache; reading them cold from the SSD adds a few seconds) |
| Memory | 3.09 GB peak after loading, 3.33 to 3.43 GB peak while answering (MLX's own count) |
| Reading the prompt | 814 to 858 tokens/s (399 on the first prompt, while warming up) |
| Writing the answer, one prompt at a time | 29.0 to 29.7 tokens/s |
| Writing the answers, prompts in a batch | 26.6 tokens/s for 1, 83.9 for 4 and 144.4 for 8 at once, all answers counted (8 dev create prompts, 300 tokens each, peak 3.77 GB at 8) |

| Row | Tier | Family | Prompt tokens | Answer tokens | Seconds | Compiles |
|---|---|---|---|---|---|---|
| s201-000006 | t1 | battery_holder | 433 | 371 | 13.9 | yes |
| s202-000058 | t2 | channel | 438 | 270 | 9.7 | no: no code found |
| s203-000001 | t3 | comb | 446 | 2,048 (limit) | 71.3 | no: syntax error |
| s203-000759 | t3 | coaster | 417 | 163 | 6.0 | yes |
| e204-000000 | edit | divider | 655 | 175 | 6.7 | yes |

3 of 5 compiled. The channel answer had code but no opening fence, only a closing one, so the site's rule finds an
empty block and no code. The comb answer repeated the same `translate` and `cube` lines until it hit the 2,048-token
limit, and the cut-off code does not parse. Compiling says nothing about whether a part is right: the battery holder
compiles and passes every print check, but it wraps its battery-sized cylinders in one `hull()`, so it is a solid block
with no sockets at all.

## Night runs

[scripts/night-run.py](scripts/night-run.py) runs one long job overnight:

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/scripts/night-run.py --name NAME [options] -- COMMAND [ARGS ...]
```

- **Awake.** `caffeinate -dimsu -w <its own pid>` holds the Mac awake (display, idle, disk and system sleep, on AC
  power) until the script exits, through the command and any restart. caffeinate watches the script instead of
  starting the command itself, because macOS drops `DYLD_*` settings for anything a system program starts.
- **Log.** Everything the command prints (colour codes taken out) and every step of the script, with times, go to
  `results/logs/<yyyymmdd>-<hhmmss>-<name>.log`: the command, folder, repo commit, Python version, free disk and power
  come first.
- **Disk.** Free disk is checked every 3 minutes (`--disk-every`). Under 5 GB (`--min-free-gb`) the command gets
  SIGTERM, then SIGKILL after 2 minutes (`--grace`) if it is still running, and the run stops. It is not restarted.
  It also will not start under 5 GB.
- **Crashes.** Any exit code but 0 is a crash. The command is started again after 30 s (`--restart-wait`), up to 3
  times (`--max-restarts`). `results/logs/<name>.state.json` remembers the run (status, restarts, logs, losses, best
  checkpoint), so starting the same `--name` again after the Mac or the script died resumes it; a finished run is not
  run again unless `--fresh` is given. The command itself must carry on from where it stopped (the benchmark skips
  rows it has already written).
- **Training checkpoints.** With `--checkpoints DIR`, only the last two step checkpoints (`0000200_adapters.safetensors`
  and so on) and the one with the lowest validation loss are kept; the rest are deleted at every disk check and at the
  end, and `best.json` names the best. The losses are read from the trainer's output (mlx-lm's validation lines) or
  from `val_loss.jsonl` in that folder. A checkpoint's loss is the one reported at its own step, so set `--save-every`
  equal to `--steps-per-eval`. `--resume-args` adds arguments on a restart, with `{checkpoint}` and `{step}` taken
  from the newest checkpoint. Plain `mlx_lm.lora --resume-adapter-file` loads the weights but counts steps from 1 again
  with a new optimizer, so day 8's trainer takes the start step itself.
- **Power.** It refuses to start on battery unless `--allow-battery` is given.
- **Stopping.** Ctrl-C (or SIGTERM to the script) stops the command the same way and ends the run. Closing the
  terminal window does not. The window's hang-up (SIGHUP) goes to the whole job: the script ignores it, caffeinate runs
  in its own session so it never gets it, and the command runs in its own session too; the script then stops writing
  to the terminal and keeps the log. A wrapper that runs several rows must ignore the hang-up itself, as
  [night-baseline.sh](scripts/night-baseline.sh) does with `trap '' HUP`, or it dies and the next row never starts.
  Keep the lid open; macOS sleeps on a closed lid whatever caffeinate asks.

Exit codes: 0 finished, 1 still failing after the restarts, 2 could not start, 3 stopped for low disk, 130 stopped by
the owner.

`pytest ml/train` runs it on short dummy commands: a command that checks caffeinate is holding the Mac awake, a crash
and a restart, giving up, a missing command, too little disk before the start, the disk filling up during a run, a
command that ignores SIGTERM, battery, Ctrl-C, a closed terminal, the window's hang-up sent to the whole job of the
real night-baseline.sh with dummy rows (the first row finishes still held awake and the second row runs), a fake
trainer that crashes and resumes from its newest checkpoint while the last two and the best are kept, and a run started
again after the script died.

## Tonight: baseline rows on the dev set

```sh
sh ml/scripts/night-baseline.sh
```

[scripts/night-baseline.sh](scripts/night-baseline.sh) runs two rows of the untrained model on the 400 dev prompts (300
create, 100 edit), one after the other, each under the night-run script:

```sh
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib ml/.venv/bin/python ml/scripts/night-run.py --name baseline-dev-0shot -- \
  ml/.venv/bin/python -m gkod_bench run --engine local --split dev --shots 0
# then the same with --name baseline-dev-3shot and --shots 3
```

The benchmark names the rows `local-qwen2.5-coder-1.5b-instruct-0shot` and `-3shot`: greedy decoding, at most 1,024
answer tokens, the site's system prompt, and for `-3shot` the 3 fixed training examples (`gkod_bench fewshot` lists
them). A low-disk stop or Ctrl-C ends the night. A row that still fails after three restarts lets the next row run.
Started again, the script carries on: a finished row is not run again and an unfinished one resumes at its first
missing prompt. Only `--split dev` is read; the benchmark refuses the test split without `--final`.

Before starting: the Mac plugged in (the script refuses to start on battery), the lid open, the browser closed and no
other heavy work.

**How long: about 3.5 to 4.6 hours.** Worked out from the speeds measured above and the real prompt lengths (the
model's tokenizer on the benchmark's own prompts), plus 1 s a prompt for scoring:

| Part | Prompts | Prompt tokens (mean) | Answer tokens | Seconds a prompt | Hours |
|---|---|---|---|---|---|
| 0-shot, create | 300 | 433 | 250 to 405 | 10 to 15.5 | 0.8 to 1.3 |
| 0-shot, edit | 100 | 884 | 400 to 525 | 16 to 20 | 0.4 to 0.6 |
| 3-shot, create | 300 | 1,503 | 460 to 573 | 20 to 24 | 1.7 to 2.0 |
| 3-shot, edit | 100 | 2,872 | 460 to 573 | 21 to 26 | 0.6 to 0.7 |
| All | 800 | | | | 3.5 to 4.6 |

- Answer lengths: the low end is answers that stop by themselves (the four smoke answers that stopped averaged 245
  tokens; the reference code averages about 400 tokens for create and for edit; two 3-shot answers in a two-prompt
  check of this command were 458 and 464 tokens). The high end has 1 answer in 5 running to the 1,024-token limit, as 1
  in 5 did in the smoke test.
- Speeds: reading 850 tokens/s; writing 29 tokens/s for 0-shot (measured with nothing else running) and 27 for 3-shot
  (assumed a little slower for the longer prompts). With other work running the Mac wrote 21 to 22 tokens/s, and at 4%
  battery 15 to 25. At 22 tokens/s the night takes about 4.5 to 6 hours.
- Writing 8 answers at once gave 144 tokens/s in a throwaway test, about five times faster. The benchmark answers one
  prompt at a time, so tonight does not use it. Batched answers may not match one-at-a-time greedy answers token for
  token, so it would need its own check before any row used it.

## The benchmark harness

[bench/](bench) is the Python package `gkod_bench`. It runs one row (an engine with fixed settings) over the prompts of a
frozen split, once each, and scores every answer by code. Engine answers are results only: they go to `results/`
(git-ignored) and never into any training, dev or test data.

```sh
# on the Mac (with the local model):
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python -m pip install -r ml/requirements.txt -r ml/requirements-dev.txt -e ml/bench
# anywhere else (Gemini, Claude Code and the tests; numpy only):
python3.12 -m pip install -r ml/requirements-dev.txt -e ml/bench
```

It also needs Node 22.18 or later, the repo's Node packages and the OpenSCAD web build (`npm ci`, `npm run
fetch:openscad`), since compiling and the print checks run in the site's own code through `gkod batch`
([tools/README.md](../tools/README.md)).

```sh
ml/.venv/bin/python -m gkod_bench run --engine local|gemini|claude-code [--shots 0|3] [--split dev] [--limit N] [--row NAME]
ml/.venv/bin/python -m gkod_bench summarize --row NAME [--split dev]
ml/.venv/bin/python -m gkod_bench rescore --row NAME [--split dev]
ml/.venv/bin/python -m gkod_bench compare ROW_A ROW_B [--split dev]
ml/.venv/bin/python -m gkod_bench fewshot
```

- `run` asks the engine once per prompt and scores the answer. `--limit` runs only the next N prompts, so a row can be
  run in stages. Running the same command again carries on: prompts with a scored answer are skipped. The prompts come
  in a fixed mixed order (by the sha256 of their id), so a part-done row already covers every tier.
- `summarize` writes the summary again from the saved records. `rescore` scores the saved answers again with the
  current scorer (for a new measurer) without asking the engine. `compare` puts two rows side by side on the prompts
  both have answered. `fewshot` prints the fixed examples.
- Other options: `--tiers t1,t3`, `--model` (a local model folder, a Gemini model id or a Claude Code model name),
  `--adapter` (a trained LoRA folder for the local model), `--max-tokens` (1,024), `--temperature` (0) and `--seed`,
  `--rpm` (Gemini requests a minute, 10) and `--retries` (4), `--effort` (Claude Code), `--workers` (compiles at once
  while scoring, 4), `--no-slider-ends`.

**The test split stays closed.** Every command refuses `--split test` unless `--final` is given, before any engine
starts or any file is read; the data loader refuses it too. Only the day 10 run passes `--final`. A split's files are
checked against [datagen/sets-v1.sha256](../datagen/sets-v1.sha256) before they are used, and every row must belong to
the split it is read from.

### The same prompt for every row

- **Words.** Every engine gets the site's system prompt and the site's words for the request (`Make this part: ...`)
  or the edit (code A, then `Change it like this: ...`). They are read at run time from
  [app/src/engine/prompts.ts](../app/src/engine/prompts.ts) through `gkod batch`, so there is no copy to drift. The
  system prompt's sha256 is saved with the row, and a row cannot be resumed with a different one.
- **Answer.** The code is the first code block, by the site's rule ([app/src/engine/extract.ts](../app/src/engine/extract.ts)).
  [bench/gkod_bench/extract.py](bench/gkod_bench/extract.py) is a line-for-line copy; the shared cases in
  [bench/tests/fixtures/extract_cases.json](bench/tests/fixtures/extract_cases.json) are checked against the site's own
  code by `npm test` (tools) and against the copy by pytest.
- **One answer.** Single-shot rows ask once. An answer, once received, is final. A request that got no answer at all
  (a rate limit, a busy server, a dropped connection) is recorded as an error, not as a wrong answer, and the next run
  asks again; a run stops after 3 such prompts in a row.
- **Few-shot.** `--shots 3` puts 3 fixed training examples before the request, as earlier turns: the site's words for
  the example's request, then its code as one block (the way training rows write answers). They are picked by a rule
  written down in [bench/gkod_bench/data.py](bench/gkod_bench/data.py), not by how well they work: for create, the first
  spacer, plate and bracket in `train/create.jsonl` with exactly one feature (`s101-000008`, `s101-000090`,
  `s101-000002`); for edits, the first size, add and remove edits in `train/edit.jsonl` whose code A is at most 40 lines
  (`e102-000000`, `e102-000006`, `e102-000014`). Their ids and the train file's sha256 go into the row's `run.json`.
  The site's hand-written examples and anything under `prints/` are never used.

### Engines

| Engine | How it answers | Settings saved with the row |
|---|---|---|
| `local` | mlx-lm, the model loaded once, its own chat template, greedy decoding (or a fixed temperature and seed), at most 1,024 answer tokens | model folder, weights sha256, adapter and its sha256, decoding, mlx and mlx-lm versions |
| `gemini` | the Interactions API with the site's body (system instruction, input, `store: false`, thinking level low); few-shot examples go in as earlier steps (`user_input`, `model_output`) | model id, API, date; each answer keeps its date and the reply's model and token counts |
| `claude-code` | headless `claude -p`, zero-shot, with the GKod MCP server's compile, check and render tools and no other tool: the "with tools" row, reported apart from the single-shot rows | CLI version, model, effort, the tool list, the one added line, date; each answer keeps its models, turns, tool calls, time and cost |

- **Local.** One prompt at a time. The answer's token counts, speed, peak memory and whether it hit the token limit are
  saved with it.
- **Gemini.** The key is read from `.env` (`GEMINI_API_KEY`) when a request is sent, and is never printed, logged or
  saved. Unlike the site there is no fallback to another model: a row is one model. A 429, 5xx or network failure is
  sent again after a wait; a wrong key or a model the key cannot use stops the run.
- **Claude Code.** The session gets the site's system prompt (`--system-prompt`) plus one line saying the tools are
  there and that its last message is read as the answer (`--append-system-prompt`); the request goes in on standard
  input. Built-in tools are off (`--tools ""`), only the GKod server is loaded (`--strict-mcp-config`), no user or
  project settings are read (`--setting-sources local`), and only `compile_part`, `check_part` and `render_part` are
  allowed: `list_examples` and `preview_example` are denied, because they show the site's hand-written examples. Each
  answer checks the tool list the session reports and the run stops if anything else is there. It runs on the owner's
  plan, so run it in stages with `--limit` inside the 5-hour limit.

### Scores, all by code, for every prompt

- **Compiles.** The answer's code compiles with the site's pinned OpenSCAD build and rules: warnings are errors, no
  `minkowski()` or `text()`, 10 second limit, a non-empty mesh. A compile that hits the limit is compiled once more,
  alone, so a stall of the machine does not count against the code (both tries are saved).
- **Passes the print checks.** All four checks for the Anycubic Kobra 2 Neo bed (220 x 220 x 250 mm, 45 degree
  overhangs). False when it does not compile.
- **Meets the request.** Each fact the request states is marked pass, fail or unmeasured:
  - an overall size (a fact with an axis) passes when the answer's bounding box is within 0.5 mm on the side matched
    to that axis (two sides for a diameter). No prompt says which side is x, and some parts are drawn lying on their
    side (hooks, clips, saddles, handles), so the prompt's overall sizes are matched to the box's three sides in the one
    order that fits the most of them (then the smallest total error, then the order as drawn): a right part standing
    up passes. `meets_request_strict` keeps the stricter result, every size on the axis the reference is drawn with,
    as a second column that is labelled as such and is not the score;
  - stated hole counts (keys ending in `hole_count`, joined by `slot_count` when needed) are checked with the mesh's
    genus, its number of through holes. They are measured only when the reference part is one closed body whose genus
    is exactly the stated total, so the genus is known to count those holes and nothing else. The answer's count is the
    genus of all its closed surfaces added up, so a second piece brings its own holes and a hidden hollow brings none;
    an answer that is not closed fails the count, since the reference showed it can be counted;
  - every other fact (diameters, spacings, wall thickness, flags) is unmeasured until a measurer exists.

  A prompt meets the request when it compiles and every measured fact passes. With no part every measurable fact fails.
  A prompt with nothing measured is left out of that rate and counted on its own. Summaries give the measured and
  unmeasured counts, and the reasons.
- **Shape overlap.** Voxel intersection over union with the reference part (code B for an edit), after moving each
  bounding box's min corner to the origin, best of the 24 ways the answer can be set down on a face of its box (turns
  only, no mirror images), so a right part drawn lying another way scores 1. `iou_as_drawn` is the answer as drawn,
  not turned. The voxel size is the longer of the two parts' longest sides divided by 200; the 24 turns take 10 to 100
  ms a part. 0 when there is no part.
- **Edits: the size block.** The answer's named sizes, read by the compiler as the site's sliders read them, against
  code B: every kept size has the same name, value and caption; every changed size has its new value; every removed
  size is gone; every added size is there as a new size (a name code A did not have) with its value. Names of added
  sizes are free, so one is matched by its own name first and then by value. A size left in that no longer does
  anything counts as not removed. An answer that is code A, or whose part is code A's part (same STL), fails the size
  block, so sending code A back never passes an add, or a count edit that changes no named size (two gussets for one).
- **Slider ends** (extra). The answer is compiled at the min and at the max of each of its named sizes (up to 30).

Every scored prompt also compiles the reference again and saves whether its STL sha256 still matches the set's label.

### Files

| File | Holds |
|---|---|
| `results/raw/<row>/<split>/<id>.json` | One prompt: tier, family, the prompt (system sha256, the user words, the few-shot ids), the answer text, the code read from it, the engine's notes, the scores, the times and the harness commit. Written whole or not at all. |
| `results/<row>/<split>/run.json` | The row: engine settings, few-shot record, system prompt sha256, data files and their sha256, scoring settings, the harness commit at the start. |
| `results/<row>/<split>/summary.json` | Rates with 95% Wilson intervals overall, per tier (`t1`, `t2`, `t3`, `edit`) and per tier 3 family: compiles, print checks, meets the request (and the strict-axes column), measured facts (by measurer), shape overlap (best turn and as drawn, each a mean with a normal 95% interval, and median), slider ends, edit size blocks, why answers had no code, which checks failed, time per prompt, tokens or cost. It says how many prompts are done, missing or without an answer, and is marked incomplete until every prompt is scored. |
| `results/compare/<a>__vs__<b>/<split>.json` | Two rows on the prompts both answered: each rate, the difference A - B with Newcombe's interval for paired rates and the exact McNemar test, and for overlap the mean paired difference with the sign test; overall and per tier. |

### Checked so far

- All 400 dev reference parts, compiled again through `gkod batch`, give the STL sha256 the set recorded.
- Each reference's own code scored as the answer (30 create rows and 10 edits from dev): all compile, pass the checks,
  meet the request, overlap 1.0, every slider end compiles and every edit size block is right. Scoring takes about
  0.7 s a prompt with the slider ends.
- What can be measured on dev: for create, 914 of the 1,833 stated facts (699 overall sizes and 215 hole counts by
  genus, which covers 189 of the 191 `hole_count` facts), at least one in every prompt. For edits, 38 of 129, and only
  27 of the 100 edit prompts state anything measurable, so for edits the size block is the score that matters.
- Real calls, to prove the adapters (smoke checks in a throwaway folder, not scored rows): the local model on 8 dev
  prompts, zero-shot (5 compiled; 3 ran to the 1,024-token limit); Gemini 3 calls with gemini-3.1-flash-lite on one
  create prompt, zero-shot and with 3 examples (both compiled, passed the checks and met the request; the first
  3-example try was refused because this API version takes earlier turns as steps, now fixed); Claude Code 2 sessions
  (one only read the session's tool list; on one dev prompt the session had exactly the three GKod tools, compiled,
  drew and checked the part in 4 turns and 38 s, and its answer compiled, passed the checks and met the request, with
  an overlap of 0.87).

What these numbers do not show: the facts measured are only overall sizes and hole counts. A part can meet the request
here and still have holes in the wrong place, the wrong size or a missing feature that has no count; the shape overlap
is the score that catches some of that. Overall sizes and the overlap are checked whichever way the answer lies, so
they say nothing about whether it lies the way that prints best; the print checks cover that, and the strict columns
show how often an answer also lies as the reference is drawn. Every prompt, test included, comes from our own
generator.

`pytest ml/bench` covers the scorer on hand-made meshes (blocks of unit cubes with 0 to 4 through holes, two pieces, a
hidden hollow, open and flipped faces, holes added up over pieces) and on hand-written code through the real compiler
(full marks for the reference, a wrong size and a missing hole, missing holes behind a hidden hollow, the right part
stood up (it meets the request and overlaps 1, and fails only the strict columns), no code, broken code, a slider end
that breaks the part, an edit, a timeout tried again), the extractor cases, the intervals and paired tests, the data
loader and its hash and split checks, the few-shot rule, a whole row on a small hand-made set, resuming after a stop or
after errors, a resumed row with other settings, few-shot turns, the comparison, the closed test split in every command,
and the Gemini and Claude Code adapters against recorded replies (no real calls). With `GKOD_BENCH_LOCAL=1` it also
loads the local model and checks that greedy answers repeat exactly.
