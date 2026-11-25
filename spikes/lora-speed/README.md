# Spike: LoRA training and generation speed on a MacBook M4 (16 GB)

Day-1 feasibility test, run on 25 November 2026. It answers one question: how fast can
we fine-tune and run a small model that writes OpenSCAD on this laptop, so the training
plan can be sized.

Machine: MacBook M4, 16 GB RAM, macOS. MLX 0.32.4, mlx_lm 0.32.2, Python 3.14, Node 22.
Other apps (browser, editor, chat) were open during every run, and about 2.2 GB of swap
was already in use before the first run. The numbers are for a laptop in normal use, not
a clean machine.

## What was tested

1. A program that makes training examples (`make_dataset.py`): 7 part templates
   (mounting plate, L-bracket, wall hook, phone stand, cable clip, flanged spacer,
   open-top box), random sizes, and request wording built from phrase tables in the code.
   No language model writes any part of an example.
2. A timed LoRA run on Qwen3-1.7B (full bf16 weights).
3. A timed LoRA run on Qwen2.5-Coder-7B-Instruct, 4-bit.
4. Generation speed for both base models and for the 1.7B model with its new adapter,
   on 5 held-out requests, plus a real compile of every output.
5. A wall-time estimate for 20,000 examples for 2 epochs.

## Results

Everything in this section was run and measured here.

### Dataset

| | |
|---|---|
| Examples made | 600 train, 60 validation, 5 held-out test (no part repeats across splits) |
| Tokens per example (Qwen3 chat template) | 211 min, 293 mean, 426 max |
| Compiled with OpenSCAD WebAssembly | 665 of 665 gave a non-empty STL |

### LoRA training

All runs: rank 8 (the mlx_lm default), Adam, max sequence length 512.

| Run | Model | Batch | LoRA layers | Iterations | Tokens/s | Iterations/s | Peak memory | Validation loss start -> end | Train loss first -> last report |
|---|---|---|---|---|---|---|---|---|---|
| `small` | Qwen3-1.7B bf16 | 4 | 16 | 200 | 220 (197 to 241) | 0.19 | 9.70 GB | 3.727 -> 0.172 | 1.186 -> 0.146 |
| `small_b1` | Qwen3-1.7B bf16 | 1 | 8 | 40 | 302 (294 to 305) | 1.02 | 5.06 GB | 3.599 -> 0.578 | 1.562 -> 0.636 |
| `big` | Qwen2.5-Coder-7B 4-bit | 1 | 8 | 60 | 74 (70 to 77) | 0.26 | 6.80 GB | 2.045 -> NaN | NaN from the first report |
| `big_lowlr` | Qwen2.5-Coder-7B 4-bit | 1 | 8 | 30 | 75 (66 to 83) | 0.26 | 6.71 GB | 1.983 -> 0.719 | 2.114 -> 0.650 |

Notes on how to read the table:

- Tokens/s is the mean of the values mlx_lm prints every 10 iterations (every 2 for
  `big_lowlr`). Iterations/s is tokens/s divided by the mean tokens per iteration.
- This mlx_lm version does not print peak memory in its training table. Peak memory here
  is the "peak memory footprint" of the process from `/usr/bin/time -l`.
- Whole-run wall time, including loading and validation passes: `small` 1273 s,
  `small_b1` 58 s, `big` 701 s, `big_lowlr` 192 s.
- A validation pass over the 60 examples took 33 to 42 s on the 1.7B model and
  145 to 164 s on the 7B model. `small_b1` and `big_lowlr` used 15 validation examples,
  so their validation losses are not comparable with the full-set ones.
- **The 7B run at learning rate 1e-4 went to NaN** before iteration 10 and stayed there.
  At 1e-5 the loss was finite and fell. The speed is the same either way.
- **Memory is the limit, not the chip.** The `small` run pushed swap from 2.2 GB to
  5.8 GB in use and the system's free-memory figure dipped to 12%. With batch 1 and
  8 layers the same model used about half the memory and trained 37% more tokens per
  second. Bigger batches did not buy speed on this machine.
- The 7B run did not make swap grow (5.99 GB before, 5.46 GB after), and free memory
  stayed at 37% or more. It is slow rather than unstable.

### Generation (5 held-out requests, max 600 new tokens)

| Setup | Tokens/s (mean, range) | Mean time per part | Peak memory (MLX) | Compiles to a non-empty STL | Exact match with reference |
|---|---|---|---|---|---|
| Qwen3-1.7B base | 26.2 (25.3 to 27.1) | 12.3 s | 3.62 GB | 4 of 5 | 0 of 5 |
| Qwen3-1.7B + adapter from `small` | 22.4 (22.2 to 22.7) | 9.1 s | 3.70 GB | 5 of 5 | 5 of 5 |
| Qwen2.5-Coder-7B 4-bit base | 19.1 (18.3 to 20.7) | 16.5 s | 4.49 GB | 2 of 5 | 0 of 5 |

- The compile check is real: `compile_check.mjs` runs each output through the
  `openscad-wasm` npm package (0.0.4) in Node and counts it as a pass only when OpenSCAD
  exits cleanly and the STL has at least one facet. No native OpenSCAD binary was used.
- "Compiles" is not "correct". The base 1.7B outputs that compile are not the requested
  part (for example, a plate with 2D circles added instead of holes cut). Only the
  adapter outputs were checked for correctness, by exact text match with the
  program-made reference.
- The adapter is slower per token than the base because the adapter was applied
  unfused. It is still faster per part, because it writes code only, with no prose.
- 5 of 5 exact matches says the model learned these 7 templates. It says nothing about
  parts outside them. The test requests come from the same templates with unseen sizes.
  The 5 test requests cover 5 of the 7 templates; the flanged spacer and the open-top box
  were not in the test set.
- Qwen3 was run with thinking switched off (`enable_thinking=False`), which matches the
  empty think block the chat template puts in the training examples.

## Estimate: 20,000 examples for 2 epochs

This is arithmetic on the measured speeds, not a measurement.

Tokens to train on: 20,000 x 2 x 293 = 11.7 million.

| Model and setup | Measured tokens/s | Training time | Validation time included |
|---|---|---|---|
| Qwen3-1.7B, batch 1, 8 layers | 302 | about 10.8 hours | no |
| Qwen3-1.7B, batch 4, 16 layers | 220 | about 14.8 hours | no |
| Qwen2.5-Coder-7B 4-bit, batch 1, 8 layers | 74 to 75 | about 43 to 44 hours | no |

Things that would change these numbers:

- Real parts will be longer than these 293-token examples. Time scales with tokens, so
  examples twice as long take twice as long.
- The `small_b1` speed comes from a 40-iteration run. It was not checked over hours, and
  heat or other apps could lower it.
- Validation is extra: about 0.6 s per example on the 1.7B model and 2.5 s on the 7B.

### Which size is realistic for daily slices

- **The 1.7B class is realistic.** One hour trains about 0.8 to 1.1 million tokens,
  which is roughly 2,700 to 3,700 examples of this length. The full 20,000 x 2 job is
  10 to 15 hours, so it fits in one overnight run or a few daily slices resumed with
  `--resume-adapter-file`.
- **The 7B 4-bit model is not realistic for daily training here.** It fits in memory
  with batch 1 and 8 layers, but the same job takes about 44 hours, and it needed a
  10x lower learning rate to avoid NaN.
- On this data the 1.7B loss was already flat after 200 iterations (800 examples seen),
  so 20,000 x 2 is far more than these 7 templates need. The budget is better spent on
  more templates than on more copies.
- Use batch 1 or 2 and close the browser before a run. Batch 4 with 16 layers peaked at
  9.7 GB and swapped.

### Independent re-check (26 November 2026)

A second pass re-ran short samples on the same machine with more memory free
(75% free at the start, against a loaded machine in the first pass).

| Check | First pass | Re-check |
|---|---|---|
| Dataset rebuilt from seed 7, 665 answers compiled | 665 of 665 | 665 of 665, files identical |
| Qwen3-1.7B, batch 1, 8 layers, 20 iterations | 302 tokens/s, 5.06 GB | 430 to 433 tokens/s, 5.04 GB |
| Qwen3-1.7B, batch 4, 16 layers, 20 iterations | 220 tokens/s, 9.70 GB | 247 to 286 tokens/s, 9.66 GB |
| Qwen2.5-Coder-7B 4-bit, batch 1, 8 layers, lr 1e-4, 20 iterations | 74 tokens/s, NaN | 81 to 94 tokens/s, NaN by iteration 5, 6.70 GB |
| Generation, 1.7B base / with adapter / 7B base | 26.2 / 22.4 / 19.1 tokens/s | 26.5 / 22.9 / 17.9 tokens/s |
| Compiles, same order | 4, 5, 2 of 5 | 4, 5, 2 of 5; all 15 outputs identical text |

Losses matched the first pass to three decimals. Training speed depends strongly on how
much memory other apps hold: treat 300 tokens/s as the loaded-machine figure and about
430 as the figure with memory free, both for batch 1.

Licence note: the `openscad-wasm` npm package is GPL-2.0. Both models tested are
Apache-2.0. All of these numbers are for MLX on this Mac; none of them says how fast
the model would run for a visitor in a browser.

## Not tested (read, not run)

- A 4-bit copy of the 1.7B model was not made or tested. It should use less memory and
  generate faster, but there is no number for it here.
- Gradient checkpointing (`--grad-checkpoint`) and prompt masking (`--mask-prompt`) were
  not tried.
- Fusing the adapter into the model (`mlx_lm.fuse`) was not tried, so the fused
  generation speed is unknown.
- No run was longer than 21 minutes, so thermal throttling over hours is unknown.

## Commands

`MLX_BIN` is the `bin` folder of a Python environment with `mlx_lm` installed.
`SMALL` is a local copy of `Qwen/Qwen3-1.7B`.

```sh
# 1. data (same seed gives the same files)
python3 make_dataset.py --out data --train 600 --valid 60 --test 5 --seed 7

# 2. compile check of the data
npm install
for f in train valid test; do node compile_check.mjs data/$f.jsonl | tail -1; done

# 3. training: ./train.sh <name> <model> <iters> <batch> <lora layers> [extra flags]
export MLX_BIN=/path/to/venv/bin
./train.sh small "$SMALL" 200 4 16
./train.sh small_b1 "$SMALL" 40 1 8 --steps-per-eval 40 --val-batches 15
./train.sh big mlx-community/Qwen2.5-Coder-7B-Instruct-4bit 60 1 8 --steps-per-eval 30
./train.sh big_lowlr mlx-community/Qwen2.5-Coder-7B-Instruct-4bit 30 1 8 \
    --steps-per-eval 30 --val-batches 15 --learning-rate 1e-5 --steps-per-report 2

# 4. generation speed
"$MLX_BIN/python" gen_bench.py --model "$SMALL" --label small_base --no-think
"$MLX_BIN/python" gen_bench.py --model "$SMALL" --adapter adapters/small --label small_lora --no-think
"$MLX_BIN/python" gen_bench.py --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit --label big_base

# 5. compile check of the generated code
for l in small_base small_lora big_base; do node compile_check.mjs outputs/gen_$l.jsonl; done
```

`train.sh` fixes learning rate 1e-4, max sequence length 512, a loss report every
10 iterations, validation every 50 iterations on the whole validation set, and seed 0.
Flags given after the fifth argument override these.

## Files

| File | What it is |
|---|---|
| `make_dataset.py` | The example generator |
| `train.sh`, `mem_watch.sh` | Timed training run and the swap / free-memory logger |
| `gen_bench.py` | Generation speed test |
| `compile_check.mjs`, `package.json` | OpenSCAD WebAssembly compile check |
| `data/sample_train_first20.jsonl` | First 20 training examples |
| `data/test.jsonl` | The 5 held-out requests with reference code |
| `outputs/gen_*.jsonl` | Every generated answer with its speed numbers |
| `logs/` | Training, memory, generation and compile-check logs |

The full train and validation files, the adapters and `node_modules` are not kept in the
repository. Step 1 rebuilds the data exactly. Local paths in the logs were replaced with
`<local-models>`.
