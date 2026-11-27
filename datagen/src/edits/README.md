# Edit pairs

An edit pair is a part, one change to it, and the changed part: code A, an instruction ("make it 10 mm wider"), and code B. They train and test the "change this part" step, which the site sends with its edit prompt (code A plus the instruction).

## No model-written data

- **Part A** is a row of a generator run (`data/parts/<name>/parts.jsonl`), as made by the parts generator.
- **The edit** is picked by our own seeded random number generator and applied to A's feature tree. Tree B is checked with the generator's own rules.
- **Code B** is written from tree B by the same serializer as every part. No code is written by hand.
- **The instruction** is put together from short word lists ([say.ts](say.ts)): a verb, the thing it changes and the amount. An added feature is said with the same phrase pieces as the requests ([../phrases.ts](../phrases.ts)). No whole sentence is written by hand.

## The edits

| Kind | What changes | Example |
|---|---|---|
| `size` | one named size, by an amount or to a value | "make it 10 mm wider", "make the walls 2.4 mm thick", "set floor_thickness to 2.2mm" |
| `hole_d` | a hole diameter (holes, tab, flange or standoff holes, a spacer's hole, a knob's shaft hole) | "use 5 mm holes instead", "make the screw holes 1 mm bigger" |
| `move` | where holes, slots or standoffs sit: their spacing or distance from the edge | "move the holes 3mm closer together", "put the holes 8 mm in from the edges" |
| `count` | a count: holes in a row, ribs, dividers, flange holes, grip notches; one centre hole and a pair; one gusset and two | "add a third hole", "use two holes 30 mm apart instead of one", "split it into three compartments" |
| `scale` | every size but the counts, by 120%, 125%, 150%, 200%, 80% or 75% | "make it 50% bigger", "make it twice the size" |
| `add` | a new feature, with sizes picked the way its family picks them | "add a rim 3 mm high around the edge", "give it two mounting tabs with 4 mm holes" |
| `remove` | one feature; a bracket or hook keeps its last holes or slots | "remove the slot", "make it without the gussets" |

A one-size edit picks its new value inside the size's slider range, and the range was found by moving that size while every rule still held, so the part stays valid. Every other edit gives a tree that is checked before it is used; a tree that breaks a rule, or the same edit of the same part made earlier in the run, is skipped and logged.

**Code B keeps what the edit does not touch.** Every size that is not changed, added or removed has the same name, caption and value in code A and code B, so an engine that edits correctly can be scored by comparing size blocks. Code B also keeps each slider range of code A that still holds on part B, so a one-size edit usually changes one line of code. Where an old range no longer holds (a taller tip leaves less room for the back plate to shrink), that range is worked out afresh, as the parts generator does.

**Splits.** Pairs are made inside a split: give the split's parts file as `--from` and the other splits' files as `--avoid`, and no edited part will have a tree hash that another split holds. The run refuses to start if a source part is itself in an avoided file.

## Command

```sh
node datagen/bin/gkod-datagen.mjs edits --from data/parts/<name> --count 300 --seed 1 --out <folder> \
  [--workers 8] [--avoid <parts.jsonl, pairs.jsonl or hashes.txt> ...] [--no-manifest]
```

The source must be complete: its `manifest.json` must list the file's sha256 and row count (or pass `--no-manifest`). Every source row must come from the generator at a clean commit, have passed its labels, and still get the same code from this serializer; otherwise the run stops, since code B would then differ from code A by more than the edit. The output folder must be inside `data/` or outside the repo, and must not already hold a run.

## A row

`pairs.jsonl` has one pair per line, in index order:

- `id` (`e<seed>-<index>`), `index`, `generator` (name, version, commit, dirty), `seed`, `pair_seed`.
- `source`: the part's `id`, `seed`, `part_seed` and `generator`, and the sha256 of the parts file it was read from.
- `family`, `op` (the edit, with its numbers), `instruction`.
- `a` and `b`: `tree`, `tree_sha256`, `title`, `code` (and A's `request`). B's title counts its holes by the request's rule.
- `facts.stated`: what the instruction says, as `{key, value, unit}` like request facts (`unit` is `mm`, `count`, `flag` or `ratio` for a scale). A size fact names an `axis` when it is the part's real overall size along it. An edit by an amount states the size it gives. A removed feature states a count or flag of 0.
- `facts.changed` (`name`, `from`, `to`), `facts.added`, `facts.removed` and `facts.kept` (`name`, `value`): how code B's size block differs from code A's.
- `labels`: code B's `compile`, `mesh`, `checks`, `params_ok`, `facts_ok` and `stl_sha256`, worked out as for a part; `a_compile_ok`; and `sizes_ok`: the compiler's own size lists for code A and code B differ by exactly the changed, added and removed sizes, and every kept size has the same name, value and caption.

`manifest.json` adds counts by edit kind and family, skip reasons, the rates, the number of kept, changed, added and removed sizes, the source file's path, sha256 and generator commits, the avoided files, the OpenSCAD build's sha256 and the sha256 of every output file. Compile times go to `timings.jsonl`. The same seed, source file and generator commit give a byte-identical `pairs.jsonl`, whatever the number of workers.

## Measured

300 pairs from `data/parts/day6-seed1` (1,000 parts, commit `3fecc1a`), seed 1, at commit `801a451` with a clean copy of the code, made with 8 workers and again with 3 on an M4 Mac.

| | |
|---|---|
| Pairs | 300 (2 indices skipped: the same edit of the same part again) from 266 different parts; 300 different B trees, none the same as a day 6 part |
| By kind | size 128, hole_d 35, move 13, count 30, scale 27, add 42, remove 25 (by an amount 89, to a value 101) |
| By family | bracket 39, channel 39, clip 30, hook 36, knob 43, plate 32, spacer 41, tray 40 |
| Code A compiled | 100% |
| Code B compiled, passed all print checks, size block matches the compiler, stated sizes match the mesh | 100% each |
| Only the edited sizes differ (`sizes_ok`) | 100%: 1,567 kept sizes identical in name, caption and value; 358 changed, 109 added, 61 removed |
| One-size edits that change exactly one line of code | 150 of 176 (the rest also move a slider range that no longer holds) |
| Instructions | 3 to 15 words (median 7); 295 different; 74 different openings |
| Time | 13.4 s with 8 workers, 21.8 s with 3; compile 81 ms per code (median) |
| `pairs.jsonl` sha256 | `105840c98cc73d757b8b7e2cd91b6db6907b2f306b42a5677407c61b168b2e25`; both runs gave byte-identical `pairs.jsonl`, `skipped.jsonl` and `manifest.json` |

A separate script read every row again from the code text alone (not from the labels): the size blocks of A and B differ by exactly the listed sizes, each one-size edit changes only its own size, and every code B compiles and passes the checks through the `gkod` command.

What these numbers do not show: every pair passes because each edit is checked with the same strict rules before its code is written. Instructions are short and say one change each; no instruction combines two edits, and none refers to a part by what it looks like. Rare features (pockets, standoffs, notches) are rarely edited, since they are rare in the source parts. Added features are picked only for the eight day 6 bodies (plate, box, bracket, channel, spacer, hook, knob, clip); a part on a newer body can be changed, scaled and have features removed, but gets nothing added, and its sizes may be said by their caption or code name rather than in plain words.

## Tests

`npm test` covers each kind of edit on the tree, the feature order, the values picked inside slider ranges, the last fixing kept on brackets and hooks, the title rule, kept slider ranges that still hold, the size block diff, the stated numbers in every instruction, provenance, the avoided trees, the byte-identical run with different worker counts, the source and avoid file refusals, and the command's options.
