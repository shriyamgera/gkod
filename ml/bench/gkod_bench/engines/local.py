"""The local model through mlx-lm: loaded once, the chat template of the model, greedy decoding by default (or a
fixed temperature and seed), and a token limit. No retries: one answer per prompt.

By default each prompt is answered alone with mlx-lm's stream_generate, the path every scored row uses. With
batch_size above 1 (greedy only) the engine answers the next batch_size prompts at once with mlx-lm's batch_generate:
much faster, but the answers can differ from the one-at-a-time answers (see ml/README.md, "Learning curve"), so the
batch size is saved in the row's settings and a batched row is never mixed with a plain one."""

from __future__ import annotations

import gc
import hashlib
import platform
import subprocess
import sys
import time
from pathlib import Path

from gkod_bench.engines.base import Answer
from gkod_bench.paths import LOCAL_MODEL, REPO
from gkod_bench.prompts import Messages

MAX_TOKENS = 1024


def _fix_mac_version() -> None:
    """Python's platform.mac_ver() reads a plist with the XML parser; with Homebrew's Python linked against an older
    system libexpat that parser fails to load, mac_ver() returns '', and the Hugging Face client (imported by mlx-lm)
    crashes on it. Ask sw_vers instead when that happens."""
    if sys.platform != "darwin" or platform.mac_ver()[0]:
        return
    try:
        version = subprocess.run(["sw_vers", "-productVersion"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return
    if version:
        machine = platform.machine()
        platform.mac_ver = lambda release="", versioninfo=("", "", ""), machine_=machine: (version, ("", "", ""), machine_)


def _shown(path: Path) -> str:
    """A path as rows save it: from the repo root when it is inside the repo, so a row resumes from any folder."""
    full = path.resolve()
    return str(full.relative_to(REPO)) if full.is_relative_to(REPO) else str(full)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


class LocalEngine:
    kind = "local"
    with_tools = False

    def __init__(self, model: Path = LOCAL_MODEL, adapter: Path | None = None, max_tokens: int = MAX_TOKENS, temperature: float = 0.0, seed: int = 0, batch_size: int = 1):
        if batch_size < 1:
            raise ValueError("The batch size is 1 (one prompt at a time) or more.")
        if batch_size > 1 and temperature:
            raise ValueError("Batched answers are for greedy decoding only: with a temperature the random draws depend on the batch.")
        model = Path(model)
        weights = model / "model.safetensors"
        if not weights.exists():
            raise FileNotFoundError(f"No model weights in {model}. Fetch the model first (ml/scripts/fetch-model.py).")
        _fix_mac_version()
        import mlx.core as mx
        from mlx_lm import load
        from mlx_lm.sample_utils import make_sampler

        self.model_path = model
        self.adapter = Path(adapter) if adapter else None
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.seed = seed
        self.batch_size = batch_size
        # batched answers: the prompts still to come (from prepare) and the answers made ahead of their turn
        self._queue: list[Messages] = []
        self._ready: dict[int, Answer] = {}
        self._mx = mx
        self.model, self.tokenizer = load(str(model), adapter_path=str(self.adapter) if self.adapter else None)
        self.sampler = make_sampler(temp=temperature)
        import mlx_lm

        self._settings = {
            "engine": "local",
            "model": model.name,
            "weights_sha256": _sha256(weights),
            "adapter": _shown(self.adapter) if self.adapter else None,
            "adapter_sha256": _sha256(self.adapter / "adapters.safetensors") if self.adapter and (self.adapter / "adapters.safetensors").exists() else None,
            "decoding": "greedy" if temperature == 0 else f"temperature {temperature}, seed {seed}",
            "temperature": temperature,
            "seed": seed,
            "max_tokens": max_tokens,
            "chat_template": "the model's own (tokenizer.apply_chat_template)",
            "mlx_lm": mlx_lm.__version__,
            "mlx": mx.__version__,
        }
        if batch_size > 1:
            # only when batched, so plain rows keep the settings they always had
            self._settings["batch_size"] = batch_size
            self._settings["generation"] = f"mlx-lm batch_generate, up to {batch_size} prompts at once"

    def settings(self) -> dict:
        return dict(self._settings)

    def prompt_text(self, messages: Messages) -> str:
        chat = [{"role": "system", "content": messages.system}, *messages.turns]
        return self.tokenizer.apply_chat_template(chat, add_generation_prompt=True, tokenize=False)

    def prepare(self, upcoming: list[Messages]) -> None:
        """The prompts the runner will ask next, in order. Only a batched engine uses them."""
        if self.batch_size > 1:
            self._queue = list(upcoming)
            self._ready = {}

    def answer(self, messages: Messages) -> Answer:
        if self.batch_size == 1:
            return self._answer_one(messages)
        key = id(messages)
        if key not in self._ready:
            # this prompt and the ones queued right after it, up to the batch size
            at = next((k for k, m in enumerate(self._queue) if m is messages), None)
            chunk = [messages] if at is None else self._queue[at : at + self.batch_size]
            if at is not None:
                del self._queue[at : at + len(chunk)]
            for m, a in zip(chunk, self._answer_batch(chunk)):
                self._ready[id(m)] = a
        return self._ready.pop(key)

    def _tokens(self, prompt: str) -> list[int]:
        """The prompt's tokens, by the rule stream_generate uses for a text prompt."""
        tok = self.tokenizer
        add_special_tokens = tok.bos_token is None or not prompt.startswith(tok.bos_token)
        return tok.encode(prompt, add_special_tokens=add_special_tokens)

    def _answer_batch(self, chunk: list[Messages]) -> list[Answer]:
        """Greedy answers for several prompts at once. Token for token the same rules as stream_generate: the same
        prompt tokens, sampler, stop tokens and limit, and the text put together by the same streaming detokenizer."""
        from mlx_lm import batch_generate

        prompts = [self._tokens(self.prompt_text(m)) for m in chunk]
        started = time.perf_counter()
        out = batch_generate(
            self.model,
            self.tokenizer,
            prompts,
            max_tokens=self.max_tokens,
            return_token_ids=True,
            sampler=self.sampler,
            completion_batch_size=len(chunk),
            prefill_batch_size=len(chunk),
        )
        seconds = time.perf_counter() - started
        stats = out.stats
        answers = []
        for prompt, ids in zip(prompts, out.token_ids):
            detok = self.tokenizer.detokenizer
            parts = []
            for t in ids:
                detok.add_token(t)
                parts.append(detok.last_segment)
            detok.finalize()
            parts.append(detok.last_segment)
            # batch_generate leaves the stop token out; stream_generate counts it in generation_tokens
            finish = "length" if len(ids) >= self.max_tokens else "stop"
            meta = {
                "prompt_tokens": len(prompt),
                "generation_tokens": len(ids) + (1 if finish == "stop" else 0),
                "prompt_tps": round(getattr(stats, "prompt_tps", 0.0), 1),
                "generation_tps": round(getattr(stats, "generation_tps", 0.0), 1),
                "peak_memory_gb": round(getattr(stats, "peak_memory", self._mx.get_peak_memory() / 1e9), 3),
                "finish_reason": finish,
                "batch": {"size": len(chunk), "seconds": round(seconds, 3)},
            }
            # each answer gets an equal share of the batch's time
            answers.append(Answer(text="".join(parts), seconds=seconds / len(chunk), meta=meta))
        return answers

    def _answer_one(self, messages: Messages) -> Answer:
        from mlx_lm import stream_generate

        if self.temperature:
            self._mx.random.seed(self.seed)
        prompt = self.prompt_text(messages)
        started = time.perf_counter()
        parts, last = [], None
        for response in stream_generate(self.model, self.tokenizer, prompt, max_tokens=self.max_tokens, sampler=self.sampler):
            parts.append(response.text)
            last = response
        seconds = time.perf_counter() - started
        meta = {}
        if last is not None:
            meta = {
                "prompt_tokens": last.prompt_tokens,
                "generation_tokens": last.generation_tokens,
                "prompt_tps": round(last.prompt_tps, 1),
                "generation_tps": round(last.generation_tps, 1),
                "peak_memory_gb": round(last.peak_memory, 3),
                "finish_reason": last.finish_reason,
            }
        return Answer(text="".join(parts), seconds=seconds, meta=meta)

    def close(self) -> None:
        """Lets go of the model, so the next engine (another checkpoint) does not hold two copies on the GPU."""
        self.model = None
        self._queue, self._ready = [], {}
        gc.collect()
        self._mx.clear_cache()
