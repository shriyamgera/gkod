"""LoRA training for GKod with mlx-lm 0.32.2, made to run under ml/scripts/night-run.py.

    ml/.venv/bin/python ml/train/train.py --config ml/configs/run1-insurance.toml \
        --data data/train-rows/run1-insurance --out adapters/run1-insurance [--batch-size N] [--dry-run]

It uses mlx-lm's own parts: model loading, the LoRA layers (linear_to_lora_layers), the chat dataset with the prompt
masked (ChatDataset), the loss (default_loss), the learning-rate schedule (build_schedule) and gradient checkpointing.
The loop around them is its own, because mlx-lm's train():

- counts steps from 1 again on --resume-adapter-file, with a fresh optimizer, so a resumed run redoes its warmup;
- with val_batches -1 still drops the last part-batch of the validation rows, and validates before the step it names;
- keeps no file of the losses.

Steps here are optimizer updates: one step is `effective_batch` rows (batch_size rows a pass, times gradient
accumulation), so checkpoints of runs with different batch sizes line up by rows seen. Rows are read in file order,
batch_size at a time; build_rows.py wrote them in length buckets of that size, and the batch size must match.

What it writes to --out:

- `0000050_adapters.safetensors` and so on: every checkpoint, never deleted here (the learning curve needs them all),
  and `adapters.safetensors` (the newest) with `adapter_config.json`, so --out loads as an mlx-lm adapter folder.
  `--adapter-folder STEP` makes `at/<step>/`, a folder that loads one checkpoint (for `gkod_bench --adapter`).
- `0000050_optimizer.safetensors`: the optimizer state at that checkpoint, for resuming; only the last two are kept.
- `train_log.jsonl`: one line per step (train loss, learning rate, tokens, seconds, peak memory), per validation (all
  the validation rows) and per save. `val_loss.jsonl` has the validation losses in the form night-run reads.
- `run.json`: the plan, the sha256 of the training files and of the base weights, the config files, the git commit,
  the versions, and each start and resume.

--resume-from CHECKPOINT carries on from that checkpoint's step: the same rows in the same order, the optimizer state
and the learning-rate schedule where they were. Dropout draws a fresh key per batch from the seed and the batch
number, so a resumed run trains like one that never stopped. It refuses to resume with other settings or data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

ML = Path(__file__).resolve().parents[1]
if str(ML) not in sys.path:
    sys.path.insert(0, str(ML))

from train.config import display, load_config, repo_path  # noqa: E402

REPO = ML.parent
CHECKPOINT = re.compile(r"^(\d+)_adapters\.safetensors$")
OPTIMIZER = re.compile(r"^(\d+)_optimizer\.safetensors$")
OPTIMIZERS = ("adam", "adamw")
FINE_TUNE_TYPES = ("lora", "dora")
LEARNING_KEYS = ("optimizer", "learning_rate", "warmup_fraction", "warmup_init", "decay_to")
OVERRIDABLE = ("batch_size", "grad_checkpoint", "save_every", "eval_every", "epochs", "peak_memory_cap_gb")
KEEP_OPTIMIZER_FILES = 2
EXIT_MEMORY = 4


class PlanError(ValueError):
    pass


class MemoryCap(RuntimeError):
    pass


def checkpoint_name(step: int) -> str:
    return f"{step:07d}_adapters.safetensors"


def optimizer_name(step: int) -> str:
    return f"{step:07d}_optimizer.safetensors"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


# The plan: every setting, worked out before anything heavy is loaded.


@dataclass(frozen=True)
class Plan:
    name: str
    model: str
    weights_sha256: str | None
    fine_tune_type: str
    num_layers: int
    rank: int
    scale: float
    dropout: float
    optimizer: str
    weight_decay: float | None
    learning_rate: float
    warmup_steps: int
    warmup_init: float
    decay_to: float
    effective_batch: int
    batch_size: int
    grad_accumulation: int
    rows: int
    epochs: int
    iters: int
    steps: int
    max_seq_length: int
    mask_prompt: bool
    grad_checkpoint: bool
    save_every: int
    eval_every: int
    seed: int
    peak_memory_cap_gb: float

    def lora_parameters(self) -> dict:
        return {"rank": self.rank, "scale": self.scale, "dropout": self.dropout}

    def decay_steps(self) -> int:
        """Cosine steps after the warmup, so the last update's rate is exactly decay_to x the peak."""
        return max(1, self.steps - self.warmup_steps - 2) if self.warmup_steps else max(1, self.steps - 1)

    def schedule(self) -> dict:
        """mlx-lm's lr_schedule (tuner.utils.build_schedule): linear warmup from warmup_init, then cosine decay."""
        end = float(f"{self.learning_rate * self.decay_to:.12g}")
        out = {"name": "cosine_decay", "arguments": [self.learning_rate, self.decay_steps(), end]}
        if self.warmup_steps:
            out["warmup"] = self.warmup_steps
            out["warmup_init"] = self.warmup_init
        return out

    def lr_at(self, update: int) -> float:
        """The learning rate update number `update` (1 = the first) uses, worked out the way mlx's schedulers do:
        the optimizer reads the schedule at its step count before it adds one."""
        step = update - 1
        peak, end = self.learning_rate, float(f"{self.learning_rate * self.decay_to:.12g}")
        w = self.warmup_steps
        if w:
            if step < w + 1:
                return self.warmup_init + min(step, w) * (peak - self.warmup_init) / w
            step -= w + 1
        s = min(step, self.decay_steps())
        return end + (peak - end) * 0.5 * (1 + math.cos(math.pi * s / self.decay_steps()))

    def checkpoint_steps(self) -> list[int]:
        return sorted({s for s in range(self.save_every, self.steps + 1, self.save_every)} | {self.steps})

    def eval_steps(self) -> list[int]:
        return sorted({0} | set(range(self.eval_every, self.steps + 1, self.eval_every)) | {self.steps})

    def adapter_config(self) -> dict:
        """What mlx-lm's load_adapters reads (fine_tune_type, num_layers, lora_parameters), plus the plan."""
        return {"fine_tune_type": self.fine_tune_type, "num_layers": self.num_layers, "lora_parameters": self.lora_parameters(), "model": self.model, "plan": asdict(self)}

    def mlx_lm_config(self, data: str, adapter_path: str) -> dict:
        """The same run as a config for stock `mlx_lm.lora -c` (a fallback without resuming, every-checkpoint saving
        or the loss log). Its iterations, eval and save steps count forward passes, so they are steps x accumulation."""
        config = {
            "model": self.model,
            "train": True,
            "data": data,
            "fine_tune_type": self.fine_tune_type,
            "optimizer": self.optimizer,
            "mask_prompt": self.mask_prompt,
            "num_layers": self.num_layers,
            "batch_size": self.batch_size,
            "iters": self.iters,
            "val_batches": -1,
            "learning_rate": self.learning_rate,
            "steps_per_report": self.grad_accumulation,
            "steps_per_eval": self.eval_every * self.grad_accumulation,
            "grad_accumulation_steps": self.grad_accumulation,
            "adapter_path": adapter_path,
            "save_every": self.save_every * self.grad_accumulation,
            "max_seq_length": self.max_seq_length,
            "grad_checkpoint": self.grad_checkpoint,
            "seed": self.seed,
            "lr_schedule": self.schedule(),
            "lora_parameters": self.lora_parameters(),
        }
        if self.optimizer == "adamw":
            config["optimizer_config"] = {"adamw": {"weight_decay": self.weight_decay}}
        return config

    def to_dict(self) -> dict:
        return asdict(self)


def make_plan(config: dict, meta: dict, overrides: dict | None = None) -> Plan:
    """The plan from a run config, the rows' meta.json and the probe's settings (batch size and so on)."""
    overrides = {k: v for k, v in (overrides or {}).items() if v is not None}
    unknown = sorted(set(overrides) - set(OVERRIDABLE))
    if unknown:
        raise PlanError(f"these settings cannot be changed from the command line: {', '.join(unknown)}")
    train = {**config.get("train", {}), **overrides}
    lora = config.get("lora", {})
    model = config.get("model", {})
    missing = [f"train.{k}" for k in LEARNING_KEYS if k not in train] + [f"lora.{k}" for k in ("rank", "scale", "dropout", "num_layers") if k not in lora]
    if missing:
        raise PlanError(f"the config does not set {', '.join(missing)}; a run's own file must")
    if "path" not in model:
        raise PlanError("the config does not set model.path")
    if train["optimizer"] not in OPTIMIZERS:
        raise PlanError(f"train.optimizer must be one of {', '.join(OPTIMIZERS)}")
    fine_tune_type = lora.get("fine_tune_type", "lora")
    if fine_tune_type not in FINE_TUNE_TYPES:
        raise PlanError(f"lora.fine_tune_type must be one of {', '.join(FINE_TUNE_TYPES)} (full fine-tuning does not fit this Mac)")
    if train.get("mask_prompt", True) is not True:
        raise PlanError("train.mask_prompt must be true: the loss is taken on the answer only")
    effective = int(train.get("effective_batch", 8))
    batch_size = int(train.get("batch_size", 1))
    if batch_size < 1 or effective % batch_size:
        raise PlanError(f"batch_size {batch_size} must divide the effective batch {effective}")
    if meta.get("batch_size") != batch_size:
        raise PlanError(
            f"the rows were built in length buckets of {meta.get('batch_size')} rows, but batch_size is {batch_size}; "
            f"build them again with --batch-size {batch_size}"
        )
    rows = int(meta["train"]["rows"])
    if rows < effective or rows % effective:
        raise PlanError(f"{rows} training rows is not a whole number of updates of {effective} rows")
    max_seq_length = int(train.get("max_seq_length", 2048))
    longest = int(meta["train"]["tokens"]["longest"])
    if longest > max_seq_length:
        raise PlanError(f"the longest row has {longest} tokens, over max_seq_length {max_seq_length}; mlx-lm would cut it")
    epochs = int(train.get("epochs", 1))
    accumulation = effective // batch_size
    iters = rows // batch_size * epochs
    steps = iters // accumulation
    if steps < 2:
        raise PlanError("a run needs at least 2 updates")
    save_every = int(train.get("save_every", 50))
    eval_every = int(train.get("eval_every", save_every))
    if save_every < 1 or eval_every < 1 or save_every % eval_every:
        raise PlanError("eval_every must divide save_every, so every checkpoint has a validation loss at its own step")
    fraction = float(train["warmup_fraction"])
    if not 0 <= fraction < 1:
        raise PlanError("train.warmup_fraction must be at least 0 and under 1")
    warmup = min(max(1, round(fraction * steps)), steps - 1) if fraction > 0 else 0
    decay_to = float(train["decay_to"])
    if not 0 <= decay_to <= 1:
        raise PlanError("train.decay_to is a fraction of the peak learning rate, from 0 to 1")
    return Plan(
        name=str(config.get("name", "run")),
        model=str(model["path"]),
        weights_sha256=model.get("weights_sha256"),
        fine_tune_type=fine_tune_type,
        num_layers=int(lora["num_layers"]),
        rank=int(lora["rank"]),
        scale=float(lora["scale"]),
        dropout=float(lora["dropout"]),
        optimizer=train["optimizer"],
        weight_decay=float(train["weight_decay"]) if train["optimizer"] == "adamw" else None,
        learning_rate=float(train["learning_rate"]),
        warmup_steps=warmup,
        warmup_init=float(train["warmup_init"]),
        decay_to=decay_to,
        effective_batch=effective,
        batch_size=batch_size,
        grad_accumulation=accumulation,
        rows=rows,
        epochs=epochs,
        iters=iters,
        steps=steps,
        max_seq_length=max_seq_length,
        mask_prompt=True,
        grad_checkpoint=bool(train.get("grad_checkpoint", False)),
        save_every=save_every,
        eval_every=eval_every,
        seed=int(train.get("seed", 0)),
        peak_memory_cap_gb=float(train.get("peak_memory_cap_gb", 0)),
    )


def lora_parameter_count(model_config: dict, num_layers: int, rank: int) -> int:
    """LoRA weights in the last num_layers blocks of a Qwen2-style model, on all 7 projections: (in + out) x rank."""
    hidden = model_config["hidden_size"]
    inter = model_config["intermediate_size"]
    kv = model_config["num_key_value_heads"] * (hidden // model_config["num_attention_heads"])
    shapes = [(hidden, hidden), (hidden, kv), (hidden, kv), (hidden, hidden), (hidden, inter), (hidden, inter), (inter, hidden)]
    return num_layers * sum((a + b) * rank for a, b in shapes)


# Rows and batches, without mlx.


def batch_order(rows: int, batch_size: int, epochs: int, seed: int) -> list[list[int]]:
    """Row numbers for every forward pass: the file in order, batch_size at a time, for the first pass; later passes
    take the same batches in a seeded order."""
    batches = [list(range(i, min(i + batch_size, rows))) for i in range(0, rows, batch_size)]
    out = list(batches)
    for epoch in range(1, epochs):
        out += sorted(batches, key=lambda b: hashlib.sha256(f"{seed}:{epoch}:{b[0]}".encode()).hexdigest())
    return out


def make_batch(seqs: list[tuple[list[int], int]], max_seq_length: int):
    """A padded batch the way mlx-lm 0.32.2's iterate_batches makes one: width one more than the next multiple of
    32, at most max_seq_length, and per row (prompt tokens, length) for the loss mask."""
    import numpy as np

    lengths = [min(len(tokens), max_seq_length) for tokens, _ in seqs]
    width = min(1 + 32 * ((max(lengths) + 31) // 32), max_seq_length)
    arr = np.zeros((len(seqs), width), np.int32)
    for j, (tokens, _) in enumerate(seqs):
        arr[j, : lengths[j]] = tokens[: lengths[j]]
    spans = np.array([[offset, length] for (_, offset), length in zip(seqs, lengths)], np.int32)
    return arr, spans


def read_jsonl(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_data(data_dir: Path) -> tuple[list[dict], list[dict], dict, dict]:
    data_dir = Path(data_dir)
    meta = json.loads((data_dir / "meta.json").read_text())
    shas = {name: sha256_file(data_dir / name) for name in ("train.jsonl", "valid.jsonl", "meta.json")}
    for name in ("train.jsonl", "valid.jsonl"):
        if meta.get("files", {}).get(name) != shas[name]:
            raise PlanError(f"{display(data_dir / name)} is not the file its meta.json describes; build the rows again")
    return read_jsonl(data_dir / "train.jsonl"), read_jsonl(data_dir / "valid.jsonl"), meta, shas


def tokenize(rows: list[dict], detail: list, tokenizer) -> list[tuple[list[int], int]]:
    """(tokens, prompt tokens) per row with mlx-lm's ChatDataset and mask_prompt, checked against the counts the
    rows were built with."""
    from mlx_lm.tuner.datasets import ChatDataset

    dataset = ChatDataset(rows, tokenizer, mask_prompt=True)
    out = []
    for k, row in enumerate(rows):
        tokens, offset = dataset.process(row)
        row_id, _, prompt, answer = detail[k]
        if (offset, len(tokens)) != (prompt, prompt + answer):
            raise PlanError(f"row {k} ({row_id}) tokenizes to {offset} + {len(tokens) - offset} tokens, not the {prompt} + {answer} it was built with")
        out.append((list(tokens), int(offset)))
    return out


def git_commit() -> str:
    try:
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "ml/train", "ml/configs"], cwd=REPO, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    return f"{head}{' (uncommitted changes in ml/train or ml/configs)' if dirty else ''}" if head else "unknown"


# The run folder


def find_checkpoints(out: Path) -> list[tuple[int, Path]]:
    if not Path(out).is_dir():
        return []
    found = [(int(m.group(1)), p) for p in Path(out).iterdir() if (m := CHECKPOINT.match(p.name)) and p.is_file()]
    return sorted(found)


def resume_step(out: Path, checkpoint: Path) -> int:
    checkpoint = Path(checkpoint)
    m = CHECKPOINT.match(checkpoint.name)
    if not m:
        raise PlanError(f"{checkpoint.name} is not a step checkpoint (0000050_adapters.safetensors)")
    if checkpoint.resolve().parent != Path(out).resolve():
        raise PlanError(f"{checkpoint} is not in --out ({out}); a run resumes only from its own checkpoints")
    if not checkpoint.is_file():
        raise PlanError(f"{checkpoint} does not exist")
    return int(m.group(1))


def check_start(out: Path, resume_from: Path | None) -> int:
    """The step to start from. A fresh start into a folder that already has checkpoints is refused, so a run is never
    mixed with another."""
    if resume_from is not None:
        return resume_step(out, resume_from)
    found = find_checkpoints(out)
    if found:
        raise PlanError(
            f"{display(Path(out))} already has checkpoints (newest {found[-1][1].name}). Resume with --resume-from, or use a new --out."
        )
    return 0


def trim_log(path: Path, upto: int) -> None:
    """Keep the log lines of steps up to `upto` (the rest are from the part a resume redoes)."""
    if not path.is_file():
        return
    kept = []
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if int(row.get("step", 0)) <= upto:
            kept.append(line)
    path.write_text("".join(k + "\n" for k in kept))


class RunFolder:
    def __init__(self, out: Path, echo=print):
        self.out = Path(out)
        self.echo = echo
        self.log_path = self.out / "train_log.jsonl"
        self.val_path = self.out / "val_loss.jsonl"
        self.run_path = self.out / "run.json"

    def log(self, row: dict) -> None:
        with self.log_path.open("a") as f:
            f.write(json.dumps(row) + "\n")
        if row.get("kind") == "val":
            with self.val_path.open("a") as f:
                f.write(json.dumps({"step": row["step"], "val_loss": row["loss"]}) + "\n")

    def read_run(self) -> dict:
        return json.loads(self.run_path.read_text()) if self.run_path.is_file() else {}

    def write_run(self, record: dict) -> None:
        tmp = self.out / "run.json.tmp"
        tmp.write_text(json.dumps(record, indent=2) + "\n")
        os.replace(tmp, self.run_path)

    def clean_temp(self) -> None:
        for p in self.out.glob("tmp-*"):
            p.unlink(missing_ok=True)

    def prune_optimizer_files(self) -> None:
        found = sorted((int(m.group(1)), p) for p in self.out.iterdir() if (m := OPTIMIZER.match(p.name)))
        for _, p in found[:-KEEP_OPTIMIZER_FILES]:
            p.unlink(missing_ok=True)


def adapter_folder(out: Path, step: int) -> Path:
    """at/<step>/ inside a run folder: adapter_config.json and that checkpoint as adapters.safetensors (a hard link),
    so the benchmark can load one checkpoint with --adapter."""
    out = Path(out)
    checkpoint = out / checkpoint_name(step)
    if not checkpoint.is_file():
        raise PlanError(f"there is no checkpoint at step {step} in {display(out)}")
    folder = out / "at" / f"{step:07d}"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(out / "adapter_config.json", folder / "adapter_config.json")
    target = folder / "adapters.safetensors"
    target.unlink(missing_ok=True)
    try:
        os.link(checkpoint, target)
    except OSError:
        shutil.copyfile(checkpoint, target)
    return folder


# Training (mlx)


def run_training(
    plan: Plan,
    data_dir: Path,
    out: Path,
    *,
    resume_from: Path | None = None,
    config_files: list | None = None,
    device: str = "gpu",
    load_model=None,
    max_steps: int | None = None,
    echo=print,
    crash_after_step: int | None = None,
) -> dict:
    """Trains (or carries on training) and returns the run record. `load_model` and `crash_after_step` are for the
    tests: a small model on the CPU, and a crash at a known step."""
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    import numpy as np
    from functools import partial
    from mlx.utils import tree_flatten, tree_map, tree_map_with_path
    from mlx_lm.tuner.trainer import default_loss, grad_checkpoint
    from mlx_lm.tuner.utils import build_schedule, linear_to_lora_layers

    if device == "cpu":
        mx.set_default_device(mx.cpu)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    folder = RunFolder(out, echo)
    folder.clean_temp()
    start = check_start(out, resume_from)
    train_rows, valid_rows, meta, shas = load_data(data_dir)
    if len(train_rows) != plan.rows:
        raise PlanError(f"train.jsonl has {len(train_rows)} rows; the plan was made for {plan.rows}")

    model_path = repo_path(plan.model)
    weights_sha = None
    if load_model is None:
        weights = model_path / "model.safetensors"
        echo(f"checking the base weights' sha256 ({display(weights)})")
        weights_sha = sha256_file(weights)
        if plan.weights_sha256 and weights_sha != plan.weights_sha256:
            raise PlanError(f"{display(weights)} has sha256 {weights_sha}, not the {plan.weights_sha256} the config names")
        from mlx_lm.utils import load

        def load_model(path):
            return load(str(path))

    import mlx_lm

    versions = {"python": sys.version.split()[0], "mlx": mx.__version__, "mlx_lm": mlx_lm.__version__, "platform": platform.platform(), "device": device}
    record = folder.read_run()
    data_record = {"dir": display(Path(data_dir)), **shas, "rows": len(train_rows), "valid_rows": len(valid_rows), "name": meta.get("name")}
    segment = {"started": datetime.now().isoformat(timespec="seconds"), "from_step": start, "git_commit": git_commit(), "versions": versions}
    if start:
        if not record:
            raise PlanError(f"{display(folder.run_path)} is missing, so there is nothing to check a resume against")
        if record.get("plan") != plan.to_dict():
            changed = sorted(k for k in plan.to_dict() if record.get("plan", {}).get(k) != plan.to_dict()[k])
            raise PlanError(f"the run began with other settings ({', '.join(changed)}); it resumes only with the same ones")
        if {k: record.get("data", {}).get(k) for k in shas} != shas:
            raise PlanError("the training files are not the ones the run began with")
        if weights_sha and record.get("model", {}).get("weights_sha256") not in (None, weights_sha):
            raise PlanError("the base weights are not the ones the run began with")
        record["segments"].append(segment)
        record["status"] = "running"
        trim_log(folder.log_path, start)
        trim_log(folder.val_path, start)
    else:
        folder.log_path.unlink(missing_ok=True)
        folder.val_path.unlink(missing_ok=True)
        record = {
            "name": plan.name,
            "status": "running",
            "plan": plan.to_dict(),
            "schedule": plan.schedule(),
            "mlx_lm_config": plan.mlx_lm_config(display(Path(data_dir)), display(out)),
            "data": data_record,
            "rows_meta": {"name": meta.get("name"), "selection": meta.get("selection"), "refused": meta.get("refused"), "sources": meta.get("sources"), "generator_commits": meta.get("generator_commits"), "builder_commit": meta.get("builder_commit")},
            "model": {"path": plan.model, "weights_sha256": weights_sha},
            "tokenizer": meta.get("tokenizer"),
            "config_files": config_files or [],
            "segments": [segment],
            "checkpoints": [],
        }
    folder.write_run(record)

    np.random.seed(plan.seed)
    mx.random.seed(plan.seed)
    echo(f"loading the model from {display(model_path)}")
    model, tokenizer = load_model(model_path)
    echo(f"tokenizing {len(train_rows)} training and {len(valid_rows)} validation rows")
    train_tok = tokenize(train_rows, meta["train"]["rows_detail"], tokenizer)
    valid_tok = tokenize(valid_rows, meta["valid"]["rows_detail"], tokenizer)

    model.freeze()
    if plan.num_layers > len(model.layers):
        raise PlanError(f"the plan trains {plan.num_layers} layers but the model has {len(model.layers)}")
    linear_to_lora_layers(model, plan.num_layers, plan.lora_parameters(), use_dora=plan.fine_tune_type == "dora")
    trainable = dict(tree_flatten(model.trainable_parameters()))
    count = sum(v.size for v in trainable.values())
    echo(f"trainable LoRA weights: {count:,} ({count * 4 / 1e6:.1f} MB a checkpoint in float32)")
    record["trainable_weights"] = count
    folder.write_run(record)

    optimizer_class = {"adam": optim.Adam, "adamw": optim.AdamW}[plan.optimizer]
    extra = {"weight_decay": plan.weight_decay} if plan.optimizer == "adamw" else {}
    optimizer = optimizer_class(learning_rate=build_schedule(plan.schedule()), **extra)
    optimizer.init(model.trainable_parameters())
    if start:
        checkpoint = out / checkpoint_name(start)
        loaded = mx.load(str(checkpoint))
        if set(loaded) != set(trainable):
            raise PlanError(f"{checkpoint.name} does not hold this plan's LoRA weights")
        model.load_weights(list(loaded.items()), strict=False)
        state_file = out / optimizer_name(start)
        if state_file.is_file():
            saved = mx.load(str(state_file))
            flat = dict(tree_flatten(optimizer.state))
            if set(saved) != set(flat):
                raise PlanError(f"{state_file.name} does not match this plan's optimizer")
            optimizer.state = tree_map_with_path(lambda path, _: saved[path], optimizer.state)
            optimizer.init(model.trainable_parameters())
            echo(f"resuming from step {start}: weights and optimizer state loaded")
        else:
            optimizer.state["step"] = mx.array(start, mx.uint64)
            echo(f"resuming from step {start}: weights loaded; no optimizer state was saved there, so it starts fresh at the same schedule step")
        folder.log({"kind": "resume", "step": start, "time": segment["started"], "optimizer_state": state_file.is_file()})
    else:
        folder.log({"kind": "start", "step": 0, "time": segment["started"]})

    if plan.grad_checkpoint:
        grad_checkpoint(model.layers[0])
    with (out / "adapter_config.json").open("w") as f:
        json.dump(plan.adapter_config(), f, indent=2)
    if device == "gpu":
        from mlx_lm.utils import maybe_set_recommended_wired_limit

        maybe_set_recommended_wired_limit()

    accumulation = plan.grad_accumulation
    loss_and_grad = nn.value_and_grad(model, default_loss)
    state = [model.state, optimizer.state, mx.random.state]

    @partial(mx.compile, inputs=state, outputs=state)
    def step_fn(batch, prev_grad, do_update):
        (loss, toks), grad = loss_and_grad(model, *batch)
        if prev_grad is not None:
            grad = tree_map(lambda x, y: x + y, grad, prev_grad)
        if do_update:
            if accumulation > 1:
                grad = tree_map(lambda x: x / accumulation, grad)
            optimizer.update(model, grad)
            grad = None
        return loss, toks, grad

    def validate(step: int) -> float:
        began = time.perf_counter()
        model.eval()
        total, tokens = 0.0, 0
        for k in range(0, len(valid_tok), plan.batch_size):
            arr, spans = make_batch(valid_tok[k : k + plan.batch_size], plan.max_seq_length)
            loss, toks = default_loss(model, mx.array(arr), mx.array(spans))
            mx.eval(loss, toks)
            total += loss.item() * toks.item()
            tokens += int(toks.item())
        model.train()
        value = total / tokens
        seconds = time.perf_counter() - began
        folder.log({"kind": "val", "step": step, "loss": value, "rows": len(valid_tok), "answer_tokens": tokens, "seconds": round(seconds, 2)})
        echo(f"step {step}: val loss {value:.4f} ({len(valid_tok)} rows, {seconds:.1f} s)")
        return value

    def save(step: int) -> None:
        weights = dict(tree_flatten(model.trainable_parameters()))
        opt_tmp = out / f"tmp-{optimizer_name(step)}"
        mx.save_safetensors(str(opt_tmp), dict(tree_flatten(optimizer.state)))
        os.replace(opt_tmp, out / optimizer_name(step))
        for name in (checkpoint_name(step), "adapters.safetensors"):
            tmp = out / f"tmp-{name}"
            mx.save_safetensors(str(tmp), weights)
            os.replace(tmp, out / name)
        folder.prune_optimizer_files()
        size = (out / checkpoint_name(step)).stat().st_size
        folder.log({"kind": "save", "step": step, "file": checkpoint_name(step), "bytes": size})
        record["checkpoints"] = sorted({*record.get("checkpoints", []), step})
        folder.write_run(record)
        echo(f"saved {checkpoint_name(step)} ({size / 1e6:.1f} MB)")

    order = batch_order(plan.rows, plan.batch_size, plan.epochs, plan.seed)
    assert len(order) == plan.iters
    stop_at = min(plan.steps, max_steps) if max_steps else plan.steps
    eval_steps = set(plan.eval_steps())
    model.train()
    if start == 0:
        validate(0)
    grad = None
    loss_sum, answer_tokens, all_tokens, padded_tokens = 0.0, 0, 0, 0
    began = segment_began = time.perf_counter()
    status = "finished"
    try:
        for it in range(start * accumulation, stop_at * accumulation):
            seqs = [train_tok[i] for i in order[it]]
            arr, spans = make_batch(seqs, plan.max_seq_length)
            do_update = (it + 1) % accumulation == 0
            mx.random.seed(plan.seed * 1_000_003 + it)
            loss, toks, grad = step_fn((mx.array(arr), mx.array(spans)), grad, do_update)
            mx.eval(state, loss, toks, grad)
            loss_sum += loss.item() * toks.item()
            answer_tokens += int(toks.item())
            all_tokens += int(spans[:, 1].sum())
            padded_tokens += int(arr.size)
            if not do_update:
                continue
            step = (it + 1) // accumulation
            seconds = time.perf_counter() - began
            peak = mx.get_peak_memory() / 1e9
            value = loss_sum / max(answer_tokens, 1)
            folder.log(
                {
                    "kind": "train",
                    "step": step,
                    "rows_seen": step * plan.effective_batch,
                    "loss": value,
                    "lr": float(optimizer.learning_rate.item()),
                    "answer_tokens": answer_tokens,
                    "tokens": all_tokens,
                    "padded_tokens": padded_tokens,
                    "seconds": round(seconds, 3),
                    "elapsed_s": round(time.perf_counter() - segment_began, 1),
                    "tokens_per_second": round(all_tokens / seconds, 1) if seconds else None,
                    "peak_memory_gb": round(peak, 3),
                }
            )
            echo(f"step {step}/{plan.steps}  loss {value:.4f}  lr {optimizer.learning_rate.item():.2e}  {all_tokens / seconds:,.0f} tokens/s  peak {peak:.2f} GB")
            if not math.isfinite(value):
                raise FloatingPointError(f"the training loss is {value} at step {step}")
            if plan.peak_memory_cap_gb and peak > plan.peak_memory_cap_gb:
                raise MemoryCap(f"peak memory {peak:.2f} GB passed the cap of {plan.peak_memory_cap_gb:g} GB at step {step}")
            if step in eval_steps:
                validate(step)
            if step % plan.save_every == 0 or step == plan.steps:
                save(step)
            if crash_after_step is not None and step == crash_after_step:
                raise RuntimeError(f"test crash after step {step}")
            loss_sum, answer_tokens, all_tokens, padded_tokens = 0.0, 0, 0, 0
            began = time.perf_counter()
        if stop_at < plan.steps:
            status = f"stopped after --max-steps {stop_at}"
    except MemoryCap as err:
        record.update(status="stopped: memory cap", error=str(err))
        folder.write_run(record)
        raise
    except BaseException as err:
        record.update(status="crashed", error=f"{type(err).__name__}: {err}")
        folder.write_run(record)
        raise
    record.update(status=status, finished=datetime.now().isoformat(timespec="seconds"), last_step=stop_at)
    record.pop("error", None)
    folder.write_run(record)
    echo(f"{status} at step {stop_at}")
    return record


# Command line


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="train", description="LoRA training with mlx-lm, every checkpoint kept, resumable.")
    p.add_argument("--config", type=Path, help="a run config in ml/configs")
    p.add_argument("--data", type=Path, help="the folder build_rows.py wrote (train.jsonl, valid.jsonl, meta.json)")
    p.add_argument("--out", required=True, type=Path, help="the run folder for checkpoints and logs (adapters/<run>)")
    p.add_argument("--batch-size", type=int, help="rows per forward pass (the probe sets it; the rows must be built for it)")
    p.add_argument("--grad-checkpoint", action=argparse.BooleanOptionalAction, default=None, help="gradient checkpointing")
    p.add_argument("--save-every", type=int, help="steps between checkpoints")
    p.add_argument("--eval-every", type=int, help="steps between validation losses")
    p.add_argument("--epochs", type=int, help="passes over the rows")
    p.add_argument("--peak-memory-cap-gb", type=float, help=f"stop (exit {EXIT_MEMORY}) when peak memory passes this")
    p.add_argument("--max-steps", type=int, help="stop after this many steps (for the probe; the schedule stays the full run's)")
    p.add_argument("--resume-from", type=Path, help="a checkpoint in --out to carry on from (night-run fills it in)")
    p.add_argument("--device", choices=("gpu", "cpu"), default="gpu", help=argparse.SUPPRESS)
    p.add_argument("--dry-run", action="store_true", help="print the plan and stop, without loading the model")
    p.add_argument("--print-mlx-config", action="store_true", help="print the same run as a stock mlx_lm.lora config (JSON) and stop")
    p.add_argument("--adapter-folder", type=int, metavar="STEP", help="make at/<STEP>/ in --out, a folder that loads that checkpoint")
    return p.parse_args(argv)


def describe(plan: Plan, model_dir: Path) -> str:
    lines = [
        f"run {plan.name}: {plan.rows} rows x {plan.epochs} pass = {plan.steps} steps of {plan.effective_batch} rows "
        f"(batch {plan.batch_size} x accumulation {plan.grad_accumulation}, {plan.iters} forward passes)",
        f"LoRA {plan.fine_tune_type} rank {plan.rank}, scale {plan.scale:g}, dropout {plan.dropout:g}, last {plan.num_layers} layers; "
        f"{plan.optimizer} at {plan.learning_rate:g}, warmup {plan.warmup_steps} steps from {plan.warmup_init:g}, cosine to {plan.learning_rate * plan.decay_to:g}",
        f"learning rate at steps 1, {plan.warmup_steps + 1}, {plan.steps // 2}, {plan.steps}: "
        + ", ".join(f"{plan.lr_at(s):.3g}" for s in (1, plan.warmup_steps + 1, plan.steps // 2, plan.steps)),
        f"validation at {len(plan.eval_steps())} steps, checkpoints at {len(plan.checkpoint_steps())} steps "
        f"(every {plan.save_every}); gradient checkpointing {'on' if plan.grad_checkpoint else 'off'}; max {plan.max_seq_length} tokens a row",
    ]
    config_json = model_dir / "config.json"
    if config_json.is_file():
        n = lora_parameter_count(json.loads(config_json.read_text()), plan.num_layers, plan.rank)
        mb = n * 4 / 1e6
        lines.append(
            f"each checkpoint: {n:,} float32 LoRA weights, about {mb:.1f} MB; all {len(plan.checkpoint_steps())} kept: about "
            f"{mb * len(plan.checkpoint_steps()) / 1e3:.2f} GB, plus {KEEP_OPTIMIZER_FILES} optimizer files of about {2 * mb:.0f} MB"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    out = repo_path(args.out)
    try:
        if args.adapter_folder is not None:
            print(display(adapter_folder(out, args.adapter_folder)))
            return 0
        if not args.config or not args.data:
            raise PlanError("give --config and --data")
        resume = repo_path(args.resume_from) if args.resume_from else None
        check_start(out, resume)
        config = load_config(args.config)
        data_dir = repo_path(args.data)
        meta = json.loads((data_dir / "meta.json").read_text())
        overrides = {
            "batch_size": args.batch_size,
            "grad_checkpoint": args.grad_checkpoint,
            "save_every": args.save_every,
            "eval_every": args.eval_every,
            "epochs": args.epochs,
            "peak_memory_cap_gb": args.peak_memory_cap_gb,
        }
        plan = make_plan(config, meta, overrides)
        if args.print_mlx_config:
            print(json.dumps(plan.mlx_lm_config(display(data_dir), display(out)), indent=2))
            return 0
        print(describe(plan, repo_path(plan.model)), flush=True)
        if args.dry_run:
            return 0
        run_training(plan, data_dir, out, resume_from=resume, config_files=config.get("files"), device=args.device, max_steps=args.max_steps, echo=lambda s: print(s, flush=True))
    except PlanError as err:
        sys.stderr.write(f"train: {err}\n")
        return 2
    except MemoryCap as err:
        sys.stderr.write(f"train: {err}\n")
        return EXIT_MEMORY
    return 0


if __name__ == "__main__":
    sys.exit(main())
