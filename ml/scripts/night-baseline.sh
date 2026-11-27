#!/bin/sh
# Tonight's baseline rows on the dev set: the untrained local model zero-shot, then with the 3 fixed train examples.
# Each row runs under the night-run script (awake, logged, disk watched, restarted after a crash) and the benchmark
# resumes it where it stopped, so the same command can simply be started again. The test split is never opened.
#
#   sh ml/scripts/night-baseline.sh
#
# Start it with the Mac plugged in, the lid open and the browser closed. Logs: results/logs/. Answers and scores:
# results/raw/<row>/dev/ and results/<row>/dev/summary.json (all git-ignored).
set -u
cd "$(dirname "$0")/../.." || exit 2

# Homebrew's Python needs its own expat (see ml/README.md). It is set here because /bin/sh drops DYLD_* on start.
EXPAT=/opt/homebrew/opt/expat/lib
[ -d "$EXPAT" ] || EXPAT="$(brew --prefix expat)/lib"
export DYLD_LIBRARY_PATH="$EXPAT"
PY=ml/.venv/bin/python

# Closing the terminal window sends SIGHUP to this script and everything it started. Ignore it here, so the loop goes
# on to the next row; night-run and caffeinate inherit the ignore.
trap '' HUP

for shots in 0 3; do
  "$PY" ml/scripts/night-run.py --name "baseline-dev-${shots}shot" -- \
    "$PY" -m gkod_bench run --engine local --split dev --shots "$shots"
  code=$?
  # 0 finished, 1 still failing after the restarts: go on to the next row. Low disk, Ctrl-C or no start: stop here.
  case $code in
    0 | 1) ;;
    *) exit "$code" ;;
  esac
done
