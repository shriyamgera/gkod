# @gkod/datagen

The training data generator. It builds parts by program, writes a request for each one, and labels each part with the site's own compiler and print checks.

Needs Node 22.18 or later (it runs the TypeScript sources directly) and the OpenSCAD web build (`npm run fetch:openscad`).

## No model-written data

No row is written by a language model: not the part, not its code, not its request.

- **Parts** are feature trees picked by our own seeded random number generator from size ranges in [src/families](src/families).
- **Code** is written by a serializer from small shape pieces of our own (cube, cylinder, square, circle, polygon, offset, linear_extrude, hull, union, difference, translate, rotate, mirror, for). No part is stored as a text template.
- **Requests** are put together from short word lists and phrase pieces ([src/words.ts](src/words.ts), [src/phrases.ts](src/phrases.ts)) filled with the tree's own numbers. No whole sentence is written by hand.

**Provenance.** Every row carries the generator's name, version and git commit, a `dirty` flag (set when the repo had uncommitted changes), the run seed, the part's own seed, its family and its full feature tree. `manifest.json` adds the sha256 of the OpenSCAD build and of every output file. Anyone with the repo can rebuild a row from its commit and seed.

## Command

```sh
node datagen/bin/gkod-datagen.mjs --count 1000 --seed 1 --out data/parts/<name> [--workers 8]
```

`--count` is the number of parts written. A tree that breaks a rule is skipped, logged in `skipped.jsonl`, and the next index is tried. The output folder must be inside `data/`, which git ignores. A folder that already holds a run is refused. Commit first, or the run is marked dirty.

## How a part is made

1. **Feature tree.** A family picks a base body and features: through and countersunk holes (centre, pair, row, corner or grid patterns), slots, a pocket, ribs, standoffs, a rim, a notch, mounting tabs, dividers, gussets, a flange, inward lips, grip notches, a flat on a shaft hole, rounded or chamfered corners.
2. **Rules.** The tree is checked before any code exists: walls at least 1.6 mm; holes 2 to 12 mm (10 mm through a wall that stands up while printing); holes and slots inside the body with a 1.6 mm wall around them and clear of rounded or chamfered corners; cuts kept apart from each other and from ribs, standoffs, rims and gussets, with room for a screw head beside them; the whole part inside a 200 mm cube. Every problem is a plain sentence.
3. **Slider ranges.** Each named size moves out from its value one step at a time, up to about 30% either way (2 for counts), while the whole part still passes every rule. So any one slider can sit anywhere in its range and the part stays valid.
4. **Code** in the site's format: a title line, every size as a named number with a caption line above it and a slider range, then `/* [Hidden] */` with `$fn` and worked-out values, then modules and the call. No `minkowski()`, `text()` or imports.
5. **Request and facts.** Nouns and synonyms, size phrases ("80 mm wide", "80x50mm", "80 by 50 mm"), feature phrases and a few sentence orders. Some sizes are left out on purpose. Each request lists the **facts** it states, so a made part can be checked against them later.
6. **Labels.** Compiled with the gkod command's compiler (the site's OpenSCAD build, `--hardwarnings`, the banned-call guard, a 10 second limit) in worker threads, then checked with [the print checks](../checks/README.md) for the Anycubic Kobra 2 Neo bed (220 x 220 x 250 mm) and the 45 degree overhang rule.

## Families

| Family | Body | Features it can have |
|---|---|---|
| plate | flat plate, sharp, rounded or chamfered corners | holes, countersinks, a slot, a pocket, ribs, standoffs, a low rim or a notch |
| bracket | L bracket | holes in the base and the upright, slots in the base, one or two gussets below the holes |
| channel | U channel or cable tray | holes or slots in the floor, inward lips |
| tray | open box | dividers, floor holes, two mounting tabs |
| spacer | round or hex spacer, sized around its screw | a flange with or without screw holes |
| hook | wall hook, printed on its side | one or two screw holes, countersunk or not |
| knob | knob, printed face down, sized around its shaft | grip notches, a flat on the shaft hole |
| clip | cable or pipe clip, printed on its side | two screw holes through the pad |

## Files

| File | Holds |
|---|---|
| `parts.jsonl` | One part per line, in index order. |
| `skipped.jsonl` | Each skipped index, its family and every reason. |
| `manifest.json` | Generator, seed, counts by family, skip reasons, pass rates, settings, the OpenSCAD build's sha256, and the rows, bytes and sha256 of `parts.jsonl` and `skipped.jsonl`. |
| `timings.jsonl` | Compile and check time per part, kept apart because times change from run to run. |

## A row

A real row (part 13 of the seed 1 run below), with the line breaks moved for reading:

```json
{
  "id": "s1-000013",
  "index": 13,
  "generator": {"name": "gkod-datagen", "version": "0.1.0", "commit": "1c383ee10afbc2f8149024381b0be99d5382587c", "dirty": false},
  "seed": 1,
  "part_seed": 3417133882,
  "family": "knob",
  "tree": {"family": "knob", "body": {"kind": "knob", "diameter": 31, "height": 13.5, "shaft": 4, "shaftDepth": 11.5, "chamfer": 1}, "features": [{"kind": "flat", "depth": 0.5}]},
  "title": "Control knob",
  "request": "Print a control knob, 31mm in diameter and 13.5mm high, with a 4mm D-shaped shaft hole 11.5mm deep",
  "facts": [
    {"key": "diameter", "value": 31, "unit": "mm", "axis": "xy"},
    {"key": "height", "value": 13.5, "unit": "mm", "axis": "z"},
    {"key": "shaft_d", "value": 4, "unit": "mm"},
    {"key": "shaft_flat", "value": 1, "unit": "flag"},
    {"key": "shaft_depth", "value": 11.5, "unit": "mm"}
  ],
  "code": "// Control knob\n\n// Knob diameter (mm)\ndiameter = 31; // [22:1:40]\n// Knob height (mm)\nheight = 13.5; // [13.5:0.5:17.5]\n// Shaft hole diameter (mm)\nshaft_d = 4; // [3:0.5:5]\n// Shaft hole depth (mm)\nshaft_depth = 11.5; // [8.5:0.5:11.5]\n// Edge chamfer (mm)\nchamfer = 1; // [0.5:0.5:2]\n// Flat on the shaft hole, depth (mm)\nflat_depth = 0.5; // [0.5:0.5:1]\n\n/* [Hidden] */\n$fn = 48;\n\nmodule knob() {\n  hull() {\n    cylinder(d = diameter, h = height - chamfer);\n    cylinder(d = diameter - 2 * chamfer, h = height);\n  }\n}\n\nmodule shaft() {\n  translate([0, 0, height - shaft_depth]) difference() {\n    cylinder(d = shaft_d, h = shaft_depth + 1);\n    translate([shaft_d / 2 - flat_depth, -shaft_d / 2, -1]) cube([shaft_d, shaft_d, shaft_depth + 3]);\n  }\n}\n\ndifference() {\n  knob();\n  shaft();\n}\n",
  "labels": {
    "compile": {"ok": true, "error": null, "triangles": 440},
    "mesh": {"size": [31, 31, 13.5], "min": [-15.5, -15.5, 0], "volume": 9979.01},
    "checks": {"ok": true, "results": [
      {"id": "closed", "ok": true},
      {"id": "fits-bed", "ok": true},
      {"id": "flat-base", "ok": true},
      {"id": "overhang", "ok": true}
    ]},
    "params_ok": true,
    "facts_ok": true,
    "stl_sha256": "f5ccb3c5c69d5dfd257ef36de702f96933384883301fd90b10cf19d951aade18"
  }
}
```

- `labels.compile`: `ok`, `error`, `triangles`. `labels.mesh`: bounding box `size` and `min` (mm) and `volume` (mm³).
- `labels.checks`: `ok`, and each check's `id` and `ok`, with the plain sentence when it fails.
- `labels.params_ok`: the compiler's own list of sizes, read with the site's rules, is exactly the size block the generator wrote.
- `labels.facts_ok`: every fact that names an axis matches the mesh within 0.05 mm.
- A fact is `{key, value, unit}` with `unit` `mm`, `count` or `flag`. The key is the size's name in the code when there is one (`width`, `hole_d`, `base_hole_spacing`), or a count or flag such as `hole_count`, `compartment_count` or `shaft_flat`. `axis` (`x`, `y`, `z` or `xy`) is set only when the number is the part's real overall size along that axis.

## Same seed, same file

The random number generator is our own (mulberry32). Part `i` gets its own seed from the run seed and `i`, so part 537 is the same in a run of 1,000 or 2,000, and the tree and the request use separate generators. Numbers are written in one fixed format. Compiles run in parallel, but rows are written strictly in index order, and where a run stops never depends on the number of workers. The same seed and generator commit give a byte-identical `parts.jsonl`. Every row holds the commit, so the file's hash changes with each commit.

## Measured

Seed 1, `--count 1000`, commit `1c383ee` with a clean tree, 8 workers on an M4 Mac (10 cores), run twice:

| | |
|---|---|
| Parts | 1,000 (7 indices skipped: holes, ribs and notches too close together 5, a screw head against a rim 2) |
| Compiled | 100% |
| Passed all print checks | 100% (solid 100%, fits the bed 100%, flat base 100%, overhang 100%) |
| Size block matches the compiler (`params_ok`) | 100% |
| Stated overall sizes match the mesh (`facts_ok`) | 100% |
| By family | plate 110, bracket 121, channel 124, tray 133, spacer 127, hook 126, knob 124, clip 135 |
| Features per part | none 318, one 482, two 180, three 20 |
| Triangles | 12 to 3,128 (median 476) |
| Size | x 7 to 198, y 6.5 to 160, z 2 to 100 mm |
| Code | 19 to 77 lines (median 42) |
| Requests | 17 to 228 characters, 3 to 50 words (median 21); all 1,000 different; 112 different two-word openings, the most common ("I need") in 9.4% |
| Facts per request | 2 to 12 (median 5) |
| Time | 25.3 s and 28.5 s for the whole run; compile 58 ms per part (median), check 0.3 ms |
| `parts.jsonl` sha256 | `212bbc2a2e34a344e40d04725e3ee4820e649d346cb2ca8c7675c048d7a55b67`, both runs and a third with 3 workers |

What these numbers do not show: every part passes because the rules are strict and the shapes are simple (boxes and cylinders, no angled or curved features beyond hull and offset). Some features are rare (in 1,000 parts: 5 pockets, 9 rib sets, 9 standoff sets, 11 notches, 12 rims), and a third of the parts have no features at all.

## Tests

`npm test` covers the random number generator, the expression and code printer, the rules, the slider ranges, each family's valid-tree rate, the size block format (read the way the customizer reads it), one part per family through the real compiler at its default sizes and at both ends of every slider, the request facts against the tree, the wording rules, and the byte-identical end-to-end run with different worker counts.
