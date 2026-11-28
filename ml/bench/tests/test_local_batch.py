"""The local engine's batched path against its one-at-a-time path, on a tiny random Qwen2 model (not the real
weights) with the model's real tokenizer, on the CPU only. It checks the plumbing: the same prompt tokens, stop tokens,
token limit, text and counts. It says nothing about the real model on the GPU, where other kernels and bf16 rounding
can make the two paths part (ml/README.md, "Learning curve")."""

import json
import subprocess
import sys

import pytest

from gkod_bench.engines.base import Answer
from gkod_bench.paths import LOCAL_MODEL

SCRIPT = r"""
import json, sys
from pathlib import Path
import mlx.core as mx
mx.set_default_device(mx.cpu)
import importlib
G = importlib.import_module("mlx_lm.generate")  # the module (mlx_lm.generate the name is also a function)
# the generation stream is made on the default device when mlx-lm is imported: it must be the CPU here
assert "cpu" in str(G.generation_stream).lower(), str(G.generation_stream)
from mlx_lm import stream_generate
from mlx_lm.models import qwen2
from mlx_lm.sample_utils import make_sampler
from mlx_lm.utils import load_tokenizer
from mlx.utils import tree_map
from gkod_bench.engines.local import LocalEngine
from gkod_bench.prompts import Messages

mx.random.seed(0)
args = qwen2.ModelArgs(model_type="qwen2", hidden_size=64, num_hidden_layers=2, intermediate_size=128, num_attention_heads=4,
                       rms_norm_eps=1e-6, vocab_size=151936, num_key_value_heads=2)
model = qwen2.Model(args)
# weights 4 times their random start, so the answers are varied tokens rather than one token over and over
model.update(tree_map(lambda x: x * 4.0, model.parameters()))
mx.eval(model.parameters())
model.eval()
tok = load_tokenizer(Path(sys.argv[1]))
engine = LocalEngine.__new__(LocalEngine)
engine.model, engine.tokenizer, engine.max_tokens, engine.temperature, engine.seed = model, tok, 14, 0.0, 0
engine.sampler, engine._mx, engine._queue, engine._ready = make_sampler(temp=0.0), mx, [], {}
msgs = [Messages(system="SYSTEM", turns=[{"role": "user", "content": f"Make this part: a plate {w} mm wide"}]) for w in (40, 55, 70, 85)]
# a token the second answer writes early is made a stop token, so some answers stop before the limit
tokens = [r.token for r in stream_generate(model, tok, engine.prompt_text(msgs[1]), max_tokens=14, sampler=engine.sampler)]
tok.eos_token_ids = set(tok.eos_token_ids) | {tokens[6]}
engine.batch_size = 1
one = [engine._answer_one(m) for m in msgs]
engine.batch_size = 3
engine.prepare(msgs)
batched = [engine.answer(m) for m in msgs]
keys = ("generation_tokens", "finish_reason", "prompt_tokens")
print(json.dumps({
    "one": [{"text": a.text, **{k: a.meta[k] for k in keys}} for a in one],
    "batched": [{"text": a.text, **{k: a.meta[k] for k in keys}, "batch": a.meta["batch"]["size"]} for a in batched],
}))
"""


@pytest.mark.skipif(not (LOCAL_MODEL / "tokenizer.json").exists(), reason="the model's tokenizer is only on the Mac")
def test_batched_answers_match_one_at_a_time_on_a_tiny_cpu_model(tmp_path):
    pytest.importorskip("mlx_lm")
    script = tmp_path / "batch_check.py"
    script.write_text(SCRIPT)
    done = subprocess.run([sys.executable, str(script), str(LOCAL_MODEL)], capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    out = json.loads(done.stdout.strip().splitlines()[-1])
    one, batched = out["one"], out["batched"]
    assert [b["batch"] for b in batched] == [3, 3, 3, 1]
    for a, b in zip(one, batched):
        assert {k: a[k] for k in a} == {k: b[k] for k in a}
    assert {a["finish_reason"] for a in one} == {"stop", "length"}
    assert one[1]["finish_reason"] == "stop" and one[1]["generation_tokens"] == 7 and one[1]["text"]
    assert len({a["text"] for a in one}) == 4
    # the stop token is counted, as stream_generate counts it; the limit is exact
    assert all(a["generation_tokens"] == 14 for a in one if a["finish_reason"] == "length")


def test_batched_answers_need_greedy_decoding(tmp_path):
    from gkod_bench.engines.local import LocalEngine

    with pytest.raises(ValueError, match="greedy"):
        LocalEngine(tmp_path, batch_size=4, temperature=0.7)
    with pytest.raises(ValueError, match="1"):
        LocalEngine(tmp_path, batch_size=0)


def test_a_batched_engine_answers_the_queued_prompts_in_chunks(tmp_path):
    from gkod_bench.engines.local import LocalEngine
    from gkod_bench.prompts import Messages

    engine = LocalEngine.__new__(LocalEngine)
    engine.batch_size, engine._queue, engine._ready = 2, [], {}
    chunks = []

    def fake_batch(chunk):
        chunks.append([m.user for m in chunk])
        return [Answer(text=f"answer to {m.user}", seconds=1.0) for m in chunk]

    engine._answer_batch = fake_batch
    msgs = [Messages(system="S", turns=[{"role": "user", "content": f"q{k}"}]) for k in range(5)]
    engine.prepare(msgs)
    assert [engine.answer(m).text for m in msgs] == [f"answer to q{k}" for k in range(5)]
    assert chunks == [["q0", "q1"], ["q2", "q3"], ["q4"]]
    # a prompt that was not queued is answered as a batch of one
    extra = Messages(system="S", turns=[{"role": "user", "content": "lone"}])
    assert engine.answer(extra).text == "answer to lone" and chunks[-1] == ["lone"]
