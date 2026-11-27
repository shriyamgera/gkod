import os

import pytest
from messages import ZERO

from gkod_bench.paths import LOCAL_MODEL


# ---- the local model (slow: loads the weights; only with GKOD_BENCH_LOCAL=1) ----


@pytest.mark.skipif(os.environ.get("GKOD_BENCH_LOCAL") != "1" or not (LOCAL_MODEL / "model.safetensors").exists(), reason="set GKOD_BENCH_LOCAL=1 with the model on disk")
def test_local_model_answers_greedily_and_the_same_twice():
    from gkod_bench.engines.local import LocalEngine

    engine = LocalEngine(max_tokens=24)
    a, b = engine.answer(ZERO), engine.answer(ZERO)
    assert a.text and a.text == b.text
    assert a.meta["generation_tokens"] <= 24 and engine.settings()["decoding"] == "greedy"
    assert "<|im_start|>system\nSYSTEM" in engine.prompt_text(ZERO)
