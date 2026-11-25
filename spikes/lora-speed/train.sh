#!/bin/sh
# Timed LoRA run.  Usage: ./train.sh <name> <model path or repo> <iters> <batch> <lora layers> [extra mlx_lm.lora flags]
# MLX_BIN is the folder that holds mlx_lm.lora (a Python venv's bin folder).
set -e
NAME=$1; MODEL=$2; ITERS=$3; BATCH=$4; LAYERS=$5; shift 5
: "${MLX_BIN:?set MLX_BIN to the folder holding mlx_lm.lora}"
mkdir -p logs adapters
./mem_watch.sh "logs/mem_$NAME.log" &
WATCH=$!
trap 'kill $WATCH 2>/dev/null' EXIT
echo "start $(date +%H:%M:%S) swap: $(sysctl -n vm.swapusage)" | tee "logs/train_$NAME.log"
/usr/bin/time -l "$MLX_BIN/mlx_lm.lora" --model "$MODEL" --train --data data \
  --iters "$ITERS" --batch-size "$BATCH" --num-layers "$LAYERS" \
  --learning-rate 1e-4 --max-seq-length 512 \
  --steps-per-report 10 --steps-per-eval 50 --val-batches -1 \
  --save-every "$ITERS" --adapter-path "adapters/$NAME" --seed 0 "$@" 2>&1 | tee -a "logs/train_$NAME.log"
echo "end $(date +%H:%M:%S) swap: $(sysctl -n vm.swapusage)" | tee -a "logs/train_$NAME.log"
