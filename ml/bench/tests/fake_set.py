"""A tiny hand-made set folder with the frozen-set layout, and engines that answer from a script, for the runner tests.
The parts are plain plates with holes, written here by hand for the tests only."""

import hashlib
import json
from pathlib import Path

from gkod_bench.engines.base import Answer


def plate(width=60, depth=30, holes=2):
    xs = ", ".join(str(15 + 10 * i) for i in range(holes))
    return f"""// Plate
// Plate width (mm)
width = {width}; // [40:1:90]
// Plate depth (mm)
depth = {depth}; // [20:1:40]
// Plate thickness (mm)
thickness = 4; // [2:0.5:6]

/* [Hidden] */
$fn = 24;

difference() {{
  cube([width, depth, thickness]);
  for (x = [{xs}]) translate([x, depth / 2, -1]) cylinder(d = 4, h = thickness + 2);
}}
"""


def facts(width, depth, holes):
    return [
        {"key": "width", "value": width, "unit": "mm", "axis": "x"},
        {"key": "depth", "value": depth, "unit": "mm", "axis": "y"},
        {"key": "hole_count", "value": holes, "unit": "count"},
    ]


def create_row(id, split, tier, width, depth=30, holes=2, family="plate"):
    return {
        "id": id,
        "split": split,
        "tier": tier,
        "held_out_pair": None,
        "family": family,
        "request": f"A plate {width} mm wide and {depth} mm deep with {holes} holes",
        "facts": facts(width, depth, holes),
        "code": plate(width, depth, holes),
        "labels": {"stl_sha256": None},
        "tree": {"features": [{}]},
    }


def edit_row(id, split, width_a, width_b):
    return {
        "id": id,
        "split": split,
        "tier": "edit",
        "source_tier": "t1",
        "family": "plate",
        "op": {"kind": "size"},
        "instruction": f"make it {width_b} mm wide",
        "a": {"code": plate(width_a)},
        "b": {"code": plate(width_b)},
        "facts": {
            "stated": [{"key": "width", "value": width_b, "unit": "mm", "axis": "x"}],
            "changed": [{"name": "width", "from": width_a, "to": width_b}],
            "kept": [{"name": "depth", "value": 30}, {"name": "thickness", "value": 4}],
            "removed": [],
            "added": [],
        },
        "labels": {"stl_sha256": None},
    }


def make_set(root: Path) -> Path:
    """dev: 3 parts and 1 edit; train: the rows the few-shot rule picks from. Returns the hash list."""
    files = {
        "dev/create.jsonl": [
            create_row("d-1", "dev", "t1", 60),
            create_row("d-2", "dev", "t2", 70, holes=3),
            create_row("d-3", "dev", "t3", 50, family="coaster"),
        ],
        "dev/edit.jsonl": [edit_row("de-1", "dev", 60, 66)],
        "train/create.jsonl": [create_row(f"tr-{f}", "train", "train", 55, family=f) for f in ("spacer", "plate", "bracket")],
        "train/edit.jsonl": [{**edit_row(f"tre-{k}", "train", 60, 64), "op": {"kind": k}} for k in ("size", "add", "remove")],
    }
    lines = []
    for name, rows in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}")
    hashes = root / "hashes.sha256"
    hashes.write_text("\n".join(lines) + "\n")
    return hashes


class ScriptedEngine:
    """Answers each prompt with the reference code, or with whatever `script` says for that request's text."""

    kind = "scripted"
    with_tools = False

    def __init__(self, script=None, settings=None):
        self.script = script or (lambda messages: None)
        self.calls = []
        self._settings = settings or {"engine": "scripted", "temperature": 0}

    def settings(self):
        return dict(self._settings)

    def answer(self, messages):
        self.calls.append(messages)
        text = self.script(messages)
        if text is Answer:
            return Answer(text=None, seconds=0.01, error="no answer (scripted)")
        return Answer(text=text, seconds=0.01, meta={"generation_tokens": 10})

    def close(self):
        pass


def echo_reference(messages):
    """The right answer for the fake set: the plate the request or the instruction asks for."""
    import re

    user = messages.user
    if user.startswith("Make this part:"):
        width, depth, holes = map(int, re.findall(r"A plate (\d+) mm wide and (\d+) mm deep with (\d+) holes", user)[0])
        return f"```openscad\n{plate(width, depth, holes)}```"
    width = int(re.findall(r"make it (\d+) mm wide", user)[0])
    return f"```openscad\n{plate(width)}```"
