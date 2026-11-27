# @gkod/datagen

The training data generator. It builds parts by program, writes a request for each one, and labels each part with the site's own compiler and print checks.

Needs Node 22.18 or later (it runs the TypeScript sources directly) and the OpenSCAD web build (`npm run fetch:openscad`).

## No model-written data

No row is written by a language model: not the part, not its code, not its request.

- **Parts** are feature trees picked by our own seeded random number generator from size ranges in [src/families](src/families).
- **Code** is written by a serializer from small shape pieces of our own (cube, cylinder, square, circle, polygon, offset, linear_extrude, hull, union, difference, translate, rotate, mirror, for). No part is stored as a text template.
- **Requests** are put together from short word lists and phrase pieces ([src/words.ts](src/words.ts), [src/phrases.ts](src/phrases.ts)) filled with the tree's own numbers. No whole sentence is written by hand.

**Provenance.** Every row carries the generator's name, version and git commit, a `dirty` flag (set when the repo had uncommitted changes), the run seed, the part's own seed, its family, its full feature tree and the tree's sha256. `manifest.json` adds the sha256 of the OpenSCAD build and of every output file. Anyone with the repo can rebuild a row from its commit and seed.

## Command

```sh
node datagen/bin/gkod-datagen.mjs --count 1000 --seed 1 --out data/parts/<name> [--workers 8]
```

`--count` is the number of parts written. A tree that breaks a rule, or that is the same as a part made earlier in the run, is skipped, logged in `skipped.jsonl`, and the next index is tried. So every row is a different part. The output folder must be inside `data/`, which git ignores. A folder that already holds a run is refused. Commit first, or the run is marked dirty.

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
| bracket | L bracket | holes in the base and the upright, slots in the base, one or two gussets below the holes; always at least one hole or slot |
| channel | U channel or cable tray | holes or slots in the floor, inward lips |
| tray | open box | dividers, floor holes, two mounting tabs |
| spacer | round or hex spacer, sized around its screw | a flange with or without screw holes |
| hook | wall hook, one outline with a cut front corner and a rounded inside corner, printed on its side; its reach is the full depth from the wall | one or two screw holes, countersunk or not; always at least one |
| knob | knob, printed face down, sized around its shaft | grip notches, a flat on the shaft hole |
| clip | cable or pipe clip: a column with a round top on a flat base, printed on its side | two screw holes through the base |
| washer | thin round spacer, 1 to 2.5 mm thick, around an M3 to M10 clearance hole | a slot from the hole to the edge, so it slides on from the side |
| shelf | wide L bracket: the base is the shelf, the upright the back | two or three screw holes across the back, clear of the gussets; a gusset at each end |
| tool_holder | wide L bracket: the base is a shelf for tools | a row of 3 to 8 tool holes of 6 to 12 mm in the shelf, two screw holes in the back, a gusset at each end |
| slot_plate | flat plate, sharp, rounded or chamfered corners | two slots, one near each end, front to back or side to side; a hole in the middle |
| divider | thin plate, 2 to 3 mm | a finger notch in the top edge, or a narrow slot halfway down so two dividers cross |
| coaster | disc, or a square plate with rounded or chamfered corners | a low rim (always on a round one) |
| enclosure | open box | four standoffs on the floor for a circuit board, two mounting tabs |
| foot | round foot, wide end down, narrowing to its top, no taller than three quarters of its base | a screw hole down the middle, countersunk where it fits |
| grommet | tube sized to the desk hole it fits | a flange, sometimes with three or four screw holes |
| cup | round, hexagonal or octagonal cup; the wall is measured across a flat | holes in the bottom |
| comb | plate with 3 to 10 round-ended cable slots in its front edge | screw holes in the strip behind the slots |
| saddle | pipe strap with a foot on each side, printed on its side | a screw hole through each foot, countersunk or not |
| handle | drawer pull: a bar on two posts at a usual hole spacing (64 to 160 mm), printed on its side, with screw holes into the posts from behind | finger grooves under the bar |
| corner_plate | flat L with two equal arms and a rounded inside corner | the same holes in each arm |
| bit_holder | block sized to its sockets | two to four rows of hex sockets for 6.35 mm bits |
| battery_holder | block sized to its sockets | two to four rows of round sockets for AAA, AA, 18650 or C cells |

Each family is a preset over the shared bodies and features, with its own size ranges and chances, in [src/families](src/families). The order of the list decides which family a seed picks, so new families go at the end. None has moving parts, threads or text. The newer families brought new bodies (disc, saddle, handle, foot, sleeve, cup, comb and corner) and new features (a washer's side slot as wide as its hole, finger grooves, sockets, and standoffs on a box floor); a fixed tree of each is compiled and checked in the tests.

Each new family was made alone, 200 parts with seed 7 through the same steps as a run, and every part compiled, passed every print check and had a matching size block and matching stated sizes; three of each were drawn with the overhangs marked and read beside their requests. Then the command made mixed runs at commit `929f887` with a clean tree, seed 7: 5,000 parts, all passing every label, and 6,000 parts (205 to 293 for each new family), all passing except 20 that hit the 10 second limit in three bursts while the Mac stalled (one compile took 17.7 minutes by the clock); compiled again from their saved code, those 20 passed too.

## Files

| File | Holds |
|---|---|
| `parts.jsonl` | One part per line, in index order. |
| `skipped.jsonl` | Each skipped index, its family and every reason. |
| `manifest.json` | Generator, seed, counts by family, skip reasons, pass rates, the number of different trees with one sha256 for the whole set (of the sorted tree hashes), settings, the OpenSCAD build's sha256, and the rows, bytes and sha256 of `parts.jsonl` and `skipped.jsonl`. |
| `timings.jsonl` | Compile and check time per part, kept apart because times change from run to run. |

## A row

A real row (part 13 of the seed 1 run below), with the line breaks moved for reading:

```json
{
  "id": "s1-000013",
  "index": 13,
  "generator": {"name": "gkod-datagen", "version": "0.1.0", "commit": "3fecc1ab0d22a14dca6fa48265b0ecc5c2844acb", "dirty": false},
  "seed": 1,
  "part_seed": 3417133882,
  "family": "knob",
  "tree": {"family": "knob", "body": {"kind": "knob", "diameter": 31, "height": 13.5, "shaft": 4, "shaftDepth": 11.5, "chamfer": 1}, "features": [{"kind": "flat", "depth": 0.5}]},
  "tree_sha256": "9fe7549a2d1d4d3c8840df29126fd1ecfd528f50ce0306c72d6c8a487ad1982b",
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

- `tree_sha256`: the sha256 of the tree as JSON with every key sorted. The same part has the same hash in every run, so a split can keep one part out of two sets.
- `labels.compile`: `ok`, `error`, `triangles`. `labels.mesh`: bounding box `size` and `min` (mm) and `volume` (mm³).
- `labels.checks`: `ok`, and each check's `id` and `ok`, with the plain sentence when it fails.
- `labels.params_ok`: the compiler's own list of sizes, read with the site's rules, is exactly the size block the generator wrote.
- `labels.facts_ok`: every fact that names an axis matches the mesh within 0.05 mm.
- A fact is `{key, value, unit}` with `unit` `mm`, `count` or `flag`. The key is the size's name in the code when there is one (`width`, `hole_d`, `base_hole_spacing`), or a count or flag such as `hole_count`, `compartment_count` or `shaft_flat`. `axis` (`x`, `y`, `z` or `xy`) is set only when the number is the part's real overall size along that axis.

## Same seed, same file

The random number generator is our own (mulberry32). Part `i` gets its own seed from the run seed and `i`, so part 537 is the same in a run of 1,000 or 2,000, and the tree and the request use separate generators. Numbers are written in one fixed format. Compiles run in parallel, but rows are written strictly in index order, and where a run stops never depends on the number of workers. The same seed and generator commit give a byte-identical `parts.jsonl`. Every row holds the commit, so the file's hash changes with each commit.

## Measured

The day 6 set is `data/parts/day6-seed1`: seed 1, `--count 1000`, commit `3fecc1a` with a clean tree, made with 8 workers on an M4 Mac (10 cores) and made again with 3 workers.

| | |
|---|---|
| Parts | 1,000 (7 indices skipped: holes, ribs and notches too close together 5, a screw head against a rim 2; no repeated part) |
| Compiled | 100% |
| Passed all print checks | 100% (solid 100%, fits the bed 100%, flat base 100%, overhang 100%) |
| Size block matches the compiler (`params_ok`) | 100% |
| Stated overall sizes match the mesh (`facts_ok`) | 100% |
| By family | plate 110, bracket 121, channel 124, tray 133, spacer 127, hook 126, knob 124, clip 135 |
| Features per part | none 284, one 510, two 186, three 20 |
| Triangles | 12 to 3,128 (median 472) |
| Size | x 7 to 198, y 7 to 160, z 2 to 100 mm |
| Code | 18 to 76 lines (median 42) |
| Requests | 17 to 228 characters, 3 to 50 words (median 21); all 1,000 different; 135 different openings, the most common ("I need") in 9.5%. An opening is the first two words, lowercased, with punctuation taken off. |
| Facts per request | 2 to 12 (median 5) |
| Different parts | 1,000 tree hashes and 1,000 STL hashes |
| Time | 25.1 s with 8 workers and 47.7 s with 3 for the whole run; compile 59 ms per part (median), check 0.4 ms |
| `parts.jsonl` sha256 | `6c3abc282d94d016f1421c412c6e626a9150d44376e205deef372a5ea0807ac8`; both runs gave byte-identical `parts.jsonl`, `skipped.jsonl` and `manifest.json` |

A script also read every row: each title's hole count matches the tree, each hook's stated reach is its mesh depth, every bracket and hook has a hole or slot, and no row breaks a wording rule from the tests.

What these numbers do not show: every part passes because the rules are strict and the shapes are simple (boxes and cylinders, no angled or curved features beyond hull and offset). Some features are rare (in 1,000 parts: 5 pockets, 9 rib sets, 9 standoff sets, 11 notches, 12 rims), and more than a quarter of the parts have no features at all. Plain spacers have only a few sizes, so two runs with different seeds can share a part; use `tree_sha256` to keep any part out of two splits.

## Frozen sets

The train, dev and test sets, made once by program and frozen with their sha256 in the repo. The design is in [src/splits/design.ts](src/splits/design.ts).

```sh
node datagen/bin/gkod-datagen.mjs sets make --out data/sets/v1 [--workers 8]
node datagen/bin/gkod-datagen.mjs sets check [--dir data/sets/v1] [--hashes datagen/sets-v1.sha256]
```

`make` runs only from a clean commit and only into a new folder inside `data/` (or outside the repo). `check` verifies every file against [sets-v1.sha256](sets-v1.sha256) and then every rule below on every row, and prints counts only. `cd data/sets/v1 && shasum -a 256 -c ../../../datagen/sets-v1.sha256` checks the files too.

**Families.** Each family is in one split. The level is the median number of named sizes in a 6,000-part run (seed 7): simple 3 to 5, medium 6 or 7, harder 8 or more.

| Split | Simple | Medium | Harder |
|---|---|---|---|
| train (15) | spacer, divider, grommet, cup | plate, channel, tray, hook, knob, clip | bracket, shelf, tool_holder, bit_holder, battery_holder |
| dev only (3) | coaster | corner_plate | comb |
| test only (6) | washer, foot | slot_plate, saddle | enclosure, handle |

Three test families share a body with a training family (washer: the spacer's round body; slot_plate: the plate and its slots; enclosure: the tray's box) and three have a body no training part has (foot, saddle, handle). In dev, a square coaster is the plate body with a rim; corner_plate and comb have bodies of their own.

**Held-out feature pairs.** A feature is its kind, with its face for holes, slots and pockets (`holes@top`, `slots@base`); corner shapes and countersinks are not features. No training part, and neither side of any training edit, has both features of a pair, but each feature is in training parts on its own:

| Pair | Where it shows up | Split | Training parts of that family with each feature | All training parts with each feature |
|---|---|---|---|---|
| holes@top + lip | plate: holes and a rim | dev | 214 / 12 | 214 / 12 |
| dividers + tabs | tray | dev | 124 / 38 | 124 / 38 |
| gussets + slots@base | bracket | dev | 68 / 16 | 704 / 16 |
| holes@floor + lips | channel: floor holes and inward lips | dev | 161 / 55 | 341 / 55 |
| holes@top + notch | plate | test | 214 / 16 | 214 / 365 |
| holes@top + ribs | plate | test | 214 / 17 | 214 / 17 |
| holes@floor + tabs | tray | test | 38 / 38 | 341 / 38 |
| holes@upright + slots@base | bracket | test | 271 / 16 | 1,149 / 16 |
| flat + grips | knob: a D-shaped shaft and grip notches | test | 27 / 228 | 27 / 228 |

The last column counts a feature on every training family, which makes some features look common when the family the pair is about rarely has them: 349 of the 365 notches are a divider's top-edge notch, which is a different cut said in other words; 636 of the 704 gussets are on shelves and tool holders; 878 of the 1,149 upright hole sets are on shelves and tool holders; floor holes are on 161 channels, 142 cups and only 38 trays. The manifest's `held_out[].train_parts_with` gives that last column.

**Tiers.** Dev and test have the same structure, 100 rows in each tier and 100 edit pairs:

- `t1`, new sizes: training families on their own seeds, 7 or 6 parts a family, no held-out pair.
- `t2`, new feature pairs: training families with exactly one of the split's pairs, 25 a pair in dev and 20 in test.
- `t3`, new families: the split's own families, 34, 33 and 33 in dev and 17 or 16 in test.
- `edit`: pairs made from the split's own parts (all three tiers), by the edits code above.

**Rules,** checked when the set is made and again by `check`:

- Parts are split first; edit pairs are made inside each split from its own parts.
- No tree is in two splits, and no tree is within 0.5 mm of a tree of the same shape in another split (every number of the tree, same family, features, faces, patterns and flags). This covers parts and both sides of every edit pair.
- Training rows have no held-out pair; dev rows have no test pair and test rows no dev pair.
- Every row compiled, passed every print check, and its size block and stated sizes matched (edits: code A compiled and only the edited sizes changed). A row that fails is compiled again, up to three tries; one that still fails stops the run, so the set never depends on the machine's speed.
- Every piece has its own seed: train parts 101, train edits 102, dev 201 to 204 and test 301 to 304 (t1, t2, t3, edits).

**Files** in `data/sets/v1` (git-ignored): `train/`, `dev/` and `test/`, each with `create.jsonl` (parts) and `edit.jsonl` (edit pairs); `manifest.json`; `sets.sha256`. A part row is a generator row as above with `split`, `tier` (`train`, `t1`, `t2` or `t3`) and `held_out_pair` (the pair for `t2`, otherwise null) after its `id`; an edit row is an edit pair with `split`, `tier` `edit` and `source_tier`. Every row keeps its generator commit, seed and part or pair seed. The manifest has the design, the seeds, the counts by split, tier and family, how many indices each piece looked at and why it passed over the rest, the edit kinds, each split's tree count with one sha256 of its sorted tree hashes, the token estimate and every file's rows, bytes and sha256.

**The test split stays closed** until the final run. `readSplit` in [src/splits/read.ts](src/splits/read.ts) refuses it unless it is called with `final: true`, and the benchmark must refuse to score it without `--final`, which only the final run passes. `check` reads its rows only to hash and count them.

**Set v1,** made at commit `15974c9` with a clean tree, with 8 workers in 328 s and again with 5 workers in 445 s: all eight files byte-identical. 28 MB.

| | train | dev | test |
|---|---|---|---|
| Parts | 6,000 | 100 + 100 + 100 | 100 + 100 + 100 |
| Edit pairs | 3,000 | 100 | 100 |
| Different trees (parts and both sides of edits) | 8,998 | 400 | 400 |
| `create.jsonl` sha256 | `0457c63f…2f09` | `a6c2e9bf…157e` | `cef696df…aaac` |
| `edit.jsonl` sha256 | `59116dc0…c0f8` | `0bb986c6…f14b` | `4d5eadf9…38a9` |

`manifest.json` sha256 `9dcc31deddb1bb8644221682cc2004308c6d5700559286d3a18cf362cae048f6`; the full hashes are in [sets-v1.sha256](sets-v1.sha256). No tree is in two splits and none has a near-copy in another. Training parts by family: 323 (knob, tray) to 464 (cup). Training edits by kind: size 1,443, hole_d 212, move 158, count 299, scale 239, add 280, remove 369. Dev edits came from 36 tier 1, 32 tier 2 and 32 tier 3 parts; test edits from 37, 35 and 28.

**Training tokens, roughly** (characters / 3.5; day 8 measures with the real tokenizer), counting the site's system prompt, the words the site sends ([app/src/engine/prompts.ts](../app/src/engine/prompts.ts)) and the answer as one code block:

| | Rows | With the system prompt | Without it | Answer only |
|---|---|---|---|---|
| Create | 6,000 | 4.44 M | 1.91 M | 1.70 M |
| Edit | 3,000 | 3.29 M | 2.02 M | 0.84 M |
| Total | 9,000 | 7.73 M | 3.94 M | 2.54 M |

What these numbers do not show: every row, test included, comes from this generator, so the wording and the code style are the same in every split; tier 3 families are new, the way they are written is not. Tier 2 covers only the five training families that take two or more kinds of feature (plate, bracket, tray, channel, knob). Some held-out features are rare on their own in training within the family the pair is about (a rim on 12 training plates, a notch on 16 plates, base slots on 16 brackets, ribs on 17 plates, a shaft flat on 27 knobs, floor holes on 38 trays), so a tier 2 miss may come from a feature seen rarely, not only from a new pair. Tier 1 keeps out trees within 0.5 mm of a training part, not ones 1 mm away. The levels come from code size, not from measured difficulty.

`npm test` covers the design (every family in one split, the level mix, the pairs), near-copies, each split rule, the shares, picking the same parts twice, edit pairs inside a split, a small set made twice with different worker counts and byte-identical, the token count against the site's prompt, the check passing a good set and failing a changed, extra or missing file, a tree in two splits and a training part with a held-out pair, the closed test split and the command's options.

## Tests

`npm test` covers the random number generator, the expression and code printer, the rules, the slider ranges, each family's valid-tree rate, a fixing on every bracket and hook, the size block format (read the way the customizer reads it), one part per family through the real compiler at its default sizes and at both ends of every slider, the request facts against the tree, the title's hole count, the wording rules on two seeds, the tree hash, the byte-identical end-to-end run with different worker counts, and the refusal to start when the OpenSCAD build is missing.
