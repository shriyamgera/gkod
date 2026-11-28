"""Hand-made stand-ins for the training tests: a tiny frozen-set folder, a tokenizer that renders the chat like Qwen's
template and counts characters, and a tiny random Qwen2 model for the CPU. None of it is real training data."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parents[2]
if str(ML) not in sys.path:
    sys.path.insert(0, str(ML))

COMMIT = "c" * 40
GEN = {"name": "gkod-datagen", "version": "0.1.0", "commit": COMMIT, "dirty": False}
CHECKS = {"ok": True, "results": [{"id": "closed", "ok": True}, {"id": "fits-bed", "ok": True}]}
# a stand-in for the site's example files: the build only reads them to refuse rows that copy them
EXAMPLE = """// Example bracket
width = 20; // [10:1:40]
height = 30; // [20:1:60]
module example_arm() {
  cube([width, 5, height]);
}
example_arm();
"""


def code(family: str, n: int, lines: int = 0) -> str:
    extra = "".join(f"// note {k} for part {n}\n" for k in range(lines))
    return f"// {family.title()}\n\n// Width (mm)\nwidth = {40 + n}; // [20:1:120]\n\n/* [Hidden] */\n$fn = 48;\n{extra}cube([width, {10 + n % 7}, 4]);\n"


def tree_hash(name: str) -> str:
    return hashlib.sha256(name.encode()).hexdigest()


def create_row(rid: str, family: str, n: int, split: str = "train", lines: int = 0) -> dict:
    return {
        "id": rid,
        "split": split,
        "tier": "train" if split == "train" else "t1",
        "generator": dict(GEN),
        "family": family,
        "tree_sha256": tree_hash(f"tree-{rid}"),
        "request": f"a {family} {40 + n} mm wide",
        "code": code(family, n, lines),
        "labels": {"compile": {"ok": True}, "checks": copy.deepcopy(CHECKS), "params_ok": True, "facts_ok": True},
    }


def edit_row(rid: str, kind: str, n: int, split: str = "train") -> dict:
    return {
        "id": rid,
        "split": split,
        "tier": "edit",
        "source_tier": "train" if split == "train" else "t1",
        "generator": dict(GEN),
        "source": {"id": f"src-{rid}", "generator": dict(GEN)},
        "family": "plate",
        "op": {"kind": kind},
        "instruction": f"change {kind} number {n}",
        "a": {"tree_sha256": tree_hash(f"a-{rid}"), "code": code("plate", n)},
        "b": {"tree_sha256": tree_hash(f"b-{rid}"), "code": code("plate", n + 1)},
        "labels": {"compile": {"ok": True}, "checks": copy.deepcopy(CHECKS), "params_ok": True, "facts_ok": True, "a_compile_ok": True, "sizes_ok": True},
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def make_set(root: Path, broken: bool = True) -> dict:
    """A set folder (train, dev and a test folder that must never be read) with its hashes file and an examples
    folder. With `broken`, one row of each kind the builder must refuse is added. Returns the paths and the ids of
    the rows that must be refused, by reason."""
    sets = root / "sets"
    creates = [create_row(f"s1-{f[:2]}{n:03d}", f, n) for f in ("plate", "tray", "spacer") for n in range(12)]
    edits = [edit_row(f"e1-{k[:3]}{n:03d}", k, n) for k in ("add", "size", "remove") for n in range(6)]
    # as in v1, every train edit is made from a train create part; some parts have two edits
    for k, edit in enumerate(edits):
        edit["source"]["id"] = creates[(5 * k) % len(creates)]["id"]
    dev_creates = [create_row(f"s2-dev{n:03d}", "plate", 100 + n, split="dev") for n in range(3)]
    dev_edits = [edit_row(f"e2-dev{n:03d}", "size", 100 + n, split="dev") for n in range(2)]
    refused: dict[str, list[str]] = {}
    if broken:
        dirty = create_row("s1-dirty", "plate", 50)
        dirty["generator"]["dirty"] = True
        nogen = create_row("s1-nogen", "plate", 51)
        del nogen["generator"]
        failed = create_row("s1-failed", "tray", 52)
        failed["labels"]["checks"]["results"][1]["ok"] = False
        missing = create_row("s1-nolabel", "tray", 53)
        del missing["labels"]["facts_ok"]
        devtree = create_row("s1-devtree", "spacer", 54)
        devtree["tree_sha256"] = dev_creates[0]["tree_sha256"]
        example = create_row("s1-example", "spacer", 55)
        example["code"] = EXAMPLE
        long = create_row("s1-long", "plate", 56, lines=400)
        wrong = create_row("s1-devrow", "plate", 57, split="dev")
        devedit = edit_row("e1-devb", "add", 58)
        devedit["b"]["tree_sha256"] = dev_edits[1]["b"]["tree_sha256"]
        dirty_source = edit_row("e1-dsrc", "size", 59)
        dirty_source["source"]["generator"]["dirty"] = True
        # an edit in the train file made from a dev part
        dev_source = edit_row("e1-devsrc", "add", 60)
        dev_source["source_tier"] = "t1"
        notree = create_row("s1-notree", "tray", 61)
        del notree["tree_sha256"]
        nosourcegen = edit_row("e1-nosgen", "remove", 62)
        del nosourcegen["source"]["generator"]
        creates += [dirty, nogen, failed, missing, devtree, example, long, wrong, notree]
        edits += [devedit, dirty_source, dev_source, nosourcegen]
        refused = {
            "made by a dirty generator": ["e1-dsrc", "s1-dirty"],
            "no generator provenance": ["e1-nosgen", "s1-nogen"],
            "a failed label": ["s1-failed"],
            "a label is missing": ["s1-nolabel"],
            "no tree hash": ["s1-notree"],
            "its tree is in dev": ["e1-devb", "s1-devtree"],
            "text from the site's examples": ["s1-example"],
            "over the token limit": ["s1-long"],
            "not a train row": ["e1-devsrc", "s1-devrow"],
        }
    files = {
        "train/create.jsonl": creates,
        "train/edit.jsonl": edits,
        "dev/create.jsonl": dev_creates,
        "dev/edit.jsonl": dev_edits,
    }
    lines = []
    for name, rows in files.items():
        write_jsonl(sets / name, rows)
        lines.append(f"{hashlib.sha256((sets / name).read_bytes()).hexdigest()}  {name}")
    # a test split folder with a file in it: nothing may open it
    write_jsonl(sets / "test" / "create.jsonl", [create_row("s3-secret", "plate", 1, split="test")])
    hashes = root / "sets.sha256"
    hashes.write_text("\n".join(lines) + "\n")
    examples = root / "examples"
    examples.mkdir()
    (examples / "example.scad").write_text(EXAMPLE)
    return {"sets": sets, "hashes": hashes, "examples": examples, "refused": refused}


class FakeTokenizer:
    """Renders a chat the way Qwen2.5's template does and makes one token per `every` characters (a character's code
    modulo `vocab`), so a prompt's tokens are always the start of the whole chat's tokens."""

    eos_token_id = 0

    def __init__(self, every: int = 4, vocab: int = 1000):
        self.every = every
        self.vocab = vocab

    def render(self, messages, add_generation_prompt=False) -> str:
        text = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
        return text + ("<|im_start|>assistant\n" if add_generation_prompt else "")

    def apply_chat_template(self, messages, tools=None, add_generation_prompt=False, return_dict=False, tokenize=True, **_):
        text = self.render(messages, add_generation_prompt)
        if not tokenize:
            return text
        return [1 + ord(c) % (self.vocab - 1) for c in text[:: self.every]]


def config(**rows) -> dict:
    """A build config for the hand-made set: 4 rows an update, 3 + 1 validation rows."""
    return {
        "name": "fake",
        "method": "test",
        "train": {"effective_batch": 4, "max_seq_length": 2048},
        "rows": {"salt": "s-test", "max_tokens": 1500, "create": {"*": 1}, "edit": {"add": 1, "size": 1, "remove": 1}, **rows},
        "valid": {"salt": "v-test", "create": 3, "edit": 1},
    }


def tiny_model(vocab: int = 97):
    """A random three-block Qwen2 model, small enough to train on the CPU in a test."""
    from mlx_lm.models import qwen2

    args = qwen2.ModelArgs(
        model_type="qwen2",
        hidden_size=32,
        num_hidden_layers=3,
        intermediate_size=48,
        num_attention_heads=4,
        rms_norm_eps=1e-6,
        vocab_size=vocab,
        num_key_value_heads=2,
    )
    return qwen2.Model(args)


def train_config() -> dict:
    """A training config for the tiny model: 2 rows a pass, 4 an update, a checkpoint and a validation every step."""
    return {
        "name": "tiny",
        "model": {"path": "tiny-model"},
        "lora": {"fine_tune_type": "lora", "num_layers": 2, "rank": 4, "scale": 2.0, "dropout": 0.1},
        "train": {
            "optimizer": "adam",
            "learning_rate": 1e-2,
            "warmup_fraction": 0.25,
            "warmup_init": 1e-3,
            "decay_to": 0.1,
            "effective_batch": 4,
            "batch_size": 2,
            "grad_checkpoint": False,
            "max_seq_length": 256,
            "mask_prompt": True,
            "epochs": 1,
            "seed": 0,
            "save_every": 1,
            "eval_every": 1,
        },
    }


def make_data(folder: Path, tokenizer, train_rows: int = 16, valid_rows: int = 5, batch_size: int = 2) -> Path:
    """A rows folder as build_rows.py writes one (train.jsonl, valid.jsonl, meta.json), without the set or gkod."""
    from train.build_rows import count_tokens, token_summary

    folder.mkdir(parents=True, exist_ok=True)
    meta = {"name": "tiny-rows", "batch_size": batch_size, "files": {}, "tokenizer": {"model": "fake"}}
    for name, n, start in (("train", train_rows, 0), ("valid", valid_rows, 1000)):
        rows, detail, tokens = [], [], {}
        for k in range(start, start + n):
            msgs = [
                {"role": "system", "content": "You write code."},
                {"role": "user", "content": f"Make part {k} " + "x" * (k % 9)},
                {"role": "assistant", "content": f"```openscad\ncube([{k % 50 + 5}, 4, 2]);\n```"},
            ]
            prompt, total = count_tokens(tokenizer, msgs)
            rid = f"r{k}"
            rows.append({"messages": msgs})
            detail.append([rid, "create:part", prompt, total - prompt])
            tokens[rid] = (prompt, total)
        text = "".join(json.dumps(r) + "\n" for r in rows)
        (folder / f"{name}.jsonl").write_text(text)
        meta["files"][f"{name}.jsonl"] = hashlib.sha256(text.encode()).hexdigest()
        meta[name] = {"rows": n, "rows_detail": detail, "tokens": token_summary([d[0] for d in detail], tokens, batch_size, 256)}
    (folder / "meta.json").write_text(json.dumps(meta, indent=2))
    return folder
