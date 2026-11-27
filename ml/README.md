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
  terminal window does not: the script ignores the hang-up, stops writing to the terminal and keeps the log. Keep the
  lid open; macOS sleeps on a closed lid whatever caffeinate asks.

Exit codes: 0 finished, 1 still failing after the restarts, 2 could not start, 3 stopped for low disk, 130 stopped by
the owner.

`pytest ml/train` runs it on short dummy commands: a command that checks caffeinate is holding the Mac awake, a crash
and a restart, giving up, a missing command, too little disk before the start, the disk filling up during a run, a
command that ignores SIGTERM, battery, Ctrl-C, a closed terminal, a fake trainer that crashes and resumes from its newest
checkpoint while the last two and the best are kept, and a run started again after the script died.

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
