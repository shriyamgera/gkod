import sys
from fractions import Fraction
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from train.config import CONFIGS, load_config, merge  # noqa: E402
from train.selection import Group, groups_from_config, order_key, pick_rows, pick_valid, quotas  # noqa: E402

FAMILIES = sorted(
    ["plate", "bracket", "channel", "tray", "spacer", "hook", "knob", "clip", "shelf", "tool_holder", "divider", "grommet", "cup", "bit_holder", "battery_holder"]
)


def ids(group: str, n: int) -> list[str]:
    return [f"{group}-{k:04d}" for k in range(n)]


def test_quotas_add_up_and_follow_the_weights():
    groups = [Group("a", Fraction(1)), Group("b", Fraction(1)), Group("c", Fraction(2))]
    assert quotas(groups, 8) == {"a": 2, "b": 2, "c": 4}
    # 10 / 4 = 2.5 each for a and b: the left-over rows go to the largest remainders, ties by name
    assert quotas(groups, 10) == {"a": 3, "b": 2, "c": 5}
    assert sum(quotas(groups, 997).values()) == 997


def test_a_smaller_run_is_the_start_of_every_group_of_a_bigger_one():
    candidates = {"create:a": ids("a", 50), "edit:x": ids("x", 50)}
    groups = [Group("create:a", Fraction(3)), Group("edit:x", Fraction(1))]
    full, _ = pick_rows(candidates, groups, 40, "salt", 4)
    half, _ = pick_rows(candidates, groups, 20, "salt", 4)
    for group in candidates:
        f = [i for i in full if i.startswith(group.split(":")[1])]
        h = [i for i in half if i.startswith(group.split(":")[1])]
        assert f[: len(h)] == h
    # the order is sha256(id + salt), not the file order
    a_rows = [i for i in full if i.startswith("a-")]
    assert a_rows == sorted(a_rows, key=lambda i: order_key(i, "salt"))
    assert a_rows != sorted(a_rows)


def test_rows_round_down_to_whole_updates_and_a_short_group_is_reported_not_filled():
    candidates = {"create:a": ids("a", 100), "edit:x": ids("x", 3)}
    groups = [Group("create:a", Fraction(1)), Group("edit:x", Fraction(1))]
    rows, report = pick_rows(candidates, groups, 23, "s", 4)
    assert report["rounded_to"] == 20
    assert report["quotas"] == {"create:a": 10, "edit:x": 10}
    assert report["short"] == {"edit:x": 7}
    # 10 + 3 = 13 rows, so one row comes off the end of the biggest group to make whole updates
    assert report["trimmed"] == {"create:a": 1}
    assert len(rows) == 12 and report["rows"] == 12
    with pytest.raises(ValueError, match="at least 4"):
        pick_rows(candidates, groups, 3, "s", 4)


def test_the_validation_rows_are_round_robin_and_fixed():
    candidates = {"create:a": ids("a", 10), "create:b": ids("b", 10), "edit:x": ids("x", 10), "edit:y": ids("y", 1)}
    valid = pick_valid(candidates, 5, 3, "v")
    assert sum(i.startswith("a-") for i in valid) == 3 and sum(i.startswith("b-") for i in valid) == 2
    assert sum(i.startswith("x-") for i in valid) == 2 and sum(i.startswith("y-") for i in valid) == 1
    assert valid == pick_valid(candidates, 5, 3, "v")
    assert valid != pick_valid(candidates, 5, 3, "other salt")
    with pytest.raises(ValueError, match="only 11 edit rows"):
        pick_valid(candidates, 1, 12, "v")


def test_groups_come_from_the_config_and_unknown_names_are_refused():
    groups = groups_from_config({"create": {"*": 2, "tray": 5}, "edit": {"add": 3, "size": 0}}, ["plate", "tray"])
    assert [(g.name, g.weight) for g in groups] == [("create:plate", 2), ("create:tray", 5), ("edit:add", 3)]
    with pytest.raises(ValueError, match="not in the train split: washer"):
        groups_from_config({"create": {"washer": 1}}, ["plate"])
    with pytest.raises(ValueError, match="unknown edit kinds: resize"):
        groups_from_config({"edit": {"resize": 1}}, ["plate"])
    with pytest.raises(ValueError, match="no group any weight"):
        groups_from_config({"create": {"*": 0}}, ["plate"])


def test_run1_follows_the_insurance_first_plan():
    config = load_config(CONFIGS / "run1-insurance.toml")
    assert [f["file"] for f in config["files"]] == ["ml/configs/base.toml", "ml/configs/run1-insurance.toml"]
    assert config["name"] == "run1-insurance" and config["method"] == "insurance-first"
    groups = {g.name: g.weight for g in groups_from_config(config["rows"], FAMILIES)}
    creates = {k: v for k, v in groups.items() if k.startswith("create:")}
    edits = {k.split(":")[1]: v for k, v in groups.items() if k.startswith("edit:")}
    # 300 creates per family and 1,200 edits weighted toward the weak kinds
    assert len(creates) == 15 and set(creates.values()) == {300}
    assert edits == {"add": 280, "remove": 330, "count": 260, "scale": 160, "size": 100, "move": 40, "hole_d": 30}
    assert sum(groups.values()) == 5700
    # the row count, batch size, gradient checkpointing and checkpoint spacing the 28 Nov probe set
    assert config["rows"]["count"] == 5600
    assert config["train"]["batch_size"] == 1 and config["train"]["grad_checkpoint"] is True
    assert config["train"]["save_every"] == 50 and config["train"]["eval_every"] == 50
    # the plan's learning settings: rank 16 on the last 16 layers, scale x learning rate = 4e-4, Adam, 5% warmup
    assert config["lora"]["rank"] == 16 and config["lora"]["num_layers"] == 16
    assert config["lora"]["scale"] * config["train"]["learning_rate"] == pytest.approx(4e-4)
    assert config["train"]["optimizer"] == "adam" and config["train"]["warmup_fraction"] == 0.05
    assert config["train"]["effective_batch"] == 8 and config["train"]["mask_prompt"] is True
    assert config["valid"] == {"salt": "valid-v1", "create": 75, "edit": 25}


def test_the_base_config_leaves_the_learning_settings_to_each_run():
    base = load_config(CONFIGS / "base.toml")
    for key in ("optimizer", "learning_rate", "warmup_fraction", "decay_to"):
        assert key not in base["train"]
    assert "scale" not in base["lora"]


def test_extends_merges_tables_key_by_key_and_refuses_loops(tmp_path):
    assert merge({"a": {"x": 1, "y": 2}, "b": 1}, {"a": {"y": 3}}) == {"a": {"x": 1, "y": 3}, "b": 1}
    (tmp_path / "one.toml").write_text('extends = "two.toml"\n')
    (tmp_path / "two.toml").write_text('extends = "one.toml"\n')
    with pytest.raises(ValueError, match="extends itself"):
        load_config(tmp_path / "one.toml")
