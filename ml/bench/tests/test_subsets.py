"""The fixed dev subsets (subsets.py): the seeded spread rule, the committed dev-curve file, the checks when a subset
is loaded and used, and a benchmark row on a subset. No model, no GPU; the row needs the OpenSCAD web build."""

import hashlib
import json

import pytest
from fake_set import ScriptedEngine, echo_reference, make_set

from gkod_bench import subsets
from gkod_bench.data import Item, frozen_hashes, order_key
from gkod_bench.paths import REPO, SETS, SETS_HASHES, SUBSETS
from gkod_bench.run import RowMismatch, row_dir, run_row, summarize_row

needs_gkod = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)


def items_like_dev():
    """400 items shaped like dev: 100 per tier, families of uneven size, edits of 7 kinds over 3 part tiers."""
    out = []
    t1 = [f"fam{k:02d}" for k in range(15)]
    for n in range(100):
        out.append(Item(id=f"s201-{n:06d}", task="create", tier="t1", family=t1[n % 15], row={}))
        out.append(Item(id=f"s202-{n:06d}", task="create", tier="t2", family=("bracket", "channel", "plate", "tray")[n // 25], row={}))
        out.append(Item(id=f"s203-{n:06d}", task="create", tier="t3", family="coaster" if n < 34 else ("comb" if n < 67 else "corner_plate"), row={}))
    kinds = ["size"] * 40 + ["remove"] * 20 + ["count"] * 16 + ["scale"] * 8 + ["add"] * 8 + ["move"] * 5 + ["hole_d"] * 3
    for n, kind in enumerate(kinds):
        out.append(Item(id=f"e204-{n:06d}", task="edit", tier="edit", family=t1[n % 7], row={"op": {"kind": kind}, "source_tier": ("t1", "t2", "t3")[n % 3]}))
    return sorted(out, key=lambda i: order_key(i.id))


def test_the_rule_gives_each_tier_its_quota_and_each_group_its_share():
    items = items_like_dev()
    ids = subsets.choose_dev_curve(items)
    assert len(ids) == 50 and len(set(ids)) == 50
    assert ids == sorted(ids, key=order_key)  # the benchmark's order
    spread = subsets.spread_of(items, ids)
    assert {t: spread[t]["prompts"] for t in spread} == {"t1": 13, "t2": 12, "t3": 12, "edit": 13}
    assert spread["t2"]["families"] == {"bracket": 3, "channel": 3, "plate": 3, "tray": 3}
    assert spread["t3"]["families"] == {"coaster": 4, "comb": 4, "corner_plate": 4}
    assert len(spread["t1"]["families"]) == 13 and set(spread["t1"]["families"].values()) == {1}
    # every edit kind gets its share of 13 (13 x its part of 100), rounded down or up
    shares = {"size": 40, "remove": 20, "count": 16, "scale": 8, "add": 8, "move": 5, "hole_d": 3}
    for kind, n in shares.items():
        got = spread["edit"]["kinds"].get(kind, 0)
        assert int(13 * n / 100) <= got <= int(13 * n / 100) + 1, kind
    # the same every time, and another seed picks others
    assert subsets.choose_dev_curve(items) == ids
    assert subsets.choose_dev_curve(items, seed="other") != ids


def test_a_spread_pick_takes_from_every_group_in_proportion():
    items = [Item(id=f"x{n}", task="create", tier="t1", family="a" if n < 30 else "b", row={}) for n in range(40)]
    picked = subsets.spread_pick(items, 8, "seed")
    assert sum(i.family == "a" for i in picked) == 6 and sum(i.family == "b" for i in picked) == 2
    with pytest.raises(ValueError):
        subsets.spread_pick(items, 41, "seed")


@pytest.mark.skipif(not (SETS / "dev" / "create.jsonl").exists(), reason="the frozen dev files are only on the Mac")
def test_the_dev_curve_file_is_what_its_rule_picks_from_the_frozen_dev_files():
    saved = subsets.load("dev-curve")
    fresh = subsets.make_dev_curve()
    assert list(saved.ids) == fresh["ids"] and len(saved.ids) == 50
    frozen = frozen_hashes(SETS_HASHES)
    assert saved.files == {k: frozen[k] for k in ("dev/create.jsonl", "dev/edit.jsonl")}
    data = json.loads((SUBSETS / "dev-curve.json").read_text())
    assert data["split"] == "dev" and data["seed"] == subsets.DEV_CURVE_SEED and data["rule"] == subsets.DEV_CURVE_RULE


def test_the_committed_dev_curve_file_is_dev_only_and_complete():
    data = json.loads((SUBSETS / "dev-curve.json").read_text())
    assert data["split"] == "dev" and set(data["files"]) == {"dev/create.jsonl", "dev/edit.jsonl"}
    assert len(data["ids"]) == 50 and all(i.startswith(("s201-", "s202-", "s203-", "e204-")) for i in data["ids"])
    assert sum(1 for i in data["ids"] if i.startswith("e204-")) == 13


def subset_file(folder, name, ids, files, split="dev"):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.json").write_text(json.dumps({"name": name, "split": split, "ids": ids, "files": files}))


def test_a_subset_is_dev_only_and_refuses_other_files(tmp_path):
    files = {"dev/create.jsonl": "a", "dev/edit.jsonl": "b"}
    subset_file(tmp_path, "bad", ["x"], files, split="test")
    with pytest.raises(subsets.SubsetMismatch, match="dev split only"):
        subsets.load("bad", tmp_path)
    subset_file(tmp_path, "twice", ["x", "x"], files)
    with pytest.raises(subsets.SubsetMismatch, match="twice"):
        subsets.load("twice", tmp_path)
    subset_file(tmp_path, "ok", ["x"], files)
    s = subsets.load("ok", tmp_path)
    items = [Item(id="x", task="create", tier="t1", family="f", row={}), Item(id="y", task="create", tier="t1", family="f", row={})]
    assert [i.id for i in s.pick(items, "dev", files)] == ["x"]
    with pytest.raises(subsets.SubsetMismatch, match="changed"):
        s.pick(items, "dev", {**files, "dev/edit.jsonl": "c"})
    with pytest.raises(subsets.SubsetMismatch, match="not in the dev split"):
        s.pick(items[1:], "dev", files)
    with pytest.raises(FileNotFoundError):
        subsets.load("missing", tmp_path)
    with pytest.raises(ValueError):
        subsets.load("../x", tmp_path)


@pytest.fixture
def toy(tmp_path):
    sets = tmp_path / "sets"
    hashes = make_set(sets)
    files = {name: hashlib.sha256((sets / name).read_bytes()).hexdigest() for name in ("dev/create.jsonl", "dev/edit.jsonl")}
    subset_file(tmp_path / "subsets", "mini", ["d-1", "d-2", "de-1"], files)
    kw = {"results": tmp_path / "results", "sets_dir": sets, "hashes": hashes, "log": lambda line: None}
    return {"kw": kw, "tmp": tmp_path}


@needs_gkod
def test_a_row_on_a_subset_asks_only_its_prompts_and_keeps_the_list(toy):
    kw = toy["kw"]
    mini = subsets.load("mini", toy["tmp"] / "subsets")
    engine = ScriptedEngine(echo_reference)
    summary = run_row(engine, "on-mini", "dev", subset=mini, **kw)
    assert summary["complete"] and summary["prompts"] == 3 and len(engine.calls) == 3
    config = json.loads((row_dir(kw["results"], "on-mini", "dev") / "run.json").read_text())
    assert config["subset"]["name"] == "mini" and config["subset"]["ids"] == list(mini.ids)
    assert summarize_row("on-mini", "dev", results=kw["results"], sets_dir=kw["sets_dir"], hashes=kw["hashes"])["prompts"] == 3
    # the same row with all the prompts, or another subset, is another row
    with pytest.raises(RowMismatch, match="subset"):
        run_row(ScriptedEngine(echo_reference), "on-mini", "dev", **kw)
