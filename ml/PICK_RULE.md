# How checkpoints and the final model are picked

Written on 28 Nov 2026, before any training run. The rule below does not change once the first dev look is made
(git history shows it). Only the log table at the end grows.

## Sets

- **dev-curve:** the first 50 dev prompts in the benchmark's fixed order (sorted by the sha256 of the id, the order
  `gkod_bench run --split dev --limit 50` takes). The same 50 for every checkpoint of every run. Used only for
  learning curves.
- **full dev:** all 400 dev prompts (300 create, 100 edit). Used for picking.
- **test:** closed until the end (see below).
- The validation loss (100 train rows) and the everyday requests are reported. They never pick anything.

## Score and ties

- The score is `right_part`: how many prompts get the right part, as the benchmark (`ml/bench`) scores it. Its
  definition and the scorer commit are written in the log at the first full-dev look and then stay fixed. Rows scored
  by another scorer are scored again (`gkod_bench rescore`) before they are compared, never mixed.
- A difference between two rows is real only when the exact McNemar test on the prompts both answered
  (`gkod_bench compare`) gives p < 0.05. Anything else is a tie.

## A run's checkpoint

1. Every checkpoint is kept and scored once on dev-curve, for the learning curve.
2. At most two checkpoints of a run go to full dev: the last one, and the one with the most right parts on dev-curve
   if that is another one. A tie on dev-curve goes to the later checkpoint, so then only the last one goes.
3. The run's checkpoint is the one with more right parts on full dev. A tie goes to the later checkpoint.

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
  loss. The saturation point is the earliest checkpoint that no later checkpoint beats by a real margin. It describes
  the run; it does not pick.
- Data-size runs (for example 1,000, 2,000, 4,000 and 8,000 rows) are scored on dev-curve. One goes to full dev only
  as a candidate, inside the limits above.

## Log of dev looks

| Date | Run | Checkpoint (step) | Set | Right parts | Scorer commit | Note |
|---|---|---|---|---|---|---|
