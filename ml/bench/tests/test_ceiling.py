import json
import pathlib

import pytest
from fake_set import create_row, make_hashes, make_set, plate

from gkod_bench import ceiling
from gkod_bench.ceiling import ensure, guess, guesses, load, named_sizes, share, stated_names, train_medians
from gkod_bench.data import load_split
from gkod_bench.paths import REPO
from gkod_bench.score import RIGHT_PART_IOU

needs_compiler = pytest.mark.skipif(
    not (REPO / "app" / "public" / "openscad" / "openscad.wasm").exists(),
    reason="the OpenSCAD web build is missing (npm run fetch:openscad)",
)

MEDIANS = {"family": {("tray", "wall"): 2.2}, "name": {"wall": 2.4, "hole_d": 4.0, "thickness": 5.0, "width": 83.0, "depth": 60.0}}


def thick(code, value):
    return code.replace("thickness = 4;", f"thickness = {value};")


def write_train(sets, rows):
    """Replaces the fake set's train parts and writes the hash list again."""
    (sets / "train" / "create.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    return make_hashes(sets)


@pytest.fixture
def fake(tmp_path):
    sets = tmp_path / "sets"
    hashes = make_set(sets)
    return {"sets_dir": sets, "hashes": hashes, "results": tmp_path / "results"}


def test_named_sizes_read_the_generator_format():
    assert named_sizes(plate(60, 30, 2)) == {"width": 60.0, "depth": 30.0, "thickness": 4.0}
    # nothing after the hidden block, and no line without a slider
    assert named_sizes("a = 1; // [0:1:2]\nb = 2;\n/* [Hidden] */\nc = 3; // [0:1:5]\n") == {"a": 1.0}


def test_a_stated_compartment_count_states_the_divider_count():
    assert stated_names([{"key": "width"}, {"key": "compartment_count"}]) == {"width", "compartment_count", "divider_count"}


def test_a_guess_comes_from_the_family_then_any_family_then_the_last_two_words():
    assert guess("tray", "wall", MEDIANS) == (2.2, "family")
    assert guess("coaster", "wall", MEDIANS) == (2.4, "any family")
    assert guess("corner_plate", "arm1_hole_d", MEDIANS) == (4.0, "last two words")
    # one word is not enough: an arm's width is not the part's width, a slot's depth not the part's depth
    assert guess("corner_plate", "arm_width", MEDIANS) == (None, None)
    assert guess("comb", "slot_depth", MEDIANS) == (None, None)


def test_guesses_skip_stated_sizes_and_list_what_train_cannot_guess():
    row = {"family": "comb", "facts": [{"key": "width"}], "code": "width = 80; // [60:1:100]\nthickness = 3; // [2:0.5:5]\nslot_depth = 12; // [8:1:16]\n"}
    got, kept = guesses(row, ["width", "thickness", "slot_depth"], MEDIANS)
    assert got == {"thickness": {"was": 3.0, "guess": 5.0, "from": "any family"}}
    assert kept == ["slot_depth"]


def test_train_medians_use_the_lower_middle_value(fake):
    rows = [
        {**create_row(f"tr-{i}", "train", "train", 55), "code": thick(plate(55), t)}
        for i, t in enumerate((2, 3, 5, 6))
    ]
    rows.append({**create_row("tr-c", "train", "train", 55, family="coaster"), "code": thick(plate(55), 9)})
    hashes = write_train(fake["sets_dir"], rows)
    medians, digest = train_medians(fake["sets_dir"], hashes)
    # plates 2, 3, 5, 6: the lower middle, a value the generator really used
    assert medians["family"][("plate", "thickness")] == 3
    assert medians["family"][("coaster", "thickness")] == 9
    assert medians["name"]["thickness"] == 5 and len(digest) == 64


def test_train_medians_refuse_a_changed_train_file(fake):
    path = fake["sets_dir"] / "train" / "create.jsonl"
    path.write_text(path.read_text().replace('"width", "value": 55', '"width", "value": 56'))
    with pytest.raises(ValueError, match="has sha256"):
        train_medians(fake["sets_dir"], fake["hashes"])


def test_share_counts_the_prompts_asked_for():
    saved = {"prompts": {"a": {"iou": 1.0, "kept": []}, "b": {"iou": 0.5, "kept": []}, "c": {"iou": 0.995, "kept": ["slot_depth"]}}}
    assert share(saved, ["a", "b", "c", "edit-1"]) == {"k": 2, "n": 3, "kept_a_true_value": 1}
    assert share(saved, ["a", "b"], threshold=0.4) == {"k": 2, "n": 2, "kept_a_true_value": 0}
    assert share(None, ["a"]) is None


@needs_compiler
def test_the_ceiling_is_worked_out_once_and_kept(fake, monkeypatch):
    items, files = load_split("dev", sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    saved = ensure(fake["results"], "dev", items, files, sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    # create prompts only; the plates never state their thickness, and train's median (4) is the reference's
    assert set(saved["prompts"]) == {"d-1", "d-2", "d-3"}
    d3 = saved["prompts"]["d-3"]
    assert d3["guessed"] == {"thickness": {"was": 4.0, "guess": 4.0, "from": "any family"}} and d3["family"] == "coaster"
    assert all(p["iou"] == pytest.approx(1.0) and p["compiles"] for p in saved["prompts"].values())
    assert saved["files"]["dev/create.jsonl"] == files["dev/create.jsonl"] and len(saved["files"]["train/create.jsonl"]) == 64
    assert (fake["results"] / "ceiling" / "dev.json").exists()

    # the second time it is read back, not worked out again
    def no_compile(*args, **kwargs):
        raise AssertionError("worked out again")

    monkeypatch.setattr(ceiling, "compute", no_compile)
    assert ensure(fake["results"], "dev", items, files, sets_dir=fake["sets_dir"], hashes=fake["hashes"])["prompts"] == saved["prompts"]
    # a changed dev file makes the saved one stale
    assert load(fake["results"], "dev", {**files, "dev/create.jsonl": "0" * 64}) is None


@needs_compiler
def test_a_wrong_guess_lowers_the_overlap(fake):
    # every train plate is 2 mm thick, the dev plates 4 mm: the guess is half the reference's thickness
    rows = [{**create_row(f"tr-{f}", "train", "train", 55, family=f), "code": thick(plate(55), 2)} for f in ("spacer", "plate", "bracket")]
    hashes = write_train(fake["sets_dir"], rows)
    items, files = load_split("dev", sets_dir=fake["sets_dir"], hashes=hashes)
    saved = ensure(fake["results"], "dev", items, files, sets_dir=fake["sets_dir"], hashes=hashes)
    d1 = saved["prompts"]["d-1"]
    assert d1["guessed"]["thickness"] == {"was": 4.0, "guess": 2.0, "from": "family"}
    assert 0.4 < d1["iou"] < 0.6 and d1["same_pieces"] and d1["same_holes"]
    assert share(saved, ["d-1", "d-2", "d-3"]) == {"k": 0, "n": 3, "kept_a_true_value": 0}
    assert RIGHT_PART_IOU > d1["iou"]


@needs_compiler
def test_the_ceiling_never_opens_the_test_split(fake, monkeypatch):
    test_dir = fake["sets_dir"] / "test"
    test_dir.mkdir()
    (test_dir / "create.jsonl").write_text("not for anyone\n")
    opened = []
    real_open = pathlib.Path.open

    def watch(self, *args, **kwargs):
        opened.append(str(self))
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(pathlib.Path, "open", watch)
    items, files = load_split("dev", sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    ensure(fake["results"], "dev", items, files, sets_dir=fake["sets_dir"], hashes=fake["hashes"])
    assert opened and not [p for p in opened if str(test_dir) in p]
    assert str(fake["sets_dir"] / "train" / "create.jsonl") in opened
