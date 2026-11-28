"""The trainer: its plan and arguments (no mlx needed), and a tiny random model trained on the CPU, crashed and
resumed (only where mlx is installed; it never loads the real model or uses the GPU)."""

import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_fakes as tf  # noqa: E402

from train import train as tr  # noqa: E402
from train.config import CONFIGS, REPO, load_config  # noqa: E402

QWEN_15B = {"hidden_size": 1536, "intermediate_size": 8960, "num_attention_heads": 12, "num_key_value_heads": 2}


def meta(rows=5696, batch_size=1, longest=2003) -> dict:
    return {"batch_size": batch_size, "train": {"rows": rows, "tokens": {"longest": longest}}}


def run1(**overrides) -> tr.Plan:
    return tr.make_plan(load_config(CONFIGS / "run1-insurance.toml"), meta(batch_size=overrides.get("batch_size", 1)), overrides)


# The plan


def test_run1_plan_counts_updates_and_accumulation():
    plan = run1()
    assert (plan.rows, plan.effective_batch, plan.batch_size, plan.grad_accumulation) == (5696, 8, 1, 8)
    assert (plan.iters, plan.steps) == (5696, 712)
    assert plan.warmup_steps == round(0.05 * 712) == 36
    assert plan.mask_prompt is True and plan.grad_checkpoint is True and plan.max_seq_length == 2048
    assert (plan.rank, plan.scale, plan.dropout, plan.num_layers, plan.fine_tune_type) == (16, 20.0, 0.05, 16, "lora")
    four = run1(batch_size=4)
    assert (four.iters, four.steps, four.grad_accumulation) == (1424, 712, 2)
    assert run1(batch_size=8).grad_accumulation == 1


def test_every_checkpoint_has_a_validation_loss_at_its_own_step():
    plan = run1()
    assert plan.checkpoint_steps() == [*range(50, 701, 50), 712]
    assert set(plan.checkpoint_steps()) <= set(plan.eval_steps())
    assert plan.eval_steps()[0] == 0
    # run 1 as the probe sized it: 5,600 rows, 700 steps, 14 checkpoints and 15 validations
    sized = tr.make_plan(load_config(CONFIGS / "run1-insurance.toml"), meta(rows=5600), {})
    assert (sized.steps, sized.warmup_steps) == (700, 35)
    assert sized.checkpoint_steps() == list(range(50, 701, 50)) and len(sized.eval_steps()) == 15
    with pytest.raises(tr.PlanError, match="eval_every must divide save_every"):
        run1(save_every=50, eval_every=20)


def test_the_learning_rate_warms_up_then_decays_to_a_tenth():
    plan = run1()
    assert plan.lr_at(1) == pytest.approx(1e-6)
    assert plan.lr_at(plan.warmup_steps + 1) == pytest.approx(2e-5)
    assert plan.lr_at(plan.steps) == pytest.approx(2e-6)
    rates = [plan.lr_at(s) for s in range(plan.warmup_steps + 1, plan.steps + 1)]
    assert all(a >= b for a, b in zip(rates, rates[1:]))
    assert plan.schedule() == {"name": "cosine_decay", "arguments": [2e-5, 712 - 36 - 2, 2e-6], "warmup": 36, "warmup_init": 1e-6}


def test_plans_that_cannot_run_as_meant_are_refused():
    config = load_config(CONFIGS / "run1-insurance.toml")
    with pytest.raises(tr.PlanError, match="build them again with --batch-size 2"):
        tr.make_plan(config, meta(batch_size=1), {"batch_size": 2})
    with pytest.raises(tr.PlanError, match="must divide the effective batch"):
        tr.make_plan(config, meta(batch_size=3), {"batch_size": 3})
    with pytest.raises(tr.PlanError, match="not a whole number of updates"):
        tr.make_plan(config, meta(rows=5697), {})
    with pytest.raises(tr.PlanError, match="over max_seq_length"):
        tr.make_plan(config, meta(longest=2049), {})
    with pytest.raises(tr.PlanError, match="cannot be changed from the command line: learning_rate"):
        tr.make_plan(config, meta(), {"learning_rate": 1e-3})
    no_mask = load_config(CONFIGS / "run1-insurance.toml")
    no_mask["train"]["mask_prompt"] = False
    with pytest.raises(tr.PlanError, match="answer only"):
        tr.make_plan(no_mask, meta(), {})
    with pytest.raises(tr.PlanError, match="does not set train.optimizer"):
        tr.make_plan(load_config(CONFIGS / "base.toml"), meta(), {})


def test_the_stock_mlx_lm_config_is_the_same_run_counted_in_forward_passes():
    plan = run1(batch_size=2)
    config = plan.mlx_lm_config("data/rows", "adapters/run1")
    assert config["iters"] == 2848 and config["grad_accumulation_steps"] == 4
    assert config["save_every"] == config["steps_per_eval"] == 200
    assert config["val_batches"] == -1 and config["mask_prompt"] is True
    assert config["lr_schedule"] == plan.schedule() and config["lora_parameters"] == {"rank": 16, "scale": 20.0, "dropout": 0.05}


def test_every_option_exists_in_the_installed_mlx_lm():
    pytest.importorskip("mlx_lm")
    import mlx.optimizers as optim
    from mlx_lm.lora import CONFIG_DEFAULTS
    from mlx_lm.tuner.trainer import TrainingArgs
    from mlx_lm.tuner.utils import build_schedule

    plan = run1(batch_size=2)
    config = plan.mlx_lm_config("data/rows", "adapters/run1")
    assert set(config) <= set(CONFIG_DEFAULTS)
    assert set(config["lora_parameters"]) <= set(CONFIG_DEFAULTS["lora_parameters"])
    assert config["optimizer"] in CONFIG_DEFAULTS["optimizer_config"]
    for field in ("batch_size", "iters", "val_batches", "steps_per_eval", "steps_per_save", "max_seq_length", "grad_checkpoint", "grad_accumulation_steps"):
        assert field in TrainingArgs.__dataclass_fields__
    # our worked-out rates are the ones mlx's schedule gives
    schedule = build_schedule(plan.schedule())
    optimizer = optim.Adam(learning_rate=schedule)
    for update in (1, 2, plan.warmup_steps, plan.warmup_steps + 1, plan.warmup_steps + 2, 300, plan.steps - 1, plan.steps):
        assert schedule(update - 1).item() == pytest.approx(plan.lr_at(update), rel=1e-5), update
    assert optimizer.learning_rate.item() == pytest.approx(plan.lr_at(1))


def test_the_lora_size_of_the_real_model():
    # 16 blocks x 7 projections, (in + out) x rank 16, float32: about 42 MB a checkpoint
    assert tr.lora_parameter_count(QWEN_15B, 16, 16) == 10_551_296
    model_config = REPO / "ml" / "models" / "qwen2.5-coder-1.5b-instruct" / "config.json"
    if model_config.is_file():
        assert tr.lora_parameter_count(json.loads(model_config.read_text()), 16, 16) == 10_551_296


# Rows and batches


def test_the_first_pass_reads_the_file_in_order_and_later_passes_shuffle_whole_batches():
    order = tr.batch_order(8, 2, 2, seed=0)
    assert order[:4] == [[0, 1], [2, 3], [4, 5], [6, 7]]
    assert sorted(order[4:]) == order[:4] and order[4:] != order[:4]
    assert order == tr.batch_order(8, 2, 2, seed=0)
    assert tr.batch_order(5, 2, 1, seed=0) == [[0, 1], [2, 3], [4]]


def test_batches_are_padded_like_mlx_lm():
    arr, spans = tr.make_batch([([5] * 40, 10), ([7] * 3, 1)], 2048)
    assert arr.shape == (2, 65)
    assert list(arr[0, :40]) == [5] * 40 and arr[0, 40:].sum() == 0
    assert spans.tolist() == [[10, 40], [1, 3]]
    arr, spans = tr.make_batch([([1] * 2050, 100)], 2048)
    assert arr.shape == (1, 2048) and spans.tolist() == [[100, 2048]]


# The run folder


def test_a_fresh_start_never_mixes_with_an_earlier_run(tmp_path):
    assert tr.check_start(tmp_path, None) == 0
    (tmp_path / "0000050_adapters.safetensors").write_bytes(b"x")
    with pytest.raises(tr.PlanError, match="already has checkpoints"):
        tr.check_start(tmp_path, None)
    assert tr.check_start(tmp_path, tmp_path / "0000050_adapters.safetensors") == 50
    other = tmp_path / "other"
    other.mkdir()
    (other / "0000050_adapters.safetensors").write_bytes(b"x")
    with pytest.raises(tr.PlanError, match="resumes only from its own checkpoints"):
        tr.check_start(tmp_path, other / "0000050_adapters.safetensors")
    with pytest.raises(tr.PlanError, match="not a step checkpoint"):
        tr.check_start(tmp_path, tmp_path / "adapters.safetensors")


def test_a_resume_drops_the_log_lines_it_will_redo(tmp_path):
    log = tmp_path / "train_log.jsonl"
    log.write_text("".join(json.dumps({"kind": "train", "step": s}) + "\n" for s in range(1, 7)) + "broken\n")
    tr.trim_log(log, 4)
    assert [json.loads(line)["step"] for line in log.read_text().splitlines()] == [1, 2, 3, 4]


def test_one_checkpoint_becomes_a_folder_the_benchmark_can_load(tmp_path):
    (tmp_path / "0000050_adapters.safetensors").write_bytes(b"weights at 50")
    (tmp_path / "adapter_config.json").write_text('{"num_layers": 16}')
    folder = tr.adapter_folder(tmp_path, 50)
    assert folder == tmp_path / "at" / "0000050"
    assert (folder / "adapters.safetensors").read_bytes() == b"weights at 50"
    assert json.loads((folder / "adapter_config.json").read_text()) == {"num_layers": 16}
    with pytest.raises(tr.PlanError, match="no checkpoint at step 100"):
        tr.adapter_folder(tmp_path, 100)


def test_the_command_line_prints_the_plan_and_refuses_to_overwrite(tmp_path, capsys):
    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97), train_rows=16, batch_size=2)
    config = tmp_path / "tiny.toml"
    config.write_text(
        '[model]\npath = "tiny"\n[lora]\nnum_layers = 2\nrank = 4\nscale = 2.0\ndropout = 0.0\n'
        '[train]\noptimizer = "adam"\nlearning_rate = 1e-3\nwarmup_fraction = 0.25\nwarmup_init = 0.0\ndecay_to = 0.1\n'
        "effective_batch = 4\nbatch_size = 2\nmax_seq_length = 256\nsave_every = 2\neval_every = 1\n"
    )
    out = tmp_path / "run"
    args = ["--config", str(config), "--data", str(data), "--out", str(out)]
    assert tr.main([*args, "--dry-run"]) == 0
    assert "16 rows x 1 pass = 4 steps of 4 rows (batch 2 x accumulation 2, 8 forward passes)" in capsys.readouterr().out
    assert tr.main([*args, "--print-mlx-config"]) == 0
    assert json.loads(capsys.readouterr().out)["iters"] == 8
    out.mkdir()
    (out / "0000002_adapters.safetensors").write_bytes(b"x")
    assert tr.main([*args, "--dry-run"]) == 2
    assert "already has checkpoints" in capsys.readouterr().err
    assert tr.main([*args, "--batch-size", "4", "--resume-from", str(out / "0000002_adapters.safetensors"), "--dry-run"]) == 2
    assert "build them again with --batch-size 4" in capsys.readouterr().err


# Training a tiny model on the CPU


@pytest.fixture(scope="module")
def mlx_cpu():
    mx = pytest.importorskip("mlx.core")
    pytest.importorskip("mlx_lm")
    mx.set_default_device(mx.cpu)
    return mx


def tiny_plan(data: Path, **overrides) -> tr.Plan:
    return tr.make_plan(tf.train_config(), json.loads((data / "meta.json").read_text()), overrides)


def train_tiny(plan, data, out, **kw):
    tok = tf.FakeTokenizer(every=1, vocab=97)
    return tr.run_training(plan, data, out, device="cpu", load_model=lambda _: (tf.tiny_model(), tok), echo=lambda *_: None, **kw)


def log_rows(out: Path, kind: str) -> list[dict]:
    return [r for r in map(json.loads, (out / "train_log.jsonl").read_text().splitlines()) if r["kind"] == kind]


def test_training_keeps_every_checkpoint_and_logs_every_step(tmp_path, mlx_cpu):
    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    plan = tiny_plan(data)
    out = tmp_path / "run"
    record = train_tiny(plan, data, out)
    assert record["status"] == "finished" and record["checkpoints"] == [1, 2, 3, 4]
    assert [s for s, _ in tr.find_checkpoints(out)] == [1, 2, 3, 4]
    assert sorted(p.name for p in out.glob("*_optimizer.safetensors")) == ["0000003_optimizer.safetensors", "0000004_optimizer.safetensors"]
    assert (out / "adapters.safetensors").read_bytes() == (out / "0000004_adapters.safetensors").read_bytes()
    assert not list(out.glob("tmp-*"))
    train = log_rows(out, "train")
    assert [r["step"] for r in train] == [1, 2, 3, 4] and [r["rows_seen"] for r in train] == [4, 8, 12, 16]
    assert all(math.isfinite(r["loss"]) and r["tokens"] > r["answer_tokens"] > 0 for r in train)
    assert [r["lr"] for r in train] == pytest.approx([plan.lr_at(s) for s in range(1, 5)], rel=1e-5)
    assert [r["step"] for r in log_rows(out, "val")] == [0, 1, 2, 3, 4]
    assert [json.loads(line)["step"] for line in (out / "val_loss.jsonl").read_text().splitlines()] == [0, 1, 2, 3, 4]
    assert {r["bytes"] for r in log_rows(out, "save")} == {(out / "0000001_adapters.safetensors").stat().st_size}
    run = json.loads((out / "run.json").read_text())
    assert run["data"]["train.jsonl"] == tr.sha256_file(data / "train.jsonl")
    assert run["plan"] == plan.to_dict() and run["segments"][0]["from_step"] == 0
    assert run["segments"][0]["git_commit"] and run["segments"][0]["versions"]["mlx_lm"]
    config = json.loads((out / "adapter_config.json").read_text())
    assert config["num_layers"] == 2 and config["lora_parameters"] == {"rank": 4, "scale": 2.0, "dropout": 0.1}
    # the size worked out from a model's config is the count of real LoRA weights
    tiny = {"hidden_size": 32, "intermediate_size": 48, "num_attention_heads": 4, "num_key_value_heads": 2}
    assert run["trainable_weights"] == tr.lora_parameter_count(tiny, 2, 4)
    assert (out / "0000001_adapters.safetensors").stat().st_size >= 4 * run["trainable_weights"]


def test_a_crashed_run_resumes_and_ends_where_an_unbroken_run_ends(tmp_path, mlx_cpu):
    import mlx.core as mx

    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    plan = tiny_plan(data)
    train_tiny(plan, data, tmp_path / "whole")
    broken = tmp_path / "broken"
    with pytest.raises(RuntimeError, match="test crash after step 2"):
        train_tiny(plan, data, broken, crash_after_step=2)
    assert json.loads((broken / "run.json").read_text())["status"] == "crashed"
    with pytest.raises(tr.PlanError, match="already has checkpoints"):
        train_tiny(plan, data, broken)
    record = train_tiny(plan, data, broken, resume_from=broken / "0000002_adapters.safetensors")
    assert record["status"] == "finished" and [s["from_step"] for s in record["segments"]] == [0, 2]
    for step in (3, 4):
        a = mx.load(str(tmp_path / "whole" / tr.checkpoint_name(step)))
        b = mx.load(str(broken / tr.checkpoint_name(step)))
        assert set(a) == set(b)
        for key in a:
            assert mx.allclose(a[key], b[key], atol=1e-6).item(), (step, key)
    assert [r["step"] for r in log_rows(broken, "train")] == [1, 2, 3, 4]
    assert [r["loss"] for r in log_rows(broken, "train")] == pytest.approx([r["loss"] for r in log_rows(tmp_path / "whole", "train")], rel=1e-5)


def test_a_resume_with_other_settings_is_refused(tmp_path, mlx_cpu):
    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    out = tmp_path / "run"
    with pytest.raises(RuntimeError):
        train_tiny(tiny_plan(data), data, out, crash_after_step=1)
    with pytest.raises(tr.PlanError, match="other settings"):
        train_tiny(tiny_plan(data, save_every=2, eval_every=1), data, out, resume_from=out / "0000001_adapters.safetensors")


def test_a_saved_checkpoint_loads_as_an_mlx_lm_adapter(tmp_path, mlx_cpu):
    import mlx.core as mx
    from mlx.utils import tree_flatten
    from mlx_lm.tuner.utils import load_adapters

    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    out = tmp_path / "run"
    train_tiny(tiny_plan(data), data, out, max_steps=2)
    assert json.loads((out / "run.json").read_text())["status"] == "stopped after --max-steps 2"
    folder = tr.adapter_folder(out, 2)
    model = load_adapters(tf.tiny_model(), str(folder))
    loaded = dict(tree_flatten(model.trainable_parameters()))
    saved = mx.load(str(out / "0000002_adapters.safetensors"))
    assert set(saved) <= set(loaded)
    assert all(mx.array_equal(loaded[k], saved[k]).item() for k in saved)


def test_the_memory_cap_stops_the_run(tmp_path, mlx_cpu):
    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    with pytest.raises(tr.MemoryCap, match="passed the cap"):
        train_tiny(tiny_plan(data, peak_memory_cap_gb=1e-9), data, tmp_path / "run")
    assert json.loads((tmp_path / "run" / "run.json").read_text())["status"] == "stopped: memory cap"


def test_the_buffer_cache_is_cleared_after_every_forward_pass(tmp_path, mlx_cpu, monkeypatch):
    # as mlx-lm's own trainer does; without it the real model wired about 12 GB in its first validation pass
    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    plan = tiny_plan(data)
    cleared = []
    monkeypatch.setattr(mlx_cpu, "get_cache_memory", lambda: 1)
    monkeypatch.setattr(mlx_cpu, "clear_cache", lambda: cleared.append(1))
    train_tiny(plan, data, tmp_path / "run")
    valid_rows = json.loads((data / "meta.json").read_text())["valid"]["rows"]
    valid_passes = math.ceil(valid_rows / plan.batch_size) * len(plan.eval_steps())
    assert len(cleared) == plan.iters + valid_passes


WRAPPER = """
import json, sys
from pathlib import Path
sys.path[:0] = [{ml!r}, {tests!r}]
import mlx.core as mx
mx.set_default_device(mx.cpu)
import train_fakes as tf
from train import train as tr
args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
data, out = Path(args["--data"]), Path(args["--out"])
resume = Path(args["--resume-from"]) if "--resume-from" in args else None
plan = tr.make_plan(tf.train_config(), json.loads((data / "meta.json").read_text()))
tok = tf.FakeTokenizer(every=1, vocab=97)
tr.run_training(plan, data, out, resume_from=resume, device="cpu", load_model=lambda _: (tf.tiny_model(), tok),
                crash_after_step=None if resume else 2)
"""


@pytest.mark.skipif(sys.platform != "darwin", reason="night-run needs macOS (caffeinate, pmset)")
def test_under_night_run_a_crash_resumes_from_the_newest_checkpoint_and_keeps_them_all(tmp_path, mlx_cpu):
    import subprocess

    data = tf.make_data(tmp_path / "rows", tf.FakeTokenizer(every=1, vocab=97))
    wrapper = tmp_path / "wrapper.py"
    wrapper.write_text(WRAPPER.format(ml=str(tr.ML), tests=str(Path(__file__).resolve().parent)))
    out = tmp_path / "run"
    night = tr.ML / "scripts" / "night-run.py"
    done = subprocess.run(
        [sys.executable, str(night), "--name", "tiny", "--logs", str(tmp_path / "logs"), "--allow-battery", "--disk-every", "0.2",
         "--restart-wait", "0.1", "--checkpoints", str(out), "--keep-all", "--resume-args", "--resume-from {checkpoint}", "--",
         sys.executable, str(wrapper), "--data", str(data), "--out", str(out)],
        capture_output=True, text=True, timeout=600,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    log = "\n".join(p.read_text() for p in (tmp_path / "logs").glob("*-tiny.log"))
    assert "test crash after step 2" in log and "resuming from 0000002_adapters.safetensors (step 2)" in log
    assert [s for s, _ in tr.find_checkpoints(out)] == [1, 2, 3, 4]
    assert [r["step"] for r in log_rows(out, "train")] == [1, 2, 3, 4]
    best = json.loads((out / "best.json").read_text())
    losses = {r["step"]: r["loss"] for r in log_rows(out, "val")}
    assert best["step"] == min((s for s in losses if s), key=lambda s: losses[s])
    assert json.loads((out / "run.json").read_text())["status"] == "finished"
