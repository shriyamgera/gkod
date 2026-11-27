# @gkod/datagen

The training data generator. It makes parts by program, writes a request for each, and labels each one with the site's own compiler and print checks. No example is written by a model: not the parts, not the code, not the requests.

Needs Node 22.18 or later (it runs the TypeScript sources directly) and the OpenSCAD web build (`npm run fetch:openscad`).

```sh
node datagen/bin/gkod-datagen.mjs --count 1000 --seed 1 --out data/parts/<name> [--workers 8]
```

The output folder must be inside `data/`, which git ignores. A folder that already holds a run is refused.

## How a part is made

1. **Feature tree.** A family (see below) picks a base body and features from a seeded random number generator: through and countersunk holes, slots, pockets, ribs, standoffs, a rim, a notch, mounting tabs, dividers, gussets, a flange, inward lips, grip notches, a flat on a shaft hole, rounded or chamfered corners.
2. **Rules.** The tree is checked before any code exists: walls at least 1.6 mm, holes 2 to 12 mm (10 mm through a standing wall), holes and slots inside the body with a 1.6 mm wall around them and clear of rounded corners, cuts kept apart from each other and from ribs, standoffs and gussets, rims and ribs standing on the body, and the whole part inside a 200 mm cube. Every problem is a plain sentence. A tree that breaks a rule is skipped and its reason is counted.
3. **Slider ranges.** Each named size moves out from its value one step at a time, about a third either way, while the whole part still passes every rule. So any one slider can be set anywhere in its range and the part stays valid.
4. **Code.** A serializer writes the OpenSCAD from small pieces of our own (cube, cylinder, square, circle, polygon, offset, linear_extrude, hull, union, difference, translate, rotate, mirror, for). No part is stored as a text template. The file follows the site's format: a title line, every size as a named number with a caption line above it and a slider range, then `/* [Hidden] */` with `$fn` and worked-out values, then modules and the call. No `minkowski()`, `text()` or imports.
5. **Request.** The request is put together from short word lists and phrase pieces with the tree's numbers: nouns and their synonyms, size phrases ("80 mm wide", "80x50mm", "80 by 50 mm"), feature phrases, a few sentence orders. Some sizes are left out on purpose. The request comes with the **facts** it states, each one checkable on the made part later.
6. **Labels.** The code is compiled with the gkod command's compiler (the site's OpenSCAD build, `--hardwarnings`, the banned-call guard, a 10 second limit) in worker threads, then checked with [the print checks](../checks/README.md) for the Anycubic Kobra 2 Neo bed (220 x 220 x 250 mm) and the 45 degree overhang rule.

## Families

| Family | Body | Features it can have |
|---|---|---|
| plate | flat plate, sharp, rounded or chamfered corners | holes (centre, pair, row, corners, grid), countersinks, a slot, a pocket, ribs, standoffs, a rim or a notch |
| bracket | L bracket | holes in the base and the upright, slots in the base, one or two gussets |
| channel | U channel or cable tray | holes or slots in the floor, inward lips |
| tray | open box | dividers, floor holes, two mounting tabs |
| spacer | round or hex spacer | a flange with or without screw holes |
| hook | wall hook, printed on its side | one or two screw holes, countersunk or not |
| knob | knob, printed face down | grip notches, a flat on the shaft hole |
| clip | cable or pipe clip, printed on its side | two screw holes through the pad |

Each family is a small block of size ranges and chances plus one sampling function, in [src/families](src/families).

## Files

| File | Holds |
|---|---|
| `parts.jsonl` | One part per line, in index order. |
| `skipped.jsonl` | Each skipped index, its family and every reason. |
| `manifest.json` | Generator name, version, commit and dirty flag, seed, counts by family, skip reasons, pass rates, settings, the sha256 of the OpenSCAD build, and the size, row count and sha256 of `parts.jsonl` and `skipped.jsonl`. |
| `timings.jsonl` | Compile and check time per part. Times change from run to run, so they are kept out of the other files. |

Each row of `parts.jsonl` has `id`, `index`, `generator` (name, version, commit, dirty), `seed`, `part_seed`, `family`, `tree`, `title`, `request`, `facts`, `code` and `labels`:

- `labels.compile`: `ok`, `error`, `triangles`.
- `labels.mesh`: bounding box `size` and `min`, `volume` (mm, mm³).
- `labels.checks`: `ok`, and each check's `id` and `ok`, with the plain sentence when it fails.
- `labels.params_ok`: the compiler's own list of sizes, read with the site's rules, is exactly the size block the generator wrote.
- `labels.facts_ok`: every fact that names an axis matches the mesh within 0.05 mm.
- `labels.stl_sha256`: the hash of the compiled STL.

A fact is `{key, value, unit}`, where `unit` is `mm`, `count` or `flag`. The key is the size's name in the code when there is one (`width`, `hole_d`, `base_hole_spacing`), or a count or flag such as `hole_count`, `compartment_count` or `countersunk`. `axis` (`x`, `y`, `z` or `xy`) is set only when the number is the part's real overall size along that axis.

## Same seed, same file

The random number generator is our own (mulberry32). Part `i` gets its own seed from the run seed and `i`, so part 537 is the same in a run of 1,000 or 2,000. The tree and the request use separate generators, so a change to the wording never changes the trees. Numbers are written in one fixed format. Compiles run in parallel, but rows are written strictly in index order. The same seed and generator commit give a byte-identical `parts.jsonl`; the tests run the same 20 parts twice with different worker counts and compare the files.

## Tests

`npm test` covers the random number generator, the expression and code printer, the rules, the slider ranges, each family's valid-tree rate, the size block format (read the way the customizer reads it), one part per family through the real compiler at its default sizes and at both ends of every slider, the request facts against the tree, and the byte-identical end-to-end run.
