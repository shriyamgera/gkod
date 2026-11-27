import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from train.checkpoints import (  # noqa: E402
    best_checkpoint,
    find_checkpoints,
    latest_checkpoint,
    prune,
    read_loss_file,
    read_val_loss,
)


def make(folder: Path, *steps: int) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for step in steps:
        (folder / f"{step:07d}_adapters.safetensors").write_bytes(b"x")
    (folder / "adapters.safetensors").write_bytes(b"latest")
    (folder / "adapter_config.json").write_text("{}")


def steps_in(folder: Path) -> list[int]:
    return [c.step for c in find_checkpoints(folder)]


def test_reads_the_mlx_lm_032_validation_line_with_colour_codes():
    # The exact bytes mlx-lm 0.32.2's TrainUI.report_val prints when its output goes to a pipe.
    line = "  \x1b[38;5;244m 200\x1b[0m    \x1b[1;35mval\x1b[0m \x1b[1m0.876\x1b[0m    \x1b[38;5;244m3.21s\x1b[0m\n"
    assert read_val_loss(line) == (200, 0.876)


def test_reads_the_older_validation_line():
    assert read_val_loss("Iter 400: Val loss 1.234, Val took 12.5s") == (400, 1.234)


def test_ignores_training_and_save_lines():
    assert read_val_loss("    10    1.234 ▼    1,234      5.0k") is None
    assert read_val_loss("  save  0000200_adapters.safetensors") is None
    assert read_val_loss("") is None


def test_reads_nan_as_a_loss_that_never_wins():
    step, loss = read_val_loss("  300    val nan    1.00s")
    assert step == 300 and math.isnan(loss)


def test_finds_step_checkpoints_in_order_and_skips_other_files(tmp_path):
    make(tmp_path, 300, 100, 200)
    (tmp_path / "notes_adapters.safetensors").write_bytes(b"x")
    assert steps_in(tmp_path) == [100, 200, 300]
    assert latest_checkpoint(tmp_path).name == "0000300_adapters.safetensors"
    assert find_checkpoints(tmp_path / "missing") == []
    assert latest_checkpoint(tmp_path / "missing") is None


def test_keeps_the_last_two_and_the_best(tmp_path):
    make(tmp_path, 100, 200, 300, 400, 500)
    losses = {100: 1.5, 200: 0.9, 300: 1.1, 400: 1.0, 500: 1.2}
    result = prune(tmp_path, losses)
    assert steps_in(tmp_path) == [200, 400, 500]
    assert result == {"kept": [200, 400, 500], "deleted": [100, 300], "best": 200}
    assert json.loads((tmp_path / "best.json").read_text()) == {
        "step": 200,
        "val_loss": 0.9,
        "file": "0000200_adapters.safetensors",
    }
    assert (tmp_path / "adapters.safetensors").exists()
    assert (tmp_path / "adapter_config.json").exists()


def test_keeps_two_when_the_best_is_one_of_the_last_two(tmp_path):
    make(tmp_path, 100, 200, 300)
    prune(tmp_path, {100: 2.0, 200: 1.0, 300: 1.5})
    assert steps_in(tmp_path) == [200, 300]


def test_without_losses_keeps_only_the_last_two_and_writes_no_best(tmp_path):
    make(tmp_path, 100, 200, 300)
    result = prune(tmp_path, {})
    assert steps_in(tmp_path) == [200, 300]
    assert result["best"] is None
    assert not (tmp_path / "best.json").exists()


def test_a_checkpoint_without_a_loss_at_its_own_step_is_never_the_best(tmp_path):
    make(tmp_path, 100, 200, 300, 400)
    # 150 has the lowest loss, but no checkpoint was saved at step 150.
    best = best_checkpoint(find_checkpoints(tmp_path), {150: 0.1, 200: 1.0, 400: 1.2})
    assert best.step == 200


def test_a_tie_keeps_the_earlier_checkpoint_and_nan_never_wins(tmp_path):
    make(tmp_path, 100, 200, 300)
    assert best_checkpoint(find_checkpoints(tmp_path), {100: 1.0, 200: 1.0}).step == 100
    assert best_checkpoint(find_checkpoints(tmp_path), {100: float("nan"), 200: 3.0}).step == 200


def test_reads_losses_a_trainer_wrote_to_its_file_and_skips_broken_lines(tmp_path):
    (tmp_path / "val_loss.jsonl").write_text('{"step": 100, "val_loss": 1.5}\nnot json\n{"step": 200}\n{"step": 300, "val_loss": 0.7}\n')
    assert read_loss_file(tmp_path) == {100: 1.5, 300: 0.7}
    assert read_loss_file(tmp_path / "missing") == {}
