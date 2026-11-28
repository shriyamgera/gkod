# ml

The Python side of GKod: the benchmark harness ([bench/](bench)), the local model, the night-run script and, from
day 8, training. Everything here runs on the Mac (Apple silicon) in one virtualenv, `ml/.venv`.

## Setup

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" /opt/homebrew/bin/python3.12 -m venv ml/.venv
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python -m pip install -r ml/requirements.txt -r ml/requirements-dev.txt -e ml/bench
ml/.venv/bin/python ml/scripts/fetch-model.py
```

Every pin is in [requirements.txt](requirements.txt) (mlx 0.32.4, mlx-lm 0.32.2, huggingface_hub 2.4.0,
transformers 5.23.0, matplotlib 3.11.2 for the learning-curve plot, and what they pull in). The tests also need
[requirements-dev.txt](requirements-dev.txt) (pytest 9.2.0) and the benchmark package (`-e ml/bench`), which the row
builder and its tests import; then `ml/.venv/bin/python -m pytest ml/train`. The row-builder tests also need Node and
the OpenSCAD web build (`npm ci`, `npm run fetch:openscad`); without them they skip as "gkod batch is not available".

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
  with a new optimizer, so day 8's trainer ([train/train.py](train/train.py)) takes the start step itself.
  `--keep-all` keeps every checkpoint instead (for a learning curve); `best.json` still names the lowest loss.
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
trainer that crashes and resumes from its newest checkpoint while the last two and the best are kept (and, with
`--keep-all`, all of them), and a run started again after the script died. These tests need macOS (caffeinate, pmset)
and skip elsewhere.

## Training

LoRA fine-tuning of the local model with mlx-lm, on the Mac. Three parts: build the rows, train under the night-run
script, and pick checkpoints by [PICK_RULE.md](PICK_RULE.md), which was committed before any training.

### Configs

[configs/base.toml](configs/base.toml) holds what every run shares. A run's own file names it with `extends` and adds
its row groups and its learning settings, which have no default on purpose. Run 1 is
[configs/run1-insurance.toml](configs/run1-insurance.toml), the Insurance-first plan: plain LoRA on frozen v1 train
rows, no generator changes.

| Setting | Run 1 |
|---|---|
| Rows | v1 train only. Weights at full size: 300 creates per family (4,500) and 1,200 edits toward the weak kinds (add 280, remove 330, count 260, scale 160, size 100, move 40, hole size 30). Run 1 asks for 5,600 rows (`[rows] count`, from the probe below) and gets 5,592 (below), one pass; `--rows` overrides it. |
| LoRA | rank 16, scale 20, dropout 0.05, on all 7 projections of the last 16 of the 28 blocks |
| Optimizer | Adam, learning rate 2e-5 (scale x rate = 4e-4), linear warmup over 5% of the steps from 1e-6, cosine decay to 2e-6 at the last step |
| Batch | 8 rows a step (an optimizer update): batch size 1 x gradient accumulation 8 (the probe below picked batch 1) |
| Loss | on the answer and its end (`<|im_end|>` and the newline after it) only (`mask_prompt`, with the padding target mlx-lm's own batches add left out, below) |
| Length | at most 2,048 tokens a row; longer rows are refused when the rows are built, never cut |
| Checkpoints | every 50 steps (400 rows) and at the last step, all kept: 14 in run 1 (steps 50 to 650, and 699); the validation loss at the same steps and at step 0, over all 100 validation rows |
| Gradient checkpointing | on (without it one 2,000-token row peaked at 11.3 GB in the probe) |
| Seed | 0 |

### Building the rows

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/train/build_rows.py \
  --config ml/configs/run1-insurance.toml --out data/train-rows/run1-insurance
```

[train/build_rows.py](train/build_rows.py) reads `data/sets/v1/train` only (checked against
[datagen/sets-v1.sha256](../datagen/sets-v1.sha256)) and the dev files only for their tree hashes. It writes, to
`--out` (git-ignored under `data/`):

- `train.jsonl`: chat rows `{"messages": [system, user, assistant]}`. The system prompt and the user words are the
  site's own, read at run time from [app/src/engine/prompts.ts](../app/src/engine/prompts.ts) through `gkod batch`,
  as the benchmark reads them. The answer is the generator's code in one `openscad` block.
- `valid.jsonl`: 100 fixed train rows, the same for every run so validation losses compare: 5 creates from each of
  the 15 families and 25 edits round-robin over the 7 kinds, by their own salt. No run trains on them; no dev row is
  ever one. No run trains on a row made from the same part either: every v1 train edit is made from a train create
  part, so a validation create's part is code A of some train edits, and a validation edit's part is a train create.
  Those rows are held out of training, so the validation loss is not read on near copies of training answers.
- `meta.json`: the row ids in file order with their prompt and answer token counts, the sha256 of every file read,
  the generator commits, the system prompt's sha256, the tokenizer files' sha256, the versions of Python,
  transformers, tokenizers, jinja2 and mlx-lm, the builder's commit, the selection report, every refused row with its
  reason, and the rows held out for sharing a part with a validation row.

A row is refused when it is not a train row, has no generator provenance or was made by a dirty generator, has a
failed or missing label, has a tree whose hash is in dev, shares 4 lines in a row with one of the site's examples
(`app/src/examples/*.scad`), or has more than 2,048 tokens (the whole chat, counted with the model's own tokenizer on
the CPU, exactly as mlx-lm's `ChatDataset` counts it). Any path under a test split folder is refused before it is
opened; a test checks that a whole build opens nothing there.

The row count is the config's `[rows] count` (5,600 for run 1) unless `--rows N` is given, and the batch size is the
config's `batch_size` unless `--batch-size` is given.

Selection: each group (a family, or an edit kind) takes its share of the row count (rounded down to whole steps) by
weight, its rows in the order of sha256(id + "sft-v1"). So a smaller run is the start of every group of a bigger one:
`--rows 2850` is the first half of every group. A group with too few rows gives all it has and the shortfall is
reported.

Order: rows are sorted by length, cut into batches of `--batch-size`, and the batches put in a seeded order. The
batch size the trainer uses must be the one the rows were built for (it checks). Same inputs, same bytes.

Measured on 28 Nov: the whole build takes 13 s. All 9,000 v1 train rows pass every check, and 77 (25 creates, 52
edits) are held out because they share a part with a validation row. Run 1 asks for 5,600 rows and gets 5,592: `add`
runs 5 rows short, and 3 come off `remove` to keep whole steps of 8. That is 4,423 creates (295 or 294 per family) and
1,169 edits (add 270, remove 321, count 255, scale 157, size 98, move 39, hole size 29), 4,961,450 tokens (887.2 a
row), of which 2,045,798 are answer tokens; the longest row has 2,003 tokens. (The plan's full size, `--rows 5700`,
gives 5,680 rows: `add` runs 10 short and 6 more come off `remove`.) The 100 validation rows have 91,304 tokens.
Before the hold-out (builder commit `72d335e`), 34 of the 100 validation rows (12 creates, 22 edits) shared a part
with a training row, 37 of the 5,600 training rows were such rows, and those 12 validation creates appeared word for
word as code A in training edit prompts. Two builds in a row gave byte-identical `train.jsonl`, `valid.jsonl` and
`meta.json` (the meta also names the builder's commit, so it changes when the code does).

### What the mlx-lm 0.32.2 source does (read in the installed package)

- `iterate_batches` sorts rows by `CacheDataset.itemlen`, which returns `len(self._data[idx])`: for a chat row that is
  the number of keys in its dict (1), so every row ties, the sort keeps the file order, and each batch is
  `batch_size` rows in a row of the file. Hence the length buckets above.
- With `mask_prompt`, `ChatDataset` takes the prompt as the chat without the answer plus the assistant opening. The
  tokens/s it prints counts answer tokens only.
- `default_loss` keeps the targets at positions from a row's prompt length up to and including its length, and
  `iterate_batches` gives it (prompt length, length). Position `length` is past the row's last token, so the stock
  trainer also takes the loss on one padding token per row (id 0, `!`, after `<|im_end|>` and the newline). Our
  trainer gives (prompt length, length - 1), so its loss covers the answer, `<|im_end|>` and the newline, and nothing
  else; the stock config from `--print-mlx-config` still has the padding target.
- `--resume-adapter-file` loads the weights but starts at step 1 with a new optimizer, so a resumed run would redo
  its warmup.
- `val_batches: -1` uses `len(valid) // batch_size` batches, so a part batch is dropped, and each validation runs
  before the step it is named after.
- `steps_per_eval` and `save_every` count forward passes; the learning-rate schedule counts optimizer updates.
- LoRA takes `scale`, not alpha, and with no `keys` it goes on every linear layer of the trained blocks. LoRA
  weights are float32.
- Options used, all present: `fine_tune_type` (lora, dora, full), `num_layers`, `lora_parameters` (rank, scale,
  dropout), `optimizer` (adam, adamw), `learning_rate`, `lr_schedule` (`build_schedule`: name, arguments, warmup,
  warmup_init), `batch_size`, `grad_accumulation_steps`, `grad_checkpoint`, `max_seq_length`, `save_every`,
  `steps_per_eval`, `val_batches`, `mask_prompt`, `seed`.

### Training

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/scripts/night-run.py --name run1-insurance \
  --checkpoints adapters/run1-insurance --keep-all --resume-args '--resume-from {checkpoint}' -- \
  ml/.venv/bin/python ml/train/train.py --config ml/configs/run1-insurance.toml \
  --data data/train-rows/run1-insurance --out adapters/run1-insurance
```

[train/train.py](train/train.py) uses mlx-lm's own parts (model loading, `linear_to_lora_layers`, `ChatDataset` with
the prompt masked, `default_loss`, `build_schedule`, gradient checkpointing, the same compiled step with gradient
accumulation) in a loop of its own, for the four things the stock trainer does not do: resume at the right step with
the optimizer state, keep every checkpoint, validate on every validation row, and log every loss. A step here is one
optimizer update (8 rows), so runs with other batch sizes line up by rows seen.

It writes to `--out` (git-ignored under `adapters/`):

| File | Holds |
|---|---|
| `0000050_adapters.safetensors`, ... | every checkpoint, never deleted; `adapters.safetensors` is the newest, and with `adapter_config.json` the folder loads as an mlx-lm adapter |
| `0000050_optimizer.safetensors` | the optimizer state at a checkpoint, for resuming; the last two are kept |
| `train_log.jsonl` | one line per step (train loss, learning rate, answer tokens, all tokens, padded tokens, the step's seconds and the time since the start or resume, tokens/s by the clock, peak memory), per validation and per save |
| `val_loss.jsonl` | the validation losses, as night-run reads them (step 0 is the untrained model) |
| `run.json` | the plan, the schedule, the same run as a stock mlx-lm config, the sha256 of train.jsonl, valid.jsonl, meta.json and the base weights, the config files, the trainable weight count, the status, and for each start and resume the git commit, the sha256 of every file in `ml/train` and `ml/configs` (with the diff, when they had uncommitted changes) and the versions (Python, mlx, mlx-lm, transformers, tokenizers, jinja2, numpy) |

- **Size.** Each checkpoint holds 10,551,296 float32 LoRA weights, about 42.2 MB (worked out from the model's
  config; a test checks the formula against real LoRA layers; the saved files are 42,229,570 bytes). Run 1 (5,592
  rows) has 699 steps and 14 checkpoints, about 0.59 GB, plus two optimizer files of about 84 MB.
- **Memory.** After every forward pass (training and validation) the trainer hands MLX's cached buffers back
  (`mx.clear_cache()`), as mlx-lm's own trainer does by default. Without it MLX keeps a buffer for every padded width
  it has seen and the wired limit lets them stay wired: in the first probe the untrained validation pass reached about
  12 GB wired and 4.8 GB of swap before it was stopped.
- **Resume.** night-run passes `--resume-from` the newest checkpoint after a crash. The trainer loads its weights
  and optimizer state, skips the batches already trained and carries on the schedule. Dropout draws a fresh key per
  batch from the seed and the batch number, so a resumed run ends where an unbroken one does (a test checks this on a
  tiny model). It refuses to resume with other settings, other rows or other base weights, and refuses a fresh start
  into a folder that already has checkpoints.
- **Checks at start.** The base weights' sha256 must match the config; the rows' files must match their meta.json;
  every row must tokenize to the counts it was built with. A real run (not `--dry-run`) refuses to start or resume
  with uncommitted changes in `ml/train` or `ml/configs`, so `run.json` always names the code that trained it;
  `--allow-dirty` overrides that and saves the diff.
- **Other options.** `--dry-run` prints the plan (steps, warmup, learning rates, checkpoint count and size) without
  loading the model. `--print-mlx-config` prints the same run as a stock `mlx_lm.lora` config, as a fallback without
  resume or the loss log. `--adapter-folder STEP` makes `at/<step>/`, a folder that loads one checkpoint, for
  `gkod_bench run --adapter`. For the probe: `--batch-size` and `--grad-checkpoint` (the rows must be built for the
  same batch size), `--max-steps N` (the schedule stays the full run's), `--peak-memory-cap-gb` (exit code 4 when
  passed; under night-run that counts as a crash), and `build_rows.py --longest-first` (the longest batches first).

`pytest ml/train` also covers the row builder on a hand-made set with the site's real wording (each refusal, the
validation rows, byte-identical builds, the length buckets, a changed set file, no file opened under the test split,
test paths and links into it refused), the selection rules and the run 1 config, the plan (steps, accumulation,
warmup, learning rates against mlx's own schedule, refused plans, every option present in the installed mlx-lm), and a
tiny random model trained on the CPU: every checkpoint kept and logged, a crash resumed to the same weights as an
unbroken run, also under night-run, a resume with other settings refused, a checkpoint loaded back as an mlx-lm
adapter, and the memory cap. With the model's real tokenizer (on the Mac) it checks that each row's prompt is
byte-for-byte the benchmark's local-engine prompt and that the answer tokens start the loss. These tests never load
the model's weights or use the GPU; the ones that need mlx, the tokenizer or macOS skip elsewhere.

### The probe (28 Nov)

Measured on this Mac: M4 MacBook Air (no fan), 16 GB, on mains power, nothing else heavy running, mlx 0.32.4 and
mlx-lm 0.32.2, read from `train.py`'s own log. Probe and smoke files went to `results/smoke/` (git-ignored).

The probe file had 40 run 1 rows: the 8 longest first (1,970 to 2,003 tokens, one step, the memory worst case), then
32 ordinary rows (883 tokens on average; run 1's average is 888). Speed is counted by the clock: every real token of
the rows (prompt and answer, not padding) divided by the step's wall time. mlx-lm's own trainer prints answer tokens
only (with the prompt masked that is about 41% of them), so its number would read about 0.41 of these. Peak is MLX's
own count (`mx.get_peak_memory`); the cap was 9 GB.

| Setup | Peak | 8 longest rows | 32 ordinary rows | 100 validation rows |
|---|---|---|---|---|
| batch 1, no checkpointing, 16 layers | 11.26 GB, over the cap (12.9 GB wired, swap grew 0.6 GB) | 247 tokens/s | not run (stopped at the cap) | 141 s |
| batch 2, checkpointing, 16 layers | 7.23 GB | 201 tokens/s | 216 tokens/s (0.12 passes/s, 0.25 rows/s) | 178 s |
| **batch 1, checkpointing, 16 layers (picked)** | **5.55 GB** | **262 tokens/s** | **227 tokens/s (0.26 passes/s = rows/s)** | not run (8 rows: 14 s) |
| batch 1, checkpointing, all 28 layers | 5.75 GB | 134 tokens/s | 137 tokens/s | not run (8 rows: 17 s) |

- Picked: batch 1 with gradient checkpointing on the last 16 layers. It had the lowest peak and was at least as fast
  as batch 2, which pads its pairs and validated more slowly. All 28 layers (18.5M LoRA weights) was about 40% slower
  here and stays out of run 1.
- Tokens/s = passes/s x batch x tokens per row: 0.257 x 1 x 883 = 227.
- Each setup ran only 5 steps, so these numbers include compiling each new padded width, and the Mac warmed up from
  one setup to the next. The smoke run below is the longer measure.
- The first try of the first setup found a trainer bug: MLX's buffer cache was never cleared, and the untrained
  validation pass alone reached about 12 GB wired and 4.8 GB of swap before it was stopped. Fixed before any number
  above was taken (see "Memory" above).

**Smoke run.** Run 1's settings on 480 rows (`build_rows.py --rows 480`, so the first rows of each of run 1's
groups), 60 steps, checkpoints at 20, 40 and 60, under night-run exactly as run 1 will run (caffeinate, `--keep-all`,
`--resume-args`). 40 min 34 s in all.

- Speed: 240.5 tokens/s over the 60 steps (234, 238 and 250 in each third), 29.5 s a step, 0.27 rows/s; answer tokens
  alone 98.7/s. It did not slow down from the first step to the last (35 minutes).
- Peak 5.52 GB; swap did not grow.
- Validation (100 rows): 145 s untrained, then 177, 176 and 162 s.
- Losses fell: validation 0.713, 0.123, 0.073, 0.064 at steps 0, 20, 40, 60; training loss 0.332, 0.106, 0.072 over
  the steps up to each checkpoint.
- The checkpoints load in the benchmark's local engine. The curve code (`run_curve`, called with a 5-prompt subset of
  dev-curve: one per tier and a second edit, results under `results/smoke/`) scored all three: right part 1, 1 and 2
  of 5, compiles 3, 4 and 4 of 5, no answer at the token limit. This checks the pipeline. It is not a result; it is
  a pipeline check, logged as one in PICK_RULE.md.
- The smoke run's losses include one padding target per row (mlx-lm's stock spans, see above); run 1's leave it out,
  so its losses are not directly comparable with these.

**Run 1's size,** from the smoke run's speed:

| | |
|---|---|
| Rows | 5,592 (4,961,450 tokens), one pass |
| Steps | 699 of 8 rows; warmup 35 |
| Checkpoints | every 50 steps and at step 699: 14, so 15 points on the learning curve with step 0 |
| Validation | at steps 0, 50, ..., 650 and 699: 15 times, about 170 s each, about 43 minutes |
| Training | 4,961,450 tokens at 240.5 tokens/s: 5.7 hours |
| In all | about 6.5 hours (6.25 to 6.6 at the fastest and slowest thirds of the smoke run's speed) |

The rows are built again with the hold-out (`data/train-rows/run1-insurance`, builder commit `2015ea5`, `train.jsonl`
sha256 `d8f40496…79a5`; `valid.jsonl` is byte for byte the one before) and `train.py --dry-run` gives the plan
above. Not started yet. To start it (Mac plugged in, lid open, browser closed, nothing else on the GPU, and no
uncommitted changes in `ml/train` or `ml/configs`):

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/scripts/night-run.py --name run1-insurance \
  --checkpoints adapters/run1-insurance --keep-all --resume-args '--resume-from {checkpoint}' -- \
  ml/.venv/bin/python ml/train/train.py --config ml/configs/run1-insurance.toml \
  --data data/train-rows/run1-insurance --out adapters/run1-insurance
```

## Learning curve

`gkod_bench curve` scores every saved checkpoint of a training run on dev-curve, a fixed set of 50 dev prompts, so the
curve shows where more training stops helping. It describes a run; [PICK_RULE.md](PICK_RULE.md) picks checkpoints, on
full dev.

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python -m gkod_bench curve --run adapters/run1-insurance
```

It loads the model on the GPU, so it runs after training, never beside it: it refuses a run whose `run.json` still says
`running` (`--even-if-running` only if the trainer was killed). Under night-run it carries on after a crash:

```sh
DYLD_LIBRARY_PATH="$(brew --prefix expat)/lib" ml/.venv/bin/python ml/scripts/night-run.py --name curve-run1 -- \
  ml/.venv/bin/python -m gkod_bench curve --run adapters/run1-insurance
```

**How long:** in the smoke run (15 answers, 3 checkpoints, one prompt at a time) the trained model wrote 27.3 tokens/s
per answer with its adapter (25.5 by the clock with the prompt read), answers averaged 390 tokens and none hit the
limit: 15.3 s an answer plus about 1 s of scoring. So 50 prompts take about 14 minutes a checkpoint, and run 1's 14
checkpoints about 3.2 hours, if its answers are about as long. Step 0 costs nothing (below).

### dev-curve

[bench/subsets/dev-curve.json](bench/subsets/dev-curve.json) holds the 50 ids and the sha256 of the two dev files they
were picked from. The rule, in [bench/gkod_bench/subsets.py](bench/gkod_bench/subsets.py) (seed `dev-curve-v1`):

1. Each tier is a quarter of dev, so it gets a quarter of the 50: t1 13, t2 12, t3 12, edit 13. Tiers 2 and 3 get 12
   because 12 splits their 4 and 3 families evenly.
2. Inside a tier, prompts are sorted by group, then by sha256(`dev-curve-v1:` + id). The group is the family for t1,
   t2 and t3, and (edit kind, tier of the part edited, family) for edits.
3. Of the n prompts of a tier, the ones at places floor((i + 0.5) x n / quota), i = 0 to quota - 1, are taken. Every
   group then gets its share of the quota, rounded down or up.

| Tier | Prompts | Spread |
|---|---|---|
| t1 | 13 | 13 of the 15 families, one each (no bracket, no knob) |
| t2 | 12 | 3 each of bracket, channel, plate and tray |
| t3 | 12 | 4 each of coaster, comb and corner plate |
| edit | 13 | size 5, remove 3, count 2, add 1, scale 1, hole size 1, move 0; parts from t1 5, t2 4, t3 4 |

- The first 50 prompts in the benchmark's own order, the earlier plan, had 17 t1, only 5 t2, 12 t3 (8 of them combs)
  and 16 edits, so PICK_RULE.md now names this file instead (changed on 28 Nov, before any dev look).
- `gkod_bench subset dev-curve` checks the file against its rule on the current dev files and prints the spread
  (`--write` makes it again). A test does the same where the dev files are (the Mac).
- `gkod_bench run --subset dev-curve` runs any row on these prompts only. The row checks the dev files against the
  subset's sha256, keeps the ids in its `run.json`, and is never the same row as a full one.
- The untrained zero-shot row has 7 of the 50 right (14%, 95% interval 7 to 26%), all of them edits. On full dev it
  has 10.2%.

### What the command does

- **One row per checkpoint.** For each checkpoint, in step order, it makes `at/<step>/` in the run folder (the folder
  `train.py --adapter-folder` makes) and runs an ordinary benchmark row, `dev-curve-<run>-s<step>`, on the subset: the
  local engine with that adapter, greedy, at most 1,024 answer tokens, the site's system prompt and the same scorer as
  every row. So everything a row does holds: one record per prompt, it resumes at the first missing prompt, it refuses
  other settings, and `summarize`, `rescore` and `compare` work on it.
- **One look per checkpoint.** A checkpoint whose row is complete is not asked again. A row that was scored with
  another file at the same step (a run trained again into the same folder) is refused.
- **Step 0** is the untrained model. It is read from `local-qwen2.5-coder-1.5b-instruct-0shot` when that row was made
  with the same settings (the run's base weights, zero-shot, greedy, one prompt at a time, the same token limit, mlx
  versions, system prompt, set files and slider-end scoring) and has every subset prompt done; checked on 28 Nov, it
  does. Otherwise step 0 is scored as its own row, `dev-curve-base-<model>`. `--no-base` leaves it out.
- **Stages.** `--max-checkpoints N` scores at most N points now. `--plot-only` scores nothing and writes `curve.json`
  and the plot from what is scored (it also works while training runs). `curve.json` is written again after every
  checkpoint.

`results/curve/<run>/dev-curve.json` (git-ignored) holds:

| Key | Holds |
|---|---|
| `points` | One per checkpoint, step 0 first: the step, rows seen, the row, the adapter's sha256, `train_loss` (each step's training loss weighted by its answer tokens, over the steps since the previous checkpoint, with those steps named), `valid_loss` (at that step, the 100 validation rows), then right part (with the checks it failed), compiles, print checks, stated sizes match, the overlap's median and mean, answers with no code and answers cut off at the token limit, each rate with its 95% Wilson interval, and the same per tier. |
| `saturation` | The two rules below, each with the end-of-run check, and for the paired rule the smallest gain it can call real. |
| `full_dev_candidates` | The checkpoints PICK_RULE.md sends to full dev, once every checkpoint is scored: the last, and the best on dev-curve if that is another one (of checkpoints tied on that count, the later). |
| `guess_ceiling` | The guess ceiling of the subset's 37 create prompts, when dev's has been worked out. |
| `scorer_commits` | The harness commits that scored the points; a note asks for `rescore` when there is more than one. |

`dev-curve.png` beside it draws right part with its 95% interval (top) and the two losses (bottom) against the step,
on one step axis, with dashed and dotted lines where the two rules put the end of the rise, or the words "not
saturated within this run" when the curve still rises at the end.

### Where the curve stops rising

Both rules read the scored points in step order, step 0 included, and stop at the first point not fully scored.

- **End of the run first:** the curve is still rising when the last point has more right parts than every earlier
  one, or when a trend test over the last half of the points (at least 3; Cochran-Armitage, one-sided p below 0.05)
  finds a rise. Then neither rule names a step: the file says "not saturated within this run" and why, and more
  training may still help. The trend test treats the points as separate samples although they share their prompts;
  answers to one prompt agree from one checkpoint to the next, so its p is if anything too large.
- **Interval rule:** the earliest point s with two points after it, neither of which has a right-part rate above the
  upper end of s's 95% Wilson interval, and no later point above it either. A point that is flat for two points and
  then rises is skipped (and reported as `first_flat` when no point qualifies), so a late rise never reads as a stop.
  Fewer than three points: no answer yet.
- **Paired rule** (PICK_RULE.md's saturation point): the earliest point that no later point beats by a real margin,
  that is with more right parts and an exact McNemar p below 0.05 on the prompts both answered. A point among the last
  3 is never named: too few later points can test it.

With 50 prompts the upper end of the 95% interval sits about 11 to 14 points above the rate (for rates from 10 to
50%), and the paired rule needs 6 prompts gained with none lost (p = 0.03) to call a gain real, so both rules see only
large steps. Without the end-of-run check they named a stop on curves that never flatten: on made-up curves of 15
points with +2 right parts per checkpoint (5 to 33 of 50), the paired rule named step 600 (29 right, against 33 at the
end: 4 to 0, p 0.125) and the interval rule step 0. With it, both say "not saturated within this run" for +2 and +1 per
checkpoint, and a curve that flattens at step 400 gets step 300 from both: a plateau is found, but at or before where
it starts. On made-up flat curves (each prompt right with its own chance, drawn again at every checkpoint) the check
wrongly says "still rising" in about 6% of runs. Read both next to the plot; neither picks.

### Batched answers (`--batch N`, off by default)

mlx-lm 0.32.2 has batched generation: `batch_generate` and `BatchGenerator` in `mlx_lm/generate.py` (read in the
installed package). `curve --batch N` and `run --batch N` make the local engine answer the next N prompts at once.
It keeps the plain path's rules: the prompt tokens by
`stream_generate`'s rule, the greedy sampler, the model's stop tokens, the same token limit (a stop token is counted
in the token count, as `stream_generate` counts it), and the text put together by the same streaming detokenizer. A
temperature with batches is refused. The batch size goes into the row's settings and its name (`-b8`), so batched and
one-at-a-time answers never mix and a row cannot change mode when resumed.

**Can batched greedy answers differ from one-at-a-time answers? Yes** (read in the source, not measured):

- Padding does not leak into the answers. Prompts are right-padded for the prompt pass, where the causal mask keeps
  real tokens from seeing the pads after them; the cache is then rolled so the pads sit on the left, a left-padding
  mask hides them while answering, and each prompt keeps its own RoPE positions. Answers that finish leave the batch.
- The numbers can differ. The batch runs other shapes and kernels: an explicit mask array in the prompt pass instead of
  the fused causal path, a matrix product over N rows at each answer step instead of one, attention over the padded
  length, and a batch that shrinks as answers finish. In bf16 that changes the last bits of the logits. Greedy takes
  the top token, so where the top two are within rounding one token can flip, and the rest of the answer follows from
  there.
- Which prompts share a batch changes the padded length, so a batched row resumed after a crash can give other
  answers than an unbroken one.
- On the CPU only, a tiny random Qwen2 model (not the real weights) with the real tokenizer gives the same text, token
  counts and endings both ways (a test). That checks the plumbing, not the real model on the GPU.

**Measured on the real model (28 Nov, smoke run):** the 5 smoke prompts at each of its 3 checkpoints, once one at a
time and once in batches of 5, compared with `same_answers`:

| | One at a time | Batches of 5 |
|---|---|---|
| Answer time, 15 answers | 230 s | 91 s |
| Tokens/s by the clock | 25.5 | 64.4 (2.5 times faster) |
| Peak memory | 3.94 GB | 4.57 GB |
| Same text as one at a time | | 6 of 15 (1, 3 and 2 of 5 at steps 20, 40, 60) |

In the other 9 answers the text first differs at character 92 to 791. The scores happened to match here (the same
right parts and compiles at every checkpoint), but 15 answers say little. So batched answers are not the same answers:
curve numbers in any write-up come from the plain rows, and full-dev rows for picking always use the plain path. A
batched row is for a quick look only, and its name says so (`-b5`). To check again on other rows: `gkod_bench
same-answers ROW ROW-b8` and `gkod_bench compare` on the same two rows.

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
ml/.venv/bin/python -m gkod_bench curve --run RUN_FOLDER [--subset dev-curve] [--batch N] [--max-checkpoints N] [--plot-only]
ml/.venv/bin/python -m gkod_bench subset [dev-curve] [--write]
ml/.venv/bin/python -m gkod_bench same-answers ROW_A ROW_B
```

- `run` asks the engine once per prompt and scores the answer. `--limit` runs only the next N prompts, so a row can be
  run in stages. Running the same command again carries on: prompts with a scored answer are skipped. The prompts come
  in a fixed mixed order (by the sha256 of their id), so a part-done row already covers every tier. A row carries on
  only with the engine settings, few-shot examples, system prompt, set files (by sha256) and scoring settings it began
  with; every record keeps the sha256 of the set file its prompt came from, and `summarize` and `rescore` refuse a row
  whose set files have changed, so answers scored against two versions of a set never mix.
- `summarize` writes the summary again from the saved records. `rescore` scores the saved answers again with the
  current scorer (for a new measurer) without asking the engine. Both work out the split's guess ceiling first if it
  has none yet (a few minutes for dev's 300 create prompts, once; `run` only reads it). `compare` puts two rows side
  by side on the prompts both have answered. `fewshot` prints the fixed examples.
- Other options: `--tiers t1,t3`, `--model` (a local model folder, a Gemini model id or a Claude Code model name),
  `--adapter` (a trained LoRA folder for the local model), `--max-tokens` (1,024), `--temperature` (0) and `--seed`,
  `--rpm` (Gemini requests a minute, 10) and `--retries` (4), `--effort` (Claude Code), `--workers` (compiles at once
  while scoring, 4), `--no-slider-ends`, `--subset` (only the prompts of a fixed dev subset, such as dev-curve) and
  `--batch` (the local model answers that many prompts at once; off by default, see "Learning curve").
- `curve`, `subset` and `same-answers` are described under "Learning curve" above.

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
- **One answer.** Single-shot rows ask once. An answer, once received, is final. A request that got no answer for a
  reason that passes (a rate or usage limit, a busy server, a dropped connection, a session that did not start) is
  recorded as an error, not as a wrong answer, and the next run asks again; a run stops after 3 such prompts in a row.
  A prompt the engine turns down (Gemini's 400, after the try without the thinking setting), or that runs out of time
  (Claude Code's 900 s) or turns, is the engine's answer: it is scored as no code and counts in every rate, so a row
  cannot drop the prompts it fails on. Summaries count these as `engine_failures`. A run stops after 3 of them in a
  row, since that is more likely the setup than the model.
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
  sent again after a wait; a wrong key or a model the key cannot use stops the run; a prompt turned down is an answer
  with no code.
- **Claude Code.** The session gets the site's system prompt (`--system-prompt`) plus one line saying the tools are
  there and that its last message is read as the answer (`--append-system-prompt`); the request goes in on standard
  input. Built-in tools are off (`--tools ""`), only the GKod server is loaded (`--strict-mcp-config`), no user or
  project settings are read (`--setting-sources local`), and only `compile_part`, `check_part` and `render_part` are
  allowed: `list_examples` and `preview_example` are denied, because they show the site's hand-written examples. Each
  answer checks the tool list the session reports and the run stops if anything else is there. It runs on the owner's
  plan, so run it in stages with `--limit` inside the 5-hour limit.

### Scores, all by code, for every prompt

- **Right part** (the headline, `right_part`). True only when the answer compiles, passes all four print checks,
  passes every measured stated fact (for a create these include its stated sizes read from its named sizes, below),
  overlaps the reference part by at least 0.99 (best turn, both parts compiled with `$fn = 48`), has as many separate
  pieces (shells) as the reference and as many through holes (genus, added up over its surfaces), and, for an edit,
  has the right size block. Each record keeps `right_part_failed`, the checks it missed; summaries count them. The
  rule is `right_part` in [score.py](bench/gkod_bench/score.py), and summaries and `compare` work it out again from
  each record's saved measurements, so records scored before it existed count too. The threshold is one constant,
  `RIGHT_PART_IOU`; how it was picked and what it cannot see are below.
- **Compiles.** The answer's code compiles with the site's pinned OpenSCAD build and rules: warnings are errors, no
  `minkowski()` or `text()`, 10 second limit, a non-empty mesh. A compile that hits the limit is compiled once more,
  alone, so a stall of the machine does not count against the code (both tries are saved).
- **Passes the print checks.** All four checks for the Anycubic Kobra 2 Neo bed (220 x 220 x 250 mm, 45 degree
  overhangs). False when it does not compile.
- **Stated sizes match** (`stated_sizes_match`; called "meets the request" before 28 Nov, and records still carry
  `meets_request` and `meets_request_strict` as copies). It is loose: a solid block of the right size passes for a
  tray, and in the picture review of the two baseline rows only 2 of the 69 create answers it passed (before stated
  sizes were read from code) were the part asked for. Each fact the request states is marked pass, fail or unmeasured:
  - an overall size (a fact with an axis) passes when the answer's bounding box is within 0.5 mm (plus 0.0001 mm, as
    the STL's corners are 32-bit numbers and 2.7 comes back as 2.70000005) on the side matched to that axis (two sides
    for a diameter). No prompt says which side is x, and some parts are drawn lying on their side (hooks, clips,
    saddles, handles), so the prompt's overall sizes are matched to the box's three sides in the one order that fits
    the most of them (then the smallest total error, then the order as drawn): a right part standing up passes.
    `stated_sizes_match_strict` keeps the stricter result, every size on the axis the reference is drawn with, as a
    second column that is labelled as such and is not a score;
  - stated hole counts (keys ending in `hole_count`, joined by `slot_count` when needed) are checked with the mesh's
    genus, its number of through holes. They are measured only when the reference part is one closed body whose genus
    is exactly the stated total, so the genus is known to count those holes and nothing else. When two counts make the
    total (the holes in each arm, or holes and slots), the genus measures only their sum: one added fact,
    `holes_total`, is measured and the two counts are marked unmeasured, so the right total in the wrong places passes
    once, not twice. The answer's count is the genus of all its closed surfaces added up, so a second piece brings its
    own holes and a hidden hollow brings none; an answer that is not closed fails the count, since the reference
    showed it can be counted;
  - for a create, every other stated size in mm that is a named size of the reference (a hole diameter, a slot
    width, a floor or a lip, a wall, a spacing: 630 facts on dev, all of them) is read from the answer's code, from
    its named sizes as the compiler lists them for the site's sliders. It passes when the answer's size of the same
    name has the stated value within 0.05 mm, or, when there is none of that name, when another named size has that
    value (for a diameter, a size named as a radius with half of it). This reads the code, not the mesh: a size that
    is hard-coded, or named and then not used as named, is not seen, and an answer that keeps its sizes inside a module
    fails. The site's system prompt asks every engine to put each size, hole and slot sizes included, at the top of the
    file as a named number, so the rule is the same for every row. It exists because the overlap cannot see these
    sizes: a 3.5 mm hole drawn 2.8 mm, or a 1.8 mm floor drawn 1.4 mm, still overlaps the reference by 0.99 or more.
    Edits leave sizes to the size block;
  - every other fact (flags such as countersunk holes or rounded corners, and an edit's stated sizes) is unmeasured
    until a measurer exists.

  Stated sizes match when the answer compiles and every measured fact passes. With no part every measurable fact
  fails. A prompt with nothing measured is left out of that rate and counted on its own. Summaries give the measured
  and unmeasured counts, and the reasons.
- **Shape overlap.** Voxel intersection over union with the reference part (code B for an edit), after moving each
  bounding box's min corner to the origin, best of the 24 ways the answer can be set down on a face of its box (turns
  only, no mirror images), so a right part drawn lying another way scores 1. `iou_as_drawn` is the answer as drawn,
  not turned. Both parts are compiled again for it with `-D $fn=48` (the generator's own value, so a reference keeps
  its mesh), which overrides the file's top-level `$fn`: a right cup with a 1.6 mm wall drawn with `$fn = 32`
  overlapped only 0.93 before, and one with no `$fn` 0.87. A `$fn` given inside one call (`cylinder(..., $fn = 6)` for
  a hexagon) is part of the shape and is kept, so an answer that sets coarse circles call by call is still marked
  down. If either part does not compile that way, both are compared as drawn (`iou_detail.fn` is then empty). The
  voxel size is the longer of the two parts' longest sides divided by 200, and the grid is a little off round numbers
  in x, y and z, so a flat face never sits exactly on a row of voxel centres; the 24 turns take 10 to 100 ms a part.
  0 when there is no part.
- **Edits: the size block.** The answer's named sizes, read by the compiler as the site's sliders read them, against
  code B: every kept size has the same name, value and caption; every changed size has its new value; every removed
  size is gone; every added size is there as a new size (a name code A did not have) with its value. Names of added
  sizes are free, so one is matched by its own name first and then by value. A size left in that no longer does
  anything counts as not removed. An answer that is code A, or whose part is code A's part (same STL), fails the size
  block, so sending code A back never passes an add, or a count edit that changes no named size (two gussets for one).
- **Slider ends** (extra). The answer is compiled at the min and at the max of each of its named sizes (up to 30). An
  answer with no named sizes has no sliders, so it fails this; summaries also give `has_named_sizes`, the share of
  compiled answers with any named size.

Every scored prompt also compiles the reference again and saves whether its STL sha256 still matches the set's label.

### How the right-part threshold was picked

Against the picture review of the two baseline rows (27 Nov): 156 compiled answers it described, each with its
verdict and the measurements `right_part` reads, are in
[bench/tests/fixtures/right_part_review.json](bench/tests/fixtures/right_part_review.json) (answers that did not
compile fail at any threshold and are left out). "Right" means the part asked for; for an edit, shape and sliders
both. "Near miss" means the right body with a small feature the review called wrong.

| Overlap needed | Right (11) | Wrong (142) | Near miss (3) |
|---|---|---|---|
| 0.95 | 11 pass | 3 pass | 3 pass |
| 0.98 | 11 pass | 1 pass | 3 pass |
| **0.99** (used) | **11 pass** | **0 pass** | **2 pass** |
| 0.995 | 10 pass | 0 pass | 1 pass |

- This evidence is thin. 10 of the 11 right answers overlap exactly 1, so they cannot test a threshold: four are code
  B word for word, and one (`e204-000000`, 3-shot) is code B with `$fn` left out, which was 0.9996 before shapes were
  compared at `$fn = 48`. So the cut rests on one right create, `s201-000014` (3-shot, 0.9904, 0.0004 above it), and
  one wrong answer, `s201-000019` (3-shot, 0.9847: the right L with both holes in the base instead of the upright, so
  the hole count matches), the highest wrong one that only the overlap fails. Any threshold above 0.9847 and up to
  0.9904 gives the 0.99 row. Only three other answers that fail nothing but the shape come anywhere near it (0.981,
  0.978 and 0.968).
- The counts above are after the evening rescore (28 Nov), which changed no verdict in the review.
- The two near misses that pass are rounded corners drawn square (`s201-000055`, 0.9968) or chamfered
  (`s203-000444`, 0.9911). A 2 to 4 mm corner is too small a share of the volume for the overlap to see, and no
  measurer reads corner style yet.
- The review had no right answer whose unstated sizes differ from the reference's (the untrained model never got that
  far), so it says nothing about how strict 0.99 is there. The guess ceiling below measures exactly that.

Checked again on built variants of known label, all 300 dev create references scored as answers through
`score_answer` (28 Nov, after the fixes):

| Variant | Should be | Before the fixes | After |
|---|---|---|---|
| Turned 90 degrees on the bed (code wrapped in a module) | right | 0 of 300 fail | 0 of 300 fail the shape (all overlap 1); 279 fail the stated sizes read from code, since the wrapping hides the named sizes |
| Moved by (13.37, -7.1, 0) (wrapped the same way) | right | 1 of 300 fails (a comb at 0.9887: a face on a row of voxel centres) | 0 of 300 fail the shape; 279 fail the sizes read from code, as above |
| `$fn = 32` | right | 9 of 286 fail (cups and grommets with 1.6 to 2 mm walls, down to 0.932) | 0 of 286 fail |
| `$fn` left out | right | 42 of 286 fail, 34 on the shape alone (down to 0.870) | 0 of 286 fail the shape; 8 coasters fail an overall size, since their coarse polygon really is more than 0.5 mm smaller |
| One stated size in mm at 0.8 of its value | wrong | 247 of 630 pass | 0 of 630 pass (the 247 that the shape alone lets through fail the sizes read from code) |
| One stated count plus 1 | wrong | 0 of 130 pass | 0 of 130 pass |
| The reference moved by numpy, against itself (400 dev parts) | right | 3 of 400 under 0.99 | 0 of 400 |

The wrapped variants say nothing new about the sizes read from code: those parts break the site's rule that every size
sits at the top of the file. The size variants keep the changed size named, which is the case the measurer reads; a
wrong size written as a plain number would still pass it.

### The guess ceiling

Some sizes are never stated (a tray's floor, a bracket's gussets), so even a perfect model has to guess them, and a
part with other unstated sizes overlaps the reference less. For each create prompt,
[ceiling.py](bench/gkod_bench/ceiling.py) compiles the reference again with every unstated named size set to its
train median and compares it with the reference by the same overlap. The ceiling is the share that still reaches 0.99.
Summaries give it next to right part for every group of create prompts, with right part on the same prompts. It is not
a hard limit: a model that guesses better than the median can beat it.

- **The guess.** Only `train/create.jsonl` is read (hash checked). The median of the same name over train parts of
  the same family; for a family train does not have (tier 3), over every train part; then the name's last two words
  (`arm1_hole_d` as `hole_d`). The lower middle value is used for an even count, so every guess is a value the
  generator used. A stated `compartment_count` states `divider_count` (one fewer). A name with no train guess at all
  (`arm_width`, `slot_depth`) keeps the reference value, so tier 3's ceiling leans high; summaries count those prompts
  (`kept_a_true_value`).
- **No clamping.** Guesses are not pulled into the reference's slider range: the generator builds each range up to
  30% either way of the true value, so clamping would leak it.
- **Saved** in `results/ceiling/<split>.json` with the sha256 of the split's create file and the train file, and
  worked out again when they change. It uses the create rows the split guard already let through, never more.

On dev (300 create prompts, worked out 28 Nov, and again after the voxel grid change the same evening, with the same
counts):

| Guess reaches | t1 | t2 | t3 | All |
|---|---|---|---|---|
| 0.99 (the ceiling) | 27 | 4 | 62 | 93 (31%) |
| 0.9 | 62 | 47 | 95 | 204 (68%) |

- Tier 2 adds features whose sizes requests seldom state (tray tabs, plate lips, gussets, floor thickness), so a
  median guess almost never reaches 0.99 there. Right part on tier 2 says little until a model guesses those sizes
  better than the median.
- 26 tier 3 prompts kept a true value (`slot_depth` 17, `arm_width` 9). 32 prompts state every named size, so their
  guess is the reference itself.
- An earlier planning count was 211 of 300 at 0.9 (tiers 65, 51 and 95). Clamping each guess into the reference's
  slider range gives exactly 65 and 51 for tiers 1 and 2 here too (212 in all), so the gap is the clamp, which leaks
  the true value. Tier 3 differs by one prompt, not traced.

### The baseline rows, scored again (28 Nov)

Both untrained rows were scored again from their saved answers with `rescore` (no model run), first when right part
was added (every earlier measurement came back the same), then again in the evening with the stated sizes read from
code, the overlap at `$fn = 48` and the voxel grid offset in z (`e67b943`). No right-part verdict changed; only two
overlaps moved by more than 0.005, both on wrong answers.

| Row (dev, 400 prompts) | Right part | Creates right (300) | Edits right (100) | Stated sizes match | Stated sizes read from code |
|---|---|---|---|---|---|
| `local-qwen2.5-coder-1.5b-instruct-0shot` | 10.2% [7.6, 13.6] | 0 | 41 | 6.9% of 333 (7.8% before the sizes read from code) | 270 of 630 |
| `local-qwen2.5-coder-1.5b-instruct-3shot` | 12.5% [9.6, 16.1] | 4 (2 are corner near misses) | 46 | 21.4% of 332 (22.6% before) | 433 of 630 |

The guess ceiling for both is 93 of 300 creates. The 3 three-shot edits with a right size block but not the right part
(`e204-000006`, `-062`, `-102`) are the three the picture review found wrong despite their size block.

### Files

| File | Holds |
|---|---|
| `results/raw/<row>/<split>/<id>.json` | One prompt: tier, family, the prompt (system sha256, the user words, the few-shot ids), the answer text, the code read from it, the engine's notes, the scores, the times and the harness commit. Written whole or not at all. |
| `results/<row>/<split>/run.json` | The row: engine settings, few-shot record, system prompt sha256, data files and their sha256, scoring settings, the harness commit at the start. |
| `results/<row>/<split>/summary.json` | Rates with 95% Wilson intervals overall, per tier (`t1`, `t2`, `t3`, `edit`) and per tier 3 family: right part (with the threshold and how many answers missed each check), the guess ceiling for create prompts (with right part on the same prompts), compiles, print checks, stated sizes match (and the strict-axes column), measured facts (by measurer), shape overlap (best turn and as drawn, each a mean with a Student t 95% interval, and median), slider ends, edit size blocks, why answers had no code, which checks failed, time per prompt, tokens or cost. It says how many prompts are done, missing or without an answer, and is marked incomplete until every prompt is scored. |
| `results/ceiling/<split>.json` | The split's guess ceiling: for each create prompt, the sizes guessed (reference value, guess, where the guess came from), those kept, and the overlap; the sha256 of the files it came from. |
| `results/curve/<run>/<subset>.json` and `.png` | A training run's learning curve on a dev subset (see "Learning curve"); `-b<N>` in the name when answered in batches. |
| `results/compare/<a>__vs__<b>/<split>.json` | Two rows on the prompts both answered: each rate (right part first), the difference A - B with Newcombe's interval for paired rates and the exact McNemar test, and for overlap the mean paired difference with a Student t interval and the sign test; overall and per tier. |

### Checked so far

- All 400 dev reference parts, compiled again through `gkod batch`, give the STL sha256 the set recorded.
- Each reference's own code scored as the answer (30 create rows and 10 edits from dev): all compile, pass the checks,
  match their stated sizes, overlap 1.0, every slider end compiles and every edit size block is right; on 28 Nov the
  same 40 were scored again and all are the right part. Scoring takes about 0.7 s a prompt with the slider ends.
- What can be measured on dev: for create, 1,501 measured facts for the 1,833 stated, at least one in every prompt.
  On the mesh, 699 overall sizes and 172 hole counts by genus: 129 of those are stated counts, and 43 are
  `holes_total` facts, each standing for two stated counts whose sum is all one genus can measure (33 corner plates, 7
  tool holders, 2 brackets and 1 plate); together they cover 189 of the 191 `hole_count` facts. From the code, 630
  stated sizes read from the named sizes (every other stated size in mm; each is a named size of its reference). Left
  unmeasured: the 135 flags, the 178 counts that are not hole counts, and the hole counts that only a total measures.
  For edits, 38 of 129, and only 27 of the 100 edit prompts state anything measurable, so for edits the size block is
  the score that matters.
- Real calls, to prove the adapters (smoke checks in a throwaway folder, not scored rows): the local model on 8 dev
  prompts, zero-shot (5 compiled; 3 ran to the 1,024-token limit); Gemini 3 calls with gemini-3.1-flash-lite on one
  create prompt, zero-shot and with 3 examples (both compiled, passed the checks and matched the stated sizes; the first
  3-example try was refused because this API version takes earlier turns as steps, now fixed); Claude Code 2 sessions
  (one only read the session's tool list; on one dev prompt the session had exactly the three GKod tools, compiled,
  drew and checked the part in 4 turns and 38 s, and its answer compiled, passed the checks and matched the stated
  sizes, with an overlap of 0.87).

What these numbers do not show: on the mesh, the facts measured are only overall sizes and hole counts. The overlap
does not see a change smaller than about a voxel or a small share of the volume: before the stated sizes were read
from code, 247 of 630 stated sizes changed to 0.8 of their value (one at a time, on the dev references) still passed
as the right part, among them 62 of 68 hole diameters, every base slot width, 23 of 54 lip heights and 3 of 8 floors.
Reading the stated sizes from the code catches those when the answer names them, but not a size it hard-codes, an
unstated size (a floor or a gusset the request never gives), a missing countersink, or a corner radius or small
chamfer (under about 1% of the volume); and on a symmetric part a feature moved to the matching other side can still
overlap 1. Right part also fails a right answer whose unstated sizes are guessed differently from the reference, so
read it next to the guess ceiling. Overall sizes and the overlap are checked whichever way the answer lies, so they
say nothing about whether it lies the way that prints best; the print checks cover that, and the strict columns show
how often an answer also lies as the reference is drawn. Every prompt, test included, comes from our own generator.

`pytest ml/bench` covers the scorer on hand-made meshes (blocks of unit cubes with 0 to 4 through holes, two pieces, a
hidden hollow, open and flipped faces, holes added up over pieces) and on hand-written code through the real compiler
(full marks for the reference, a wrong size and a missing hole, missing holes behind a hidden hollow, the right part
stood up (its stated sizes match, it overlaps 1 and is the right part, and it fails only the strict columns), no code,
broken code, a slider end that breaks the part, an edit, a timeout tried again, a stated hole size drawn wrong and the
same hole given by its radius, a thin-walled cup with a coarser `$fn` or none, and a six-sided cup), the stated sizes
read from named sizes (by name, by value, a radius for a diameter, no named sizes), a flat face on a row of voxel
centres, each right-part check on its own (print checks, a failed fact, the overlap just under and at 0.99, an extra
piece or a hidden hollow, the hole count, an open answer, the edit size block, no part, nothing measured), the
threshold against the picture review's verdicts, records written before the rename (they summarize and rescore), the
guess ceiling (the guess rule, the lower middle median, a changed train file refused, saved once and read back, a
wrong guess lowering the overlap, no file under `test/` opened), the extractor cases, the intervals and paired tests,
the data loader and its hash and split checks, the few-shot rule, a whole row on a small hand-made set, resuming after
a stop or after errors, a resumed row with other settings, other scoring settings or a remade set, prompts turned down
or timed out scored as no code, few-shot turns, the comparison, the printed headline, the closed test split in every
command, and the Gemini and Claude Code adapters against recorded replies (no real calls), and the learning curve with
a scripted engine and fake checkpoints: the subset rule (quotas and shares), the dev-curve file against its rule, a
row on a subset, every checkpoint scored on the same prompts as a plain row, the losses per point, both stopping rules
and the full-dev candidates on made-up numbers, a curve still rising at the end against one that flattens, the trend
test, stages, a stop inside a checkpoint resumed, a run still training refused, a checkpoint that changed refused,
step 0 borrowed from the baseline row only with the same settings, batched rows kept apart, `same-answers`, the
batched engine's queue, and its batched answers against one-at-a-time answers on a tiny random model on the CPU. With
`GKOD_BENCH_LOCAL=1` it also loads the local model and checks that greedy answers repeat exactly.
