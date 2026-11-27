"""The local model through mlx-lm: loaded once, the chat template of the model, greedy decoding by default (or a
fixed temperature and seed), and a token limit. No retries: one answer per prompt."""

from __future__ import annotations

import hashlib
import platform
import subprocess
import sys
import time
from pathlib import Path

from gkod_bench.engines.base import Answer
from gkod_bench.paths import LOCAL_MODEL
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


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


class LocalEngine:
    kind = "local"
    with_tools = False

    def __init__(self, model: Path = LOCAL_MODEL, adapter: Path | None = None, max_tokens: int = MAX_TOKENS, temperature: float = 0.0, seed: int = 0):
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
        self._mx = mx
        self.model, self.tokenizer = load(str(model), adapter_path=str(self.adapter) if self.adapter else None)
        self.sampler = make_sampler(temp=temperature)
        import mlx_lm

        self._settings = {
            "engine": "local",
            "model": model.name,
            "weights_sha256": _sha256(weights),
            "adapter": str(self.adapter) if self.adapter else None,
            "adapter_sha256": _sha256(self.adapter / "adapters.safetensors") if self.adapter and (self.adapter / "adapters.safetensors").exists() else None,
            "decoding": "greedy" if temperature == 0 else f"temperature {temperature}, seed {seed}",
            "temperature": temperature,
            "seed": seed,
            "max_tokens": max_tokens,
            "chat_template": "the model's own (tokenizer.apply_chat_template)",
            "mlx_lm": mlx_lm.__version__,
            "mlx": mx.__version__,
        }

    def settings(self) -> dict:
        return dict(self._settings)

    def prompt_text(self, messages: Messages) -> str:
        chat = [{"role": "system", "content": messages.system}, *messages.turns]
        return self.tokenizer.apply_chat_template(chat, add_generation_prompt=True, tokenize=False)

    def answer(self, messages: Messages) -> Answer:
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
        pass
