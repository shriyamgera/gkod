import hashlib
import json

import pytest

from gkod_bench.data import FROZEN, SplitClosed, check_open, fewshot, load_split, order_key
from gkod_bench.paths import SETS


def write_set(root, rows_by_file):
    """A tiny set folder with its own hash list."""
    lines = []
    for name, rows in rows_by_file.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}")
    hashes = root / "hashes.sha256"
    hashes.write_text("\n".join(lines) + "\n")
    return hashes


def part(id, split, tier, family="plate", features=1):
    return {"id": id, "split": split, "tier": tier, "family": family, "tree": {"features": [{}] * features}, "code": "cube(1);\n"}


def edit(id, split, kind="size", lines=10):
    return {"id": id, "split": split, "tier": "edit", "family": "plate", "op": {"kind": kind}, "a": {"code": "x;\n" * lines}}


def test_the_test_split_is_closed_without_final(tmp_path):
    with pytest.raises(SplitClosed, match="frozen until the final run"):
        check_open("test")
    check_open("test", final=True)
    check_open("dev")
    with pytest.raises(ValueError):
        check_open("train")
    # refused before any file is opened: the folder does not even exist
    with pytest.raises(SplitClosed):
        load_split("test", sets_dir=tmp_path / "nowhere", hashes=tmp_path / "none.sha256")
    assert "--final" in FROZEN


def test_load_split_reads_both_files_in_a_fixed_mixed_order(tmp_path):
    rows = {
        "dev/create.jsonl": [part(f"c{i}", "dev", f"t{1 + i % 3}") for i in range(9)],
        "dev/edit.jsonl": [edit(f"e{i}", "dev") for i in range(3)],
    }
    hashes = write_set(tmp_path, rows)
    items, files = load_split("dev", sets_dir=tmp_path, hashes=hashes)
    assert len(items) == 12 and set(files) == {"dev/create.jsonl", "dev/edit.jsonl"}
    assert [i.id for i in items] == sorted((i.id for i in items), key=order_key)
    assert {i.task for i in items} == {"create", "edit"}
    assert {i.tier for i in items} == {"t1", "t2", "t3", "edit"}


def test_a_changed_file_is_refused(tmp_path):
    rows = {"dev/create.jsonl": [part("c0", "dev", "t1")], "dev/edit.jsonl": [edit("e0", "dev")]}
    hashes = write_set(tmp_path, rows)
    (tmp_path / "dev" / "create.jsonl").write_text(json.dumps(part("c0", "dev", "t2")) + "\n")
    with pytest.raises(ValueError, match="not the frozen"):
        load_split("dev", sets_dir=tmp_path, hashes=hashes)


def test_a_row_from_another_split_is_refused(tmp_path):
    rows = {"dev/create.jsonl": [part("c0", "test", "t1")], "dev/edit.jsonl": [edit("e0", "dev")]}
    hashes = write_set(tmp_path, rows)
    with pytest.raises(ValueError, match="'test' split"):
        load_split("dev", sets_dir=tmp_path, hashes=hashes)


def test_fewshot_picks_by_rule_from_train(tmp_path):
    rows = {
        "train/create.jsonl": [
            part("s0", "train", "train", "spacer", features=0),
            part("s1", "train", "train", "spacer"),
            part("p0", "train", "train", "plate", features=2),
            part("p1", "train", "train", "plate"),
            part("b0", "train", "train", "bracket"),
        ],
        "train/edit.jsonl": [edit("e0", "train", "size", lines=60), edit("e1", "train", "size"), edit("e2", "train", "add"), edit("e3", "train", "remove")],
    }
    hashes = write_set(tmp_path, rows)
    picked, record = fewshot("create", sets_dir=tmp_path, hashes=hashes)
    assert [r["id"] for r in picked] == ["s1", "p1", "b0"] and record["ids"] == ["s1", "p1", "b0"]
    picked, record = fewshot("edit", sets_dir=tmp_path, hashes=hashes)
    assert record["ids"] == ["e1", "e2", "e3"] and record["file"] == "train/edit.jsonl"


needs_sets = pytest.mark.skipif(not (SETS / "dev" / "create.jsonl").exists(), reason="the frozen sets are not on this machine")


@needs_sets
def test_the_real_dev_split():
    items, files = load_split("dev")
    assert len(items) == 400
    tiers = {t: sum(i.tier == t for i in items) for t in ("t1", "t2", "t3", "edit")}
    assert tiers == {"t1": 100, "t2": 100, "t3": 100, "edit": 100}
    # the first 40 in the fixed order already reach every tier
    assert {i.tier for i in items[:40]} == {"t1", "t2", "t3", "edit"}


@needs_sets
def test_the_real_fewshot_examples_are_train_rows_and_not_hook_or_clip():
    for task in ("create", "edit"):
        picked, record = fewshot(task)
        assert len(picked) == 3 and all(r["split"] == "train" for r in picked)
        assert not {"hook", "clip"} & set(record["families"])
