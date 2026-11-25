# Spike: which base models to fine-tune

Date: 25 Nov 2026. Machine in mind: MacBook M4, 16 GB, MLX.

This is a written note. Nothing was trained and no model was downloaded.
About 0.2 MB of text (model metadata, docs, one config file) was fetched.

Two jobs:

- **(a) text to OpenSCAD**: a request, or existing code plus an edit instruction, in; OpenSCAD code out.
- **(b) picture to OpenSCAD**: a sketch or photo of a part in; OpenSCAD code out. Needs a vision-language model.

## How to read the labels

- **[checked]** = fetched today (25 Nov 2026) from the URL given. For numbers from the Hugging Face API the URL pattern is `https://huggingface.co/api/models/<model id>`.
- **[memory]** = not checked today. Treat as unverified.
- **[estimate]** = my own arithmetic, not a measurement. No LoRA run was done in this spike.

## Short answer

| Job | Pick | Fallback |
|---|---|---|
| (a) text to OpenSCAD | **Qwen2.5-Coder-1.5B-Instruct** | Qwen3-1.7B (and Qwen2.5-Coder-0.5B if the browser download must be tiny) |
| (b) picture to OpenSCAD | **Qwen3-VL-2B-Instruct** | SmolVLM2-2.2B-Instruct |
| Demo hosting | Text model **in the browser on WebGPU**; vision model on a **free ZeroGPU Space**; the visitor's own API key stays as the escape hatch |

The newest small family, Qwen3.5 (0.8B / 2B / 4B, text and vision in one model), looks like the obvious choice but is **not** recommended today: LoRA training on it is very slow in both MLX libraries (open issues, numbers below).

## What was run

All commands are read-only metadata fetches.

```sh
# parameter count, licence, gating, dates for each candidate
curl -s https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-1.5B-Instruct

# newest models per publisher (to find anything newer than the list we started with)
curl -s "https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=40"

# file sizes of the MLX 4-bit and browser (ONNX) conversions
curl -s "https://huggingface.co/api/models/mlx-community/Qwen2.5-Coder-1.5B-Instruct-4bit/tree/main"
curl -s "https://huggingface.co/api/models/onnx-community/Qwen2.5-Coder-1.5B-Instruct/tree/main/onnx"

# does the training library have the architecture? (HTTP 200 = folder exists)
curl -s -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/ml-explore/mlx-lm/main/mlx_lm/models/qwen2/__init__.py
curl -s -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/Blaizzy/mlx-vlm/main/mlx_vlm/models/qwen3_vl/__init__.py

# training docs
curl -s https://raw.githubusercontent.com/ml-explore/mlx-lm/main/mlx_lm/LORA.md
curl -sL https://raw.githubusercontent.com/Blaizzy/mlx-vlm/main/docs/training.md

# browser runtime's built-in model list and its memory figures
curl -s https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/config.ts | grep -A8 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'
```

Release versions seen today [checked, GitHub API]: mlx-lm v0.32.2 (16 Oct 2026, last push 24 Nov 2026); mlx-vlm v0.8.1 (23 Nov 2026); web-llm v0.2.89 (17 Nov 2026); transformers.js 4.3.2 (28 Oct 2026). `Blaizzy/mlx-vlm` now redirects to `Neywa-Labs/mlx-vlm`.

## Candidates for (a): text to OpenSCAD

Parameter counts and licences are [checked] from the Hugging Face API. "MLX 4-bit" is the total size of the `mlx-community/...-4bit` repo [checked]. "mlx-lm" means the architecture folder exists on `main` today [checked by HTTP 200 on `mlx_lm/models/<name>/__init__.py`]; LoRA in mlx-lm is generic over supported architectures (`mlx_lm.lora`, types `lora`, `dora`, `full`; a quantised model gives QLoRA) [checked: https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md].

| Model | Params | Licence | Public demo allowed? | MLX 4-bit | mlx-lm | Notes |
|---|---|---|---|---|---|---|
| Qwen2.5-Coder-0.5B-Instruct | 0.494 B | Apache-2.0 | Yes | 290 MB | yes (`qwen2`) | Smallest download; in WebLLM's built-in list |
| **Qwen2.5-Coder-1.5B-Instruct** | 1.544 B | Apache-2.0 | Yes | 880 MB | yes (`qwen2`) | Code-trained; in WebLLM's built-in list at 1,630 MB VRAM |
| Qwen2.5-Coder-3B-Instruct | 3.086 B | Qwen Research (non-commercial) | **Risky** | 1,748 MB | yes | Licence says "for non-commercial purposes only", defined as "research or evaluation" [checked: https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct/blob/main/LICENSE]. Skip. |
| Qwen2.5-Coder-7B-Instruct | 7.616 B | Apache-2.0 | Yes | not checked | yes | Too big for comfortable LoRA on 16 GB and for a browser [estimate] |
| Qwen3-1.7B | 2.032 B | Apache-2.0 | Yes | 984 MB | yes (`qwen3`) | General model with a thinking mode [memory]; in WebLLM's list at 2,037 MB |
| Qwen3-4B-Instruct-2507 | 4.022 B | Apache-2.0 | Yes | 2,279 MB | yes (`qwen3`) | Stronger, but 3.4 GB VRAM in the browser |
| Qwen3.5-0.8B / 2B / 4B | 0.873 / 2.274 / 4.660 B | Apache-2.0 | Yes | 652 / 1,749 / 3,061 MB | yes (`qwen3_5`) | Text + vision in one model. **LoRA is slow today**, see below |
| Gemma 3 1B (`gemma-3-1b-it`) | 1.000 B | Gemma terms, gated | Yes, with conditions | not checked | yes (`gemma3_text`) | Hosted service counts as distribution; the use restrictions must be passed on to users [checked: https://gemma.ai/resources/terms/] |
| Gemma 4 E2B / E4B | 5.123 / 7.996 B total | Apache-2.0, not gated | Yes | 3,583 MB (E2B) | yes (`gemma4`) | Text + image + audio. Total weights are much bigger than the "2B" name suggests |
| SmolLM2-1.7B-Instruct | 1.711 B | Apache-2.0 | Yes | not checked | yes (`llama`) [memory for the arch name] | Weak at code compared with a coder model [memory] |
| SmolLM3-3B | 3.075 B | Apache-2.0 | Yes | 1,747 MB | yes (`smollm3`) | In WebLLM's list at 2,053 MB |
| Phi-4-mini-instruct | 3.836 B | MIT | Yes | 2,180 MB | yes (config says `model_type: phi3`) | 3,438 MB VRAM in WebLLM |
| Aion-1.0-Instruct-2.3B (Microsoft, 18 Nov 2026) | 2.289 B | MIT | Yes | none found | **no** (`aion` folder is missing) | New; needs `trust_remote_code`; no coding scores on its card [checked: https://huggingface.co/microsoft/Aion-1.0-Instruct-2.3B] |
| DeepSeek-Coder-1.3B-instruct | 1.346 B | DeepSeek licence | Yes, with conditions | not checked | `deepseek` folder exists; this model is a Llama-style network [memory] | From 2023. Hosting is allowed but the use restrictions must be passed on [checked: licence file on the model page]. Older than Qwen2.5-Coder; no reason to prefer it |
| DeepSeek-Coder-6.7B-instruct | 6.741 B | DeepSeek licence | Yes, with conditions | not checked | as above | Too big for this machine and for a browser [estimate] |
| LFM2.5-1.2B / LFM3-1.7B (Liquid) | 1.170 / 1.729 B | LFM 1.0 (custom) | Yes for us | MLX builds exist | `lfm2` yes, `lfm3` **no** | Commercial use is free below USD 10 M revenue [checked: LICENSE in `LiquidAI/LFM3-1.7B`] |
| Granite 4.0 micro (IBM) | 3.403 B | Apache-2.0 | Yes | not checked | `granite` folder exists | Not looked at further |

No small Qwen3-Coder or Qwen3.5-Coder exists: the newest Qwen coder with open weights that showed up is Qwen3-Coder-30B-A3B (30.5 B), far too big [checked: Qwen org listing]. So Qwen2.5-Coder (late 2024) is still the newest *small* code-trained family.

### Why Qwen3.5 is not the pick today

- mlx-lm issue #1956 (open, 8 Oct 2026): LoRA on Qwen3.5-4B-Base 4-bit, M4 Pro 24 GB: **0.073 it/s at 16 layers, 0.139 it/s at 8 layers, 0.195 it/s at 5 layers; peak memory 12.6 to 14.8 GB**. Cause: the fast kernel for its linear-attention layers has no gradient, so training falls back to a slow loop. A fix PR (#2021) is open, not merged. [checked: https://github.com/ml-explore/mlx-lm/issues/1956]
- mlx-vlm issue #2690 (open, 7 Nov 2026): same layer type, forward plus backward about 5 times slower than forward and worse with length; a fix PR (#2691) is open. [checked: https://github.com/Blaizzy/mlx-vlm/issues/2690]
- 12.6 GB or more on a 24 GB machine for the 4B model means the 4B is out on 16 GB. The 2B would be smaller but nobody has published its numbers; it must be measured before we trust it.

Qwen2.5-Coder and Qwen3-VL are ordinary transformers and do not have this problem.

## Candidates for (b): picture to OpenSCAD

"mlx-vlm" means the architecture folder exists on `main` today [checked by HTTP 200]. The trainer supports LoRA, QLoRA, DoRA and full fine-tuning through `python -m mlx_vlm.train`, with rows of `{"images": [...], "messages": [...]}` [checked: https://github.com/Blaizzy/mlx-vlm/blob/main/docs/training.md]. The docs do not publish a per-model "tested for training" list, so "folder exists" is weaker than "someone trained it".

| Model | Params | Licence | Public demo allowed? | MLX 4-bit | mlx-vlm | Notes |
|---|---|---|---|---|---|---|
| Qwen2-VL-2B-Instruct | 2.209 B | Apache-2.0 | Yes | not checked | yes (`qwen2_vl`) | Base of Cadrille, a 2B picture-to-CAD model (see results) |
| Qwen2.5-VL-3B-Instruct | 3.755 B | Qwen Research (non-commercial) | **Risky** | 3,090 MB | yes (`qwen2_5_vl`) | It is the example model in the mlx-vlm training docs, but the licence rules it out for us |
| Qwen2.5-VL-7B-Instruct | 8.292 B | Apache-2.0 | Yes | not checked | yes | Too big for LoRA on 16 GB [estimate] |
| **Qwen3-VL-2B-Instruct** | 2.128 B | Apache-2.0 | Yes | 1,798 MB | yes (`qwen3_vl`) | A LoRA memory bug was fixed on 10 Nov 2026 (below). Browser build exists |
| Qwen3-VL-4B-Instruct | 4.438 B | Apache-2.0 | Yes | 3,110 MB | yes | Stronger, tighter on memory |
| Qwen3.5-2B | 2.274 B | Apache-2.0 | Yes | 1,749 MB | yes (`qwen3_5`); used in mlx-vlm's own training notebooks | One model for both jobs, but slow LoRA today (above) |
| Gemma 3 4B (`gemma-3-4b-it`) | 4.300 B | Gemma terms, gated | Yes, with conditions | not checked | yes (`gemma3`) | |
| Gemma 4 E2B | 5.123 B total | Apache-2.0 | Yes | 3,583 MB | yes (`gemma4`) | Biggest of the "small" ones on disk |
| SmolVLM2-2.2B-Instruct | 2.247 B | Apache-2.0 | Yes | not checked | yes (`smolvlm`) | Simple design; 256M and 500M siblings exist for the browser |
| SmolVLM2-500M | 0.507 B | Apache-2.0 | Yes | n/a | yes (`smolvlm`) | 358 MB browser build in its own repo [checked]; likely too weak to write code [memory] |
| Phi-3.5-vision-instruct | 4.147 B | MIT | Yes | not checked | yes (`phi3_v`) | The only vision model in WebLLM's built-in list (4,522 MB VRAM) |
| Phi-4-multimodal-instruct | 5.574 B | MIT | Yes | not checked | `phi4mm` folder exists | Big for 16 GB [estimate] |
| LFM2-VL-1.6B / LFM3-VL-2B | 1.585 / 1.918 B | LFM 1.0 | Yes for us | MLX builds exist | `lfm2_vl`, `d1_lfm3_vl` exist | Custom licence; training support not confirmed |

Open or recent mlx-vlm training issues that matter [checked: https://github.com/Blaizzy/mlx-vlm/issues, search "fine-tune OR lora OR train"]:

- #2512, Qwen3-VL LoRA used about 10 GB extra per step for one 900x420 image. Closed 10 Nov 2026 by PR #2705. With the offending call switched off in a test (not with the merged fix itself), the reporter measured, on Qwen3-VL-**8B** 4-bit, **1.58 GB above the resting model at 417 tokens and 5.42 GB at 1,921 tokens**. The v0.8.0 release notes (16 Nov) list PR #2705, so v0.8.0 or later includes the fix [checked: https://github.com/Neywa-Labs/mlx-vlm/releases]. Nobody has published memory numbers for the merged fix or for the 2B model.
- #2690, Qwen3.5 slow backward pass, open.
- #2178, resuming LoRA with `--adapter-path` trained 27 times more parameters than intended; closed 7 Sep 2026.
- No open issue was found saying SmolVLM, Gemma or Phi training is broken, and none saying it works.

## Memory for LoRA on 16 GB

Nothing was measured in this spike. Published numbers found today:

| Source | Model | Machine | Result |
|---|---|---|---|
| mlx-lm #1956 [checked] | Qwen3.5-4B-Base 4-bit | M4 Pro 24 GB | 12.6 to 14.8 GB peak |
| mlx-vlm #2512 [checked] | Qwen3-VL-8B 4-bit, offending call switched off in a test | M5 Pro 48 GB | resting model + 1.6 GB (417 tokens) to + 5.4 GB (1,921 tokens) |
| mlx-lm LORA.md [checked] | Mistral-7B, batch 1, 4 layers | M1 Max 32 GB | "should run reasonably fast", about 250 tokens/s |
| a third-party tool's benchmark page, seen only as a search summary, not opened | Qwen3-0.6B | M4 Pro 48 GB | 2.6 GB peak at 1,024 tokens, 18 GB at 4,096 tokens |

What this suggests for our picks [estimate]:

- Qwen2.5-Coder-1.5B, 4-bit base (0.9 GB), batch 2 to 4, sequences under 1,024 tokens: a few GB. Comfortable on 16 GB. Full-precision base (3.1 GB of weights) should also fit.
- Qwen3-VL-2B, 4-bit base (1.8 GB), one image of about 400 to 600 tokens, batch 1 with gradient accumulation: roughly 4 to 6 GB. Keep images small (for example 448 px) because memory grows with image tokens.
- 4B-class models: possible only with a 4-bit base, batch 1 and few layers; no headroom for anything else running.

The knobs, from the mlx-lm docs [checked]: quantised base (QLoRA), `--batch-size` (default 4), `--grad-accumulation-steps`, `--num-layers` (default 16), shorter examples, `--grad-checkpoint`. mlx-vlm has `--max-memory-gb`, which saves and stops when memory passes the limit [checked].

**These estimates must be replaced by real numbers from the training-speed spike.**

## Where a fine-tuned model can be hosted for free

### Hugging Face Spaces [checked: https://huggingface.co/docs/hub/spaces-zerogpu and https://huggingface.co/docs/hub/spaces-overview]

- **ZeroGPU**: a free personal account in good standing (verified email, account older than 30 days) can host **up to 2 ZeroGPU Spaces**. Gradio SDK only. GPU is half an RTX Pro 6000 Blackwell (48 GB VRAM); default 60 s per call.
- Visitor quota per day: **2 minutes unauthenticated, 5 minutes with a free account**, 40 minutes on PRO.
- **Static Spaces are free for everyone.** Ordinary Gradio and Docker Spaces on the free CPU (2 vCPU, 16 GB) now "require a paid plan to create". So a free always-on CPU backend on Spaces is not available to a free account; ZeroGPU is the exception.
- Free hardware sleeps when unused.
- Model storage: public repos are free on a "best-effort" basis, "beyond the first few gigabytes, please use this resource responsibly" [checked: https://huggingface.co/docs/hub/storage-limits]. Our models are 0.5 to 2 GB each, which fits.

ZeroGPU runs PyTorch, not MLX, so the LoRA adapter trained on the Mac must be fused and saved as standard weights first (`mlx_lm.fuse`; the docs mention de-quantising when fusing) [checked for the command; the full round trip is untested]. Our own site can call the Space as an API [memory].

### In the browser on WebGPU

- **WebLLM** v0.2.89 [checked: `src/config.ts` on `main`]. Built-in entries and their stated VRAM for 4-bit builds: Qwen2.5-Coder-0.5B 945 MB; **Qwen2.5-Coder-1.5B 1,630 MB**; Qwen2.5-Coder-3B 2,505 MB; Qwen3-1.7B 2,037 MB; Qwen3.5-0.8B 1,629 MB; Qwen3.5-2B 2,245 MB; SmolLM3-3B 2,053 MB; Phi-4-mini 3,438 MB; Gemma 4 E2B 3,387 MB. Only Phi-3.5-vision is marked as a vision model. A fine-tune needs its merged weights converted to the MLC format and hosted (for example on the Hub); a custom record takes `model`, `model_id` and `model_lib` [checked: https://webllm.mlc.ai/docs/user/advanced_usage.html]. Whether the existing compiled library for the same base model can be reused for our fine-tune is [memory] and must be tested.
- **transformers.js** 4.3.2 with ONNX Runtime Web [checked: https://huggingface.co/docs/transformers.js/guides/webgpu]. The docs put global WebGPU support at "around 85%" as of March 2026; Firefox and older Safari may need flags. Browser builds that exist today and their 4-bit (`q4f16`) sizes [checked, Hub file listings]: Qwen2.5-Coder-0.5B **555 MB**; Qwen2.5-Coder-1.5B **1,344 MB**; Qwen3-1.7B 1,426 MB; **Qwen3-VL-2B 1,373 MB** (all parts); Qwen3.5-0.8B about 646 MB and Qwen3.5-2B about 1,581 MB (decoder + embeddings + vision encoder). The docs page states no hard size limit; the roughly 2 GB single-file and 4 GB tab-memory ceilings are [memory]. A fine-tune has to be exported to ONNX and quantised by us; that step is untested.
- Practical size limit for a public demo [estimate]: keep the download under about 1.5 GB and VRAM under about 2 GB, or phones and older laptops will fail. That is why the 1.5B model is the ceiling for in-browser use and the 0.5B is worth training as a "lite" option.

### Other routes

- Visitor's own API key for a hosted model: always works, costs us nothing, and is the fallback for browsers without WebGPU. It is a comparison row, not "our model".
- Free CPU hosting elsewhere was not researched in this spike.

## Public results: what is a realistic target?

No public benchmark was found for a **small fine-tuned model writing OpenSCAD** with a reported compile rate. The closest results are for CadQuery, or for large closed models on OpenSCAD.

| Work | What it shows | Numbers | Who wrote its text and code |
|---|---|---|---|
| Text-to-CadQuery [checked: https://arxiv.org/html/2505.06507v1] | Six open models fine-tuned on about 170,000 text-to-CadQuery pairs | Share of outputs that fail to run: CodeGPT-small 124M **9.4%**; GPT-2 medium 355M 15.6%; GPT-2 large 774M 13.8%; Gemma-3-1B **8.4%**; Qwen2.5-3B **6.5%**; Mistral-7B with LoRA **1.32%** | Code written by **Gemini** 2.0 Flash; text comes from Text2CAD, which was machine-captioned [memory]. **Evaluation ideas only, never training.** |
| CAD-Coder (picture to CadQuery) [checked: https://arxiv.org/html/2505.14646] | A 13B vision model (LLaVA-1.5 with Vicuna-13B) trained on 163,671 image-code pairs, on 4 H100 GPUs for about 10 hours | On 100 test images: **100% valid syntax, IoU 0.675**. Untrained baselines: GPT-4.5 84% / 0.524; Qwen2.5-VL-72B 94% / 0.352. On five real photos: "broadly matched", no score | Code made by a **script** from existing CAD programs; images are renders. No GPT, Gemini or similar text. Same idea as ours. |
| CADPrompt / CADCodeVerify [checked: https://arxiv.org/html/2410.05340v2] | 200 objects, CadQuery | Compile rate without refinement: GPT-4 92.0 to 96.0%; Gemini 85.0%; CodeLlama 64.5 to 67.0% (73.5% with refinement) | Prompts and reference code written by **humans**. Safe as an evaluation set. |
| P3D-Bench [checked: https://arxiv.org/html/2606.11152v2, first 100,000 characters read] | 400 text cases, 400 image cases, 203 assemblies; models may answer in OpenSCAD | Large closed and open models writing **OpenSCAD**: valid rate **0.91 to 1.00** for text, 0.98 to 1.00 for images. Shape score is far lower: about 0.63 to 0.72 for text, **0.46 to 0.57 for images**. Small specialist models (CadQuery only): Cadrille 2B, image task, valid 0.82, shape 0.235; CAD-Coder 13B valid 0.37 | Text specifications written by **GPT**-5.5; filtering by **Gemini** 3.1 Pro; part annotations by another closed commercial model. **Evaluation ideas only.** |
| Text2CAD-Bench [checked, abstract only: https://arxiv.org/abs/2605.18430] | 600 "human-curated" examples in four difficulty levels | No numbers in the abstract | Abstract does not say whether a language model drafted the prompts. Unknown. |
| CADTestBench [checked, abstract only: https://arxiv.org/abs/2605.07807] | Tests that check whether a generated part meets the request | No numbers in the abstract | Not stated. Unknown. The idea (executable geometry tests) is worth copying. |
| `redcathode/thingiverse-openscad` [checked: dataset page] | 7,378 real OpenSCAD files scraped from Thingiverse with synthetic requests | none | Requests written by **Gemini** (`gemini-2.0-flash-exp`). Licence CC BY-NC-SA 4.0, creators not asked. **Do not train on it.** |
| `Max2475/Qwen3.5-9B-OpenSCAD-Instruct` [checked: model page] | A 9B LoRA fine-tune for OpenSCAD on about 139 samples | No results reported | Origin of the samples not stated. |

What this means for targets:

- **Compile rate is the easy part.** Fine-tuned 1B to 3B models reach 91 to 94% runnable code on CadQuery; a 7B with LoRA reaches about 99%. Caveat: those 1B to 3B models were fully fine-tuned (not LoRA) on about 170,000 pairs, and the paper's "Qwen2.5-3B" is the general model, not the coder one. A LoRA run on a laptop with far fewer examples is not the same setup, so treat 90% as a goal to test, not an expectation. OpenSCAD is a simpler language, and large untrained models already reach 91 to 100% on it. A fair first target for a fine-tuned 1.5B model on our own template parts is **90% or better compile rate**, with 95% as the stretch goal.
- **Getting the shape right is the hard part**, especially from a picture. Even the largest models score only about 0.5 to 0.6 on shape from an image, and a 2B specialist scores 0.24 outside its training set. For job (b) the honest first target is "works on clean renders and neat sketches of the part families we trained on", not "any photo".
- Our own benchmark should report compile rate and a geometry score (for example volume overlap against the reference part) separately, and should be scored by a program, not by a language model.
- Being apparently the first to publish a compile rate for a small fine-tuned OpenSCAD model is a real, checkable claim, as long as we say which test set.

## Recommendation

**(a) Text to OpenSCAD: Qwen2.5-Coder-1.5B-Instruct.**
Apache-2.0, 1.54 B parameters, 880 MB as an MLX 4-bit model, an ordinary transformer that mlx-lm trains without the Qwen3.5 slowdown, already in WebLLM's built-in list at 1.6 GB VRAM, and a 1.3 GB browser build exists for transformers.js. Trained on code, which should help with syntax.

- *Fallback:* **Qwen3-1.7B** (Apache-2.0, 2.03 B, 984 MB 4-bit, also in WebLLM). Use it if the coder model follows edit instructions poorly.
- *Lite option:* **Qwen2.5-Coder-0.5B-Instruct** (290 MB 4-bit, 555 MB browser build) for phones and slow connections. Cheap to train alongside, and "how small can it go" is a good result to show.
- *Watch:* **Qwen3.5-2B**. If the open fixes for slow training land, one Apache-2.0 model could do both jobs.

**(b) Picture to OpenSCAD: Qwen3-VL-2B-Instruct.**
Apache-2.0, 2.13 B parameters, 1.8 GB as an MLX 4-bit model, supported by the mlx-vlm trainer with its LoRA memory bug fixed this month, and a 1.4 GB browser build exists. Its older sibling Qwen2-VL-2B is the base of a published picture-to-CAD model, so the size class is known to work for this kind of task.

- *Fallback:* **SmolVLM2-2.2B-Instruct** (Apache-2.0, 2.25 B). Use it if Qwen3-VL training is unstable or too heavy on 16 GB.
- *Not chosen:* Qwen2.5-VL-3B (non-commercial licence), Gemma 4 E2B (3.6 GB at 4-bit, heavy), Qwen3.5-2B (slow training today).

**Demo hosting.**

1. **Text model in the visitor's browser on WebGPU.** No server, no quota, no cost, and the site stays a static site. Try WebLLM first (the base model is already supported there); keep transformers.js with an ONNX export as the second option.
2. **Vision model on one free ZeroGPU Space**, called from the site. Vision is used less often, the download would be heavy for a browser, and visitors get 2 to 5 free GPU minutes a day, which is plenty for a few pictures. This uses one of the two free ZeroGPU Spaces; the second can serve the text model for browsers without WebGPU.
3. **Visitor's own API key** as the last fallback and as a comparison row.

## Still unknown (do these next)

1. Real LoRA speed and peak memory on the M4 16 GB for Qwen2.5-Coder-1.5B and Qwen3-VL-2B. Every memory figure above for our picks is an estimate.
2. Whether a fused MLX fine-tune converts cleanly to (i) standard weights for ZeroGPU, (ii) the MLC format for WebLLM, (iii) ONNX for transformers.js. None of the three was run.
3. Whether SmolVLM2 actually trains in mlx-vlm today (folder exists, no report either way).
4. Whether Qwen2.5-Coder-1.5B writes usable OpenSCAD before any training (baseline compile rate).
5. The account that will own the Space must be older than 30 days with a verified email to get the free ZeroGPU slots.

## Limits of this note

- The GitHub API's anonymous limit (60 requests an hour) ran out part-way. I did not work around it; the remaining repository facts came from the public raw-file URLs and the normal web pages, which are different, documented endpoints.
- "Architecture folder exists" was checked by HTTP status only. I did not read the model code.
- Paper numbers were read from the arXiv HTML pages through a text extractor, not copied from the PDFs by hand. Check the tables again before quoting them publicly.
- Licence notes are a plain reading, not legal advice.
