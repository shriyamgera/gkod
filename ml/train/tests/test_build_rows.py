"""The row builder on a hand-made set, with the site's real wording through `gkod batch` and a stand-in tokenizer.
The last test uses the model's real tokenizer when it is on disk (the Mac), never the model's weights."""

import builtins
import hashlib
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_fakes as tf  # noqa: E402

from gkod_bench.gkod import Gkod, GkodError  # noqa: E402
from gkod_bench.paths import LOCAL_MODEL, SETS  # noqa: E402

from train import build_rows as br  # noqa: E402

TOKENIZER = tf.FakeTokenizer()


@pytest.fixture(scope="module")
def gkod():
    try:
        g = Gkod(workers=1)
    except GkodError as err:
        pytest.skip(f"gkod batch is not available: {err}")
    yield g
    g.close()


def build(made, out, gkod, rows=12, batch_size=2, config=None, **kw):
    return br.build(
        config or tf.config(),
        rows,
        out,
        batch_size,
        tokenizer=kw.pop("tokenizer", TOKENIZER),
        gkod=gkod,
        sets_dir=made["sets"],
        hashes=made["hashes"],
        examples_dir=made["examples"],
        log=lambda *_: None,
        **kw,
    )


def read(out: Path, name: str) -> list[dict]:
    return [json.loads(line) for line in (out / name).read_text().splitlines()]


def test_rows_are_the_sites_words_and_one_code_block(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    build(made, tmp_path / "out", gkod)
    rows = read(tmp_path / "out", "train.jsonl")
    prompts_ts = (br.PROMPTS_TS).read_text()
    for row in rows:
        assert list(row) == ["messages"]
        system, user, answer = row["messages"]
        assert [m["role"] for m in row["messages"]] == ["system", "user", "assistant"]
        assert system["content"].startswith("You write OpenSCAD code") and "Keep the code under 150 lines." in system["content"]
        assert system["content"].splitlines()[0] in prompts_ts
        assert user["content"].startswith(("Make this part: ", "Here is the current OpenSCAD code for the part:"))
        assert answer["content"].startswith("```openscad\n") and answer["content"].endswith("\n```")
        assert answer["content"].count("```") == 2


def test_the_guards_refuse_each_bad_row_and_keep_the_rest(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    meta = build(made, tmp_path / "out", gkod)
    assert meta["refused_ids"] == {k: sorted(v) for k, v in sorted(made["refused"].items())}
    used = {d[0] for d in meta["train"]["rows_detail"]} | {d[0] for d in meta["valid"]["rows_detail"]}
    refused = {i for v in made["refused"].values() for i in v}
    assert not used & refused
    # every good row is a candidate: 36 creates and 18 edits
    assert sum(meta["candidates"].values()) == 54
    # each guard on its own, called directly
    edit = tf.edit_row("e1-x", "add", 1)
    edit["source_tier"] = "t1"
    assert br.row_problem("edit", edit, set()) == br.NOT_TRAIN
    create = tf.create_row("s1-x", "plate", 1)
    create["tree_sha256"] = ""
    assert br.row_problem("create", create, set()) == br.NO_TREE
    edit = tf.edit_row("e1-y", "add", 1)
    edit["source"]["generator"] = None
    assert br.row_problem("edit", edit, set()) == br.NO_PROVENANCE


def test_validation_rows_are_never_trained_on_and_never_dev(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    meta = build(made, tmp_path / "out", gkod)
    train_ids = [d[0] for d in meta["train"]["rows_detail"]]
    valid_ids = [d[0] for d in meta["valid"]["rows_detail"]]
    assert len(valid_ids) == 4 and not set(train_ids) & set(valid_ids)
    assert all(i.startswith(("s1-", "e1-")) for i in train_ids + valid_ids)
    assert meta["valid"]["groups"] == {"create:plate": 1, "create:spacer": 1, "create:tray": 1, "edit:add": 1}
    assert len(train_ids) == 12 and meta["train"]["groups"] == {
        "create:plate": 2,
        "create:spacer": 2,
        "create:tray": 2,
        "edit:add": 2,
        "edit:remove": 2,
        "edit:size": 2,
    }


def test_no_training_row_is_made_from_a_validation_rows_part(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    meta = build(made, tmp_path / "out", gkod, rows=24)
    rows = {}
    for task in ("create", "edit"):
        for line in (made["sets"] / "train" / f"{task}.jsonl").read_text().splitlines():
            row = json.loads(line)
            rows[row["id"]] = (task, row)
    train_ids = [d[0] for d in meta["train"]["rows_detail"]]
    valid_ids = [d[0] for d in meta["valid"]["rows_detail"]]
    valid_parts = {br.part_of(*rows[i]) for i in valid_ids}
    assert not valid_parts & {br.part_of(*rows[i]) for i in train_ids}
    # the held-out rows are listed, and each one shares its part with a validation row
    held = meta["held_out_with_valid"]
    assert held["rows"] == len(held["ids"]) > 0
    assert all(br.part_of(*rows[i]) in valid_parts and i not in valid_ids and i not in train_ids for i in held["ids"])
    assert meta["versions"]["python"] and "transformers" in meta["versions"]


def test_the_same_inputs_give_the_same_bytes(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    build(made, tmp_path / "a", gkod)
    build(made, tmp_path / "b", gkod)
    for name in ("train.jsonl", "valid.jsonl", "meta.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes(), name
    other = build(made, tmp_path / "c", gkod, config=tf.config(salt="another salt"))
    assert (tmp_path / "c" / "train.jsonl").read_bytes() != (tmp_path / "a" / "train.jsonl").read_bytes()
    assert other["valid"]["rows_detail"] == json.loads((tmp_path / "a" / "meta.json").read_text())["valid"]["rows_detail"]


def test_rows_are_in_length_buckets_one_batch_long(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    meta = build(made, tmp_path / "out", gkod, rows=12, batch_size=4)
    lengths = [p + a for _, _, p, a in meta["train"]["rows_detail"]]
    batches = [lengths[k : k + 4] for k in range(0, 12, 4)]
    # inside a batch the rows are sorted by length, and no batch overlaps another's range of lengths
    spans = sorted((min(b), max(b)) for b in batches)
    assert all(b == sorted(b) for b in batches)
    assert all(spans[k][1] <= spans[k + 1][0] for k in range(len(spans) - 1))
    # longest first is only for the memory probe
    probe = build(made, tmp_path / "probe", gkod, rows=12, batch_size=4, longest_first=True)
    first = [p + a for _, _, p, a in probe["train"]["rows_detail"]][:4]
    assert max(first) == max(lengths)
    assert meta["train"]["tokens"]["total"] == sum(lengths)


def test_the_meta_records_where_everything_came_from(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    meta = build(made, tmp_path / "out", gkod)
    assert set(meta["sources"]) == {"train/create.jsonl", "train/edit.jsonl", "dev/create.jsonl", "dev/edit.jsonl"}
    for name, digest in meta["sources"].items():
        assert digest == hashlib.sha256((made["sets"] / name).read_bytes()).hexdigest()
    assert meta["generator_commits"] == [tf.COMMIT]
    assert meta["files"]["train.jsonl"] == hashlib.sha256((tmp_path / "out" / "train.jsonl").read_bytes()).hexdigest()
    assert meta["examples"] == {"example.scad": hashlib.sha256(tf.EXAMPLE.encode()).hexdigest()}
    assert meta["system_sha256"] and meta["builder_commit"]
    assert meta["batch_size"] == 2 and meta["effective_batch"] == 4 and meta["max_tokens"] == 1500


def test_a_changed_set_file_is_refused(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    with (made["sets"] / "train" / "create.jsonl").open("a") as f:
        f.write(json.dumps(tf.create_row("s1-extra", "plate", 99)) + "\n")
    with pytest.raises(ValueError, match="not the frozen"):
        build(made, tmp_path / "out", gkod)


def test_nothing_under_the_test_split_is_ever_opened(tmp_path, gkod, monkeypatch):
    made = tf.make_set(tmp_path)
    opened = []
    real_open = builtins.open

    def spy(file, *args, **kwargs):
        opened.append(Path(str(file)).resolve() if isinstance(file, (str, Path)) else file)
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy)
    monkeypatch.setattr(io, "open", spy)
    build(made, tmp_path / "out", gkod)
    monkeypatch.undo()
    test_dir = (made["sets"] / "test").resolve()
    assert opened, "the spy saw no file opened"
    assert not [p for p in opened if isinstance(p, Path) and p.is_relative_to(test_dir)]


def test_test_paths_are_refused_before_they_are_opened(tmp_path, gkod):
    made = tf.make_set(tmp_path)
    for path in (SETS / "test" / "create.jsonl", SETS / "test", SETS / "dev" / ".." / "test" / "edit.jsonl"):
        with pytest.raises(br.TestSplitRefused):
            br.refuse_test_path(path)
    with pytest.raises(br.TestSplitRefused):
        br.refuse_test_path(made["sets"] / "test" / "create.jsonl", made["sets"])
    br.refuse_test_path(SETS / "train" / "create.jsonl")
    # a sets folder inside the test split: its train files are refused, not opened (they do not even exist)
    with pytest.raises(br.TestSplitRefused):
        build({**made, "sets": made["sets"] / "test"}, tmp_path / "out", gkod)
    # a link that leads into the test split is refused too
    linked = tmp_path / "linked"
    (linked / "train").mkdir(parents=True)
    (linked / "train" / "create.jsonl").symlink_to(made["sets"] / "test" / "create.jsonl")
    with pytest.raises(br.TestSplitRefused):
        br.refuse_test_path(linked / "train" / "create.jsonl", made["sets"])
    with pytest.raises(br.TestSplitRefused):
        build(made, made["sets"] / "test" / "rows", gkod)
    with pytest.raises(br.TestSplitRefused):
        br.main(["--config", "ml/configs/run1-insurance.toml", "--rows", "8", "--out", str(tmp_path / "x"), "--sets", str(SETS / "test")])


def test_the_label_and_provenance_rules():
    good = tf.create_row("s1-a", "plate", 1)
    assert br.row_problem("create", good, set()) is None
    bad = json.loads(json.dumps(good))
    bad["labels"]["compile"]["ok"] = False
    assert br.row_problem("create", bad, set()) == br.LABEL_FAILED
    bad = json.loads(json.dumps(good))
    bad["generator"]["commit"] = "not a commit"
    assert br.row_problem("create", bad, set()) == br.NO_PROVENANCE
    bad = json.loads(json.dumps(good))
    bad["generator"]["dirty"] = None
    assert br.row_problem("create", bad, set()) == br.DIRTY
    edit = tf.edit_row("e1-a", "add", 1)
    assert br.row_problem("edit", edit, set()) is None
    edit["labels"]["sizes_ok"] = False
    assert br.row_problem("edit", edit, set()) == br.LABEL_FAILED
    del edit["labels"]["sizes_ok"]
    assert br.row_problem("edit", edit, set()) == br.LABEL_MISSING
    assert br.row_problem("create", good, {good["tree_sha256"]}) == br.DEV_TREE


def test_example_text_is_found_by_runs_of_lines_not_by_common_lines(tmp_path):
    examples = tmp_path / "ex"
    examples.mkdir()
    (examples / "a.scad").write_text(tf.EXAMPLE)
    windows, files = br.example_windows(examples)
    assert br.shares_example_text("x = 1;\n" + tf.EXAMPLE, windows)
    lines = [line for line in tf.EXAMPLE.splitlines() if line.strip()]
    assert br.shares_example_text("\n\n".join("   " + line for line in lines[2:6]), windows)
    # three lines in a row are not enough, and a generic line alone never is
    assert not br.shares_example_text("\n".join(lines[2:5]), windows)
    assert not br.shares_example_text("}\ndifference() {\n}\n", windows)
    real_windows, real_files = br.example_windows()
    assert set(real_files) >= {"wall_hook.scad", "cable_clip.scad", "phone_stand.scad", "test_cube.scad"}
    assert br.shares_example_text((br.EXAMPLES / "wall_hook.scad").read_text(), real_windows)


def test_padding_matches_mlx_lm():
    assert br.padded(1, 2048) == 33 and br.padded(32, 2048) == 33 and br.padded(33, 2048) == 65
    assert br.padded(2040, 2048) == 2048


@pytest.mark.skipif(not (LOCAL_MODEL / "tokenizer.json").exists(), reason="the model's tokenizer is only on the Mac")
def test_with_the_real_tokenizer_the_prompt_is_the_benchmarks_prompt_byte_for_byte(tmp_path, gkod):
    pytest.importorskip("mlx_lm")
    from gkod_bench.data import Item
    from gkod_bench.engines.local import LocalEngine
    from gkod_bench.prompts import build as bench_messages
    from mlx_lm.tuner.datasets import ChatDataset

    tokenizer = br.load_tokenizer(LOCAL_MODEL)
    made = tf.make_set(tmp_path, broken=False)
    meta = build(made, tmp_path / "out", gkod, tokenizer=tokenizer)
    rows = read(tmp_path / "out", "train.jsonl")
    by_id = {}
    for task in ("create", "edit"):
        for line in (made["sets"] / "train" / f"{task}.jsonl").read_text().splitlines():
            row = json.loads(line)
            by_id[row["id"]] = Item(id=row["id"], task=task, tier=row["tier"], family=row["family"], row=row)
    detail = meta["train"]["rows_detail"]
    items = [by_id[d[0]] for d in detail]
    bench = bench_messages(gkod, items)
    engine = SimpleNamespace(tokenizer=tokenizer)
    dataset = ChatDataset(rows, tokenizer, mask_prompt=True)
    for row, (rid, _, prompt_tokens, answer_tokens), item in zip(rows, detail, items):
        prompt_text = LocalEngine.prompt_text(engine, bench[rid])
        ours = tokenizer.apply_chat_template(row["messages"][:-1], add_generation_prompt=True, tokenize=False)
        assert ours == prompt_text
        full = tokenizer.apply_chat_template(row["messages"], tokenize=False)
        assert full.startswith(prompt_text)
        tokens, offset = dataset.process(row)
        assert tokens[:offset] == tokenizer.apply_chat_template(row["messages"][:-1], add_generation_prompt=True, return_dict=False)
        assert (offset, len(tokens) - offset) == (prompt_tokens, answer_tokens)
        # the answer is what the loss is taken on, and it ends with the end-of-turn token
        assert tokenizer.decode(tokens[offset:]).startswith("```openscad\n")
        assert tokens[-2] == tokenizer.convert_tokens_to_ids("<|im_end|>")
