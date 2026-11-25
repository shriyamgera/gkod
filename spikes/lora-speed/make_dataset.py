#!/usr/bin/env python3
"""Program-made training examples: plain-English request -> OpenSCAD code.

Every example comes from a part template plus random sizes. The request wording
comes from phrase templates in this file. No language model writes any of it.

Usage:
    python make_dataset.py --out data --train 600 --valid 60 --test 5 --seed 7
"""
import argparse
import json
import random
from pathlib import Path

SYSTEM = (
    "You write OpenSCAD code for 3D-printable parts. "
    "Use named variables for every size, in millimetres. Reply with code only."
)

UNITS = ["mm", " mm", " millimetres"]


def fmt(v):
    """Format a number the way a person would type it: 40 not 40.0."""
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def pick(rng, lo, hi, step=1.0):
    n = int(round((hi - lo) / step))
    return round(lo + step * rng.randint(0, n), 2)


# ---------------------------------------------------------------- templates
# Each template returns (params, sentence_parts, code).
#   params: ordered dict of name -> value
#   noun phrases and size phrases are built later from the wording tables.

def plate(rng):
    t = pick(rng, 2, 6, 0.5)
    d = rng.choice([3, 3.2, 3.5, 4, 4.5, 5, 5.5, 6])
    margin = pick(rng, d / 2 + 2, d / 2 + 6, 0.5)
    length = pick(rng, 4 * margin + 10, 140, 1)
    width = pick(rng, 4 * margin + 4, max(4 * margin + 4, min(length, 90)), 1)
    p = dict(plate_length=length, plate_width=width, plate_thickness=t,
             hole_diameter=d, hole_margin=margin)
    code = f"""// Mounting plate with four corner holes
plate_length = {fmt(length)};
plate_width = {fmt(width)};
plate_thickness = {fmt(t)};
hole_diameter = {fmt(d)};
hole_margin = {fmt(margin)};

$fn = 48;

difference() {{
    cube([plate_length, plate_width, plate_thickness]);
    for (x = [hole_margin, plate_length - hole_margin])
        for (y = [hole_margin, plate_width - hole_margin])
            translate([x, y, -1])
                cylinder(d = hole_diameter, h = plate_thickness + 2);
}}
"""
    return p, code


def l_bracket(rng):
    t = pick(rng, 2.5, 6, 0.5)
    d = rng.choice([3, 3.5, 4, 4.5, 5, 6])
    width = pick(rng, d + 8, 50, 1)
    a = pick(rng, t + d + 12, 90, 1)
    b = pick(rng, t + d + 12, 90, 1)
    p = dict(base_length=a, upright_height=b, bracket_width=width,
             thickness=t, hole_diameter=d)
    code = f"""// L-bracket with one screw hole in each leg
base_length = {fmt(a)};
upright_height = {fmt(b)};
bracket_width = {fmt(width)};
thickness = {fmt(t)};
hole_diameter = {fmt(d)};

$fn = 48;

difference() {{
    union() {{
        cube([base_length, bracket_width, thickness]);
        cube([thickness, bracket_width, upright_height]);
    }}
    // hole in the base leg
    translate([(base_length + thickness) / 2, bracket_width / 2, -1])
        cylinder(d = hole_diameter, h = thickness + 2);
    // hole in the upright leg
    translate([-1, bracket_width / 2, (upright_height + thickness) / 2])
        rotate([0, 90, 0])
            cylinder(d = hole_diameter, h = thickness + 2);
}}
"""
    return p, code


def hook(rng):
    t = pick(rng, 3, 6, 0.5)
    width = pick(rng, 12, 40, 1)
    d = rng.choice([3, 3.5, 4, 4.5, 5])
    reach = pick(rng, 10, 45, 1)
    lip = pick(rng, 5, 25, 1)
    height = pick(rng, lip + d + 20, 110, 1)
    p = dict(back_height=height, hook_width=width, thickness=t,
             hook_reach=reach, lip_height=lip, screw_diameter=d)
    code = f"""// Wall hook: back plate, arm and upturned lip
back_height = {fmt(height)};
hook_width = {fmt(width)};
thickness = {fmt(t)};
hook_reach = {fmt(reach)};
lip_height = {fmt(lip)};
screw_diameter = {fmt(d)};

$fn = 48;

difference() {{
    union() {{
        // back plate
        cube([thickness, hook_width, back_height]);
        // arm
        cube([thickness + hook_reach + thickness, hook_width, thickness]);
        // lip
        translate([thickness + hook_reach, 0, 0])
            cube([thickness, hook_width, thickness + lip_height]);
    }}
    // screw hole near the top of the back plate
    translate([-1, hook_width / 2, back_height - screw_diameter - 4])
        rotate([0, 90, 0])
            cylinder(d = screw_diameter, h = thickness + 2);
}}
"""
    return p, code


def phone_stand(rng):
    t = pick(rng, 3, 5, 0.5)
    width = pick(rng, 55, 95, 1)
    depth = pick(rng, 60, 110, 1)
    back = pick(rng, 70, 130, 1)
    angle = pick(rng, 10, 30, 1)
    lip = pick(rng, 8, 18, 1)
    slot = pick(rng, 9, 15, 0.5)
    p = dict(stand_width=width, base_depth=depth, back_height=back,
             lean_angle=angle, thickness=t, lip_height=lip, slot_depth=slot)
    code = f"""// Phone stand: flat base, leaning back rest and a front lip
stand_width = {fmt(width)};
base_depth = {fmt(depth)};
back_height = {fmt(back)};
lean_angle = {fmt(angle)};
thickness = {fmt(t)};
lip_height = {fmt(lip)};
slot_depth = {fmt(slot)};

union() {{
    // base
    cube([stand_width, base_depth, thickness]);
    // front lip that stops the phone sliding off
    cube([stand_width, thickness, thickness + lip_height]);
    // back rest, leaning away from the lip
    translate([0, thickness + slot_depth, 0])
        rotate([-lean_angle, 0, 0])
            cube([stand_width, thickness, back_height]);
}}
"""
    return p, code


def cable_clip(rng):
    cable = pick(rng, 3, 14, 0.5)
    wall = pick(rng, 1.6, 3.2, 0.2)
    width = pick(rng, 6, 16, 1)
    gap = round(max(1.5, cable * rng.choice([0.6, 0.7, 0.8])), 1)
    d = rng.choice([3, 3.5, 4])
    tab = pick(rng, d + 8, d + 16, 1)
    p = dict(cable_diameter=cable, wall=wall, clip_width=width,
             opening=gap, tab_length=tab, screw_diameter=d)
    code = f"""// Cable clip: open ring on a screw tab
cable_diameter = {fmt(cable)};
wall = {fmt(wall)};
clip_width = {fmt(width)};
opening = {fmt(gap)};
tab_length = {fmt(tab)};
screw_diameter = {fmt(d)};

$fn = 64;
outer_diameter = cable_diameter + 2 * wall;

difference() {{
    union() {{
        // ring
        translate([0, 0, outer_diameter / 2])
            rotate([-90, 0, 0])
                cylinder(d = outer_diameter, h = clip_width);
        // screw tab
        cube([outer_diameter / 2 + tab_length, clip_width, wall]);
    }}
    // cable bore
    translate([0, -1, outer_diameter / 2])
        rotate([-90, 0, 0])
            cylinder(d = cable_diameter, h = clip_width + 2);
    // opening to push the cable in
    translate([-outer_diameter, -1, outer_diameter / 2 - opening / 2])
        cube([outer_diameter, clip_width + 2, opening]);
    // screw hole in the tab
    translate([outer_diameter / 2 + tab_length / 2, clip_width / 2, -1])
        cylinder(d = screw_diameter, h = wall + 2);
}}
"""
    return p, code


def spacer(rng):
    inner = rng.choice([2.2, 2.7, 3.2, 3.4, 4.3, 5.3, 6.4, 8.4])
    outer = pick(rng, inner + 3, inner + 12, 0.5)
    height = pick(rng, 2, 40, 0.5)
    flange = pick(rng, outer + 4, outer + 14, 1)
    ft = pick(rng, 1.2, 3, 0.2)
    p = dict(outer_diameter=outer, inner_diameter=inner, spacer_height=height,
             flange_diameter=flange, flange_thickness=ft)
    code = f"""// Round spacer with a flange at the bottom
outer_diameter = {fmt(outer)};
inner_diameter = {fmt(inner)};
spacer_height = {fmt(height)};
flange_diameter = {fmt(flange)};
flange_thickness = {fmt(ft)};

$fn = 64;

difference() {{
    union() {{
        cylinder(d = flange_diameter, h = flange_thickness);
        cylinder(d = outer_diameter, h = flange_thickness + spacer_height);
    }}
    translate([0, 0, -1])
        cylinder(d = inner_diameter, h = flange_thickness + spacer_height + 2);
}}
"""
    return p, code


def tray(rng):
    wall = pick(rng, 1.2, 3, 0.2)
    floor = pick(rng, 1, 3, 0.2)
    il = pick(rng, 30, 150, 1)
    iw = pick(rng, 20, min(il, 100), 1)
    ih = pick(rng, 8, 60, 1)
    r = pick(rng, 2, 8, 0.5)
    p = dict(inner_length=il, inner_width=iw, inner_height=ih,
             wall=wall, floor=floor, corner_radius=r)
    code = f"""// Open-top box with rounded corners
inner_length = {fmt(il)};
inner_width = {fmt(iw)};
inner_height = {fmt(ih)};
wall = {fmt(wall)};
floor = {fmt(floor)};
corner_radius = {fmt(r)};

$fn = 48;

module rounded_block(length, width, height, radius) {{
    hull() {{
        for (x = [radius, length - radius])
            for (y = [radius, width - radius])
                translate([x, y, 0])
                    cylinder(r = radius, h = height);
    }}
}}

difference() {{
    rounded_block(inner_length + 2 * wall, inner_width + 2 * wall,
                  inner_height + floor, corner_radius + wall);
    translate([wall, wall, floor])
        rounded_block(inner_length, inner_width, inner_height + 1, corner_radius);
}}
"""
    return p, code


# ------------------------------------------------------------------ wording
# name -> list of ways to say the size. "{v}" is the number with its unit.
SIZE_WORDS = {
    "plate": {
        "nouns": ["mounting plate", "flat plate", "base plate", "rectangular plate with four corner holes"],
        "plate_length": ["{v} long", "length {v}", "{v} in length"],
        "plate_width": ["{v} wide", "width {v}", "{v} across"],
        "plate_thickness": ["{v} thick", "thickness {v}"],
        "hole_diameter": ["four {v} holes in the corners", "a {v} hole in each corner", "corner holes of {v} diameter"],
        "hole_margin": ["holes {v} in from the edges", "hole centres {v} from each edge", "a {v} margin to the hole centres"],
    },
    "l_bracket": {
        "nouns": ["L-bracket", "L bracket", "right-angle bracket", "corner bracket", "angle bracket"],
        "base_length": ["base leg {v} long", "a {v} base leg", "bottom leg of {v}"],
        "upright_height": ["upright leg {v} tall", "a {v} upright", "vertical leg of {v}"],
        "bracket_width": ["{v} wide", "width {v}"],
        "thickness": ["{v} thick", "material thickness {v}", "thickness {v}"],
        "hole_diameter": ["one {v} screw hole in each leg", "a {v} hole in both legs", "{v} mounting holes, one per leg"],
    },
    "hook": {
        "nouns": ["wall hook", "coat hook", "screw-on hook", "hook for the wall", "key hook"],
        "back_height": ["back plate {v} tall", "a {v} high back plate", "back height {v}"],
        "hook_width": ["{v} wide", "width {v}"],
        "thickness": ["{v} thick", "thickness {v}"],
        "hook_reach": ["sticking out {v}", "a reach of {v}", "{v} of reach"],
        "lip_height": ["a {v} lip", "lip {v} high", "an upturned lip of {v}"],
        "screw_diameter": ["a {v} screw hole", "one {v} hole for a screw", "screw hole diameter {v}"],
    },
    "phone_stand": {
        "nouns": ["phone stand", "desk stand for a phone", "phone holder", "phone dock", "stand for my phone"],
        "stand_width": ["{v} wide", "width {v}"],
        "base_depth": ["base {v} deep", "a {v} deep base", "base depth {v}"],
        "back_height": ["back rest {v} tall", "a {v} back rest", "back height {v}"],
        "lean_angle": ["leaning back {d} degrees", "a {d} degree lean", "tilted {d} degrees"],
        "thickness": ["{v} thick", "walls {v} thick", "thickness {v}"],
        "lip_height": ["a {v} front lip", "front lip {v} high", "lip height {v}"],
        "slot_depth": ["a {v} slot for the phone", "{v} between lip and back rest", "phone slot {v} deep"],
    },
    "cable_clip": {
        "nouns": ["cable clip", "cable holder", "screw-down cable clip", "clip for a cable", "wire clip"],
        "cable_diameter": ["for a {v} cable", "cable diameter {v}", "to hold a {v} cable"],
        "wall": ["{v} walls", "wall thickness {v}", "walls {v} thick"],
        "clip_width": ["{v} wide", "width {v}"],
        "opening": ["a {v} opening", "opening of {v} to push the cable in", "{v} entry gap"],
        "tab_length": ["a {v} screw tab", "tab {v} long", "tab length {v}"],
        "screw_diameter": ["a {v} screw hole", "screw hole of {v}", "one {v} hole in the tab"],
    },
    "spacer": {
        "nouns": ["spacer", "round spacer", "standoff", "flanged spacer", "bushing"],
        "outer_diameter": ["{v} outer diameter", "outside diameter {v}", "OD {v}"],
        "inner_diameter": ["{v} bore", "inner diameter {v}", "a {v} through hole"],
        "spacer_height": ["{v} tall", "body height {v}", "{v} high above the flange"],
        "flange_diameter": ["a {v} flange", "flange diameter {v}", "flange {v} across"],
        "flange_thickness": ["flange {v} thick", "flange thickness {v}", "a {v} thick flange"],
    },
    "tray": {
        "nouns": ["open box", "tray", "storage box without a lid", "open-top box", "small parts bin"],
        "inner_length": ["inside length {v}", "{v} long inside", "inner length {v}"],
        "inner_width": ["inside width {v}", "{v} wide inside", "inner width {v}"],
        "inner_height": ["inside height {v}", "{v} deep", "inner height {v}"],
        "wall": ["{v} walls", "wall thickness {v}", "walls {v} thick"],
        "floor": ["a {v} floor", "floor thickness {v}", "bottom {v} thick"],
        "corner_radius": ["{v} rounded inside corners", "inner corner radius {v}", "corners rounded to {v}"],
    },
}

OPENERS = [
    "Make {a} {noun}: {sizes}.",
    "I need {a} {noun}, {sizes}.",
    "Design {a} {noun} with these sizes: {sizes}.",
    "Can you make me {a} {noun}? {Sizes}.",
    "{Noun}, {sizes}.",
    "Please write OpenSCAD for {a} {noun}. {Sizes}.",
    "I want to print {a} {noun}. {Sizes}.",
    "Create {a} {noun} ({sizes}).",
    "{a_cap} {noun} please: {sizes}.",
    "Need {a} {noun} for my printer. Sizes: {sizes}.",
]

TEMPLATES = {
    "plate": plate, "l_bracket": l_bracket, "hook": hook,
    "phone_stand": phone_stand, "cable_clip": cable_clip,
    "spacer": spacer, "tray": tray,
}


def article(noun):
    return "an" if noun[0].lower() in "aeiou" or noun.startswith("L") else "a"


def request_text(rng, kind, params):
    words = SIZE_WORDS[kind]
    noun = rng.choice(words["nouns"])
    unit = rng.choice(UNITS)
    names = list(params)
    if rng.random() < 0.6:
        rng.shuffle(names)
    parts = []
    for name in names:
        phrase = rng.choice(words[name])
        parts.append(phrase.format(v=fmt(params[name]) + unit, d=fmt(params[name])))
    joiner = rng.choice([", ", ", ", "; ", " and "])
    if joiner == " and " and len(parts) > 2:
        sizes = ", ".join(parts[:-1]) + " and " + parts[-1]
    else:
        sizes = joiner.join(parts)
    a = article(noun)
    text = rng.choice(OPENERS).format(
        a=a, a_cap=a.capitalize(), noun=noun, Noun=noun[0].upper() + noun[1:],
        sizes=sizes, Sizes=sizes[0].upper() + sizes[1:])
    if rng.random() < 0.15:
        text = text.lower()
    return text


def make_example(rng, kind=None):
    kind = kind or rng.choice(list(TEMPLATES))
    params, code = TEMPLATES[kind](rng)
    return {
        "kind": kind,
        "params": params,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": request_text(rng, kind, params)},
            {"role": "assistant", "content": code},
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data")
    ap.add_argument("--train", type=int, default=600)
    ap.add_argument("--valid", type=int, default=60)
    ap.add_argument("--test", type=int, default=5)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seen = set()
    kinds = list(TEMPLATES)

    def batch(n, spread=False):
        rows = []
        while len(rows) < n:
            kind = kinds[len(rows) % len(kinds)] if spread else None
            ex = make_example(rng, kind)
            key = (ex["kind"], tuple(ex["params"].values()))
            if key in seen:          # no part appears in two splits or twice
                continue
            seen.add(key)
            rows.append(ex)
        return rows

    splits = {"train": batch(args.train), "valid": batch(args.valid),
              "test": batch(args.test, spread=True)}
    for name, rows in splits.items():
        with open(out / f"{name}.jsonl", "w") as f:
            for ex in rows:
                f.write(json.dumps({"messages": ex["messages"]}) + "\n")
        with open(out / f"{name}.meta.jsonl", "w") as f:
            for ex in rows:
                f.write(json.dumps({"kind": ex["kind"], "params": ex["params"]}) + "\n")
        print(name, len(rows))


if __name__ == "__main__":
    main()
