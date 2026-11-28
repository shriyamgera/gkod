# How checkpoints and the final model are picked

Written on 28 Nov 2026, before any training run. The rule below does not change once the first dev look is made
(git history shows it). Only the log table at the end grows.

Changed on 28 Nov, still before any dev look, after a review: dev-curve's prompts (below); what a tie is in steps 2
and 3; step 3 compared on the full-dev prompts outside dev-curve; the score pinned to a scorer commit; the end-of-run
check on the saturation point; and what a pipeline check is.

## Sets

- **dev-curve:** the 50 dev prompts listed in `ml/bench/subsets/dev-curve.json` with the dev files' sha256, picked by
  the seeded rule written there and in `ml/README.md` ("Learning curve"): 13 tier 1, 12 tier 2, 12 tier 3 and 13
  edits, spread over families and edit kinds. The same 50 for every checkpoint of every run. Used only for learning
  curves. (Changed on 28 Nov, before any dev look: the first 50 in the benchmark's order, the rule first written here,
  had only 5 tier 2 prompts.)
- **full dev:** all 400 dev prompts (300 create, 100 edit). Used for picking.
- **test:** closed until the end (see below).
- The validation loss (100 train rows) and the everyday requests are reported. They never pick anything.

## Score and ties

- The score is `right_part`: how many prompts get the right part, as the benchmark (`ml/bench`) scores it at scorer
  commit `55fe896` (28 Nov). An answer is the right part when it compiles, passes all four print checks (Anycubic
  Kobra 2 Neo bed, 45 degree overhangs), passes every measured stated fact (overall sizes on the mesh, hole counts by
  genus, and for a create its stated sizes in mm read from its named sizes), overlaps the reference part by at least
  0.99 (`RIGHT_PART_IOU`: voxel intersection over union, best of 24 turns, both parts compiled with `$fn = 48`), has as
  many separate pieces and as many through holes as the reference, and, for an edit, has the right size block.
- The scorer is `score.py`, `voxel.py`, `mesh.py`, `stl.py`, `extract.py` and `ceiling.py` in `ml/bench/gkod_bench`,
  and the site code they call (`tools/src`, `app/src/scad`, `checks/src`). Any later change to it is written in the log
  below, with its date and commit, before a number it gives is used, and every row compared after it is scored again
  (`gkod_bench rescore`). Rows scored by different scorers are never compared.
- A difference between two rows is real only when the exact McNemar test on the prompts both answered
  (`gkod_bench compare`) gives p < 0.05. Anything else is a tie in this sense. Steps 2 and 3 below say which tie they
  mean.

## A run's checkpoint

1. Every checkpoint is kept and scored once on dev-curve, for the learning curve.
2. At most two checkpoints of a run go to full dev: the last one, and the one with the most right parts on dev-curve
   if that is another one. A tie here is the same count: of the checkpoints tied for the most, the later one goes,
   together with the last. When the last is one of them, only the last goes.
3. The run's checkpoint is the one with more right parts on the 350 full-dev prompts that are not in dev-curve; the
   same count goes to the later checkpoint (the last). The other checkpoint was chosen for its dev-curve count, so its
   dev-curve prompts would carry that luck into the comparison; they are left out of it.

The validation loss never picks a checkpoint. night-run's `best.json` is only a note.

## The final model

1. The candidates are the runs' checkpoints.
2. Simpler first, fixed now: (1) Insurance-first, plain LoRA on v1 rows; (2) Data-first, which adds generator
   data; (3) Plan-first, which adds a plan to every answer; (4) Self-check, a second round on the model's own
   verified answers. A combination is less simple than each method in it. Between two combinations, fewer methods is
   simpler, then the one whose most complex method is simpler. Between two runs of one method, fewer training rows is
   simpler, then the earlier run.
3. Let B be the candidate with the most right parts on full dev (an exact tie goes to the simpler one). The final model
   is the simplest candidate that B does not beat by a real margin. So a more complex method wins only by a real
   margin.

## Dev looks allowed

- dev-curve: one look per checkpoint.
- full dev: at most 2 per run, and at most 12 in all before the test run. The limit is not raised.
- Every look is written in the log below before its numbers are used.
- A pipeline check is not a dev look: checkpoints that can never be candidates (a smoke or probe run's) scored on at
  most 5 dev-curve prompts to check that the code works, with numbers never compared with a candidate or used to
  choose anything. It is still logged, as a pipeline check.
- Dev rows never go into training. Reading dev failures to find kinds of mistakes is allowed; the fixes are general
  (row mix, settings, generator features), never copies of dev parts.

## The test split

- It is read once, at the end, with `--final`: the final model plus the baselines. The baselines are the untrained
  model zero-shot and with 3 examples, and any comparison row from the plan (RAG, Gemini, Claude Code with tools) that
  already has a full dev row with the same settings. No other row.
- Test numbers never change the pick, and nothing is trained or tuned after them.
- A test run that stops part way (a crash, the power) carries on with the same rows. It is not started again with
  changes.

## Curves

- The learning curve of a run is its dev-curve score at every checkpoint, with intervals, next to its validation
  loss. The saturation point is the earliest checkpoint that no later checkpoint beats by a real margin, except that
  the run is "not saturated within this run" when that checkpoint is among the last 3 scored (too few later points to
  test it), when the last checkpoint has more right parts than every earlier one, or when the last half of the points
  still rise (Cochran-Armitage trend test, one-sided p < 0.05). It describes the run; it does not pick. `gkod_bench
  curve` writes it, and next to it a second reading (the interval rule in `ml/README.md`), which does not pick either.
- Data-size runs (for example 1,000, 2,000, 4,000 and 8,000 rows) are scored on dev-curve. One goes to full dev only
  as a candidate, inside the limits above.

## Log of dev looks

| Date | Run | Checkpoint (step) | Set | Right parts | Scorer commit | Note |
|---|---|---|---|---|---|---|
| 28 Nov | run1-smoke (480 rows, 60 steps; not a candidate) | 20, 40, 60 | 5 dev-curve prompts (`results/smoke/subsets/smoke5.json`) | 1, 1, 2 of 5 | `95ae2c6` | Pipeline check, logged after it was made. |
