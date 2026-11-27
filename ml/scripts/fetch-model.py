"""Download the base model at a pinned revision into ml/models/ and check its weights against their sha256.

    ml/.venv/bin/python ml/scripts/fetch-model.py

The weights are Qwen's own bf16 release. mlx-lm reads these safetensors directly, so nothing is converted and the file
on disk is byte for byte the one Qwen published.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
from pathlib import Path

REPO = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
REVISION = "2e1fd397ee46e1388853d2af2c993145b0f1098a"
LICENSE = "Apache-2.0"
WEIGHTS = "model.safetensors"
WEIGHTS_SHA256 = "c1b9b30e907950516ba3c646bdf570d8084c25a6410a0cdca80cf04b11bc13a8"
WEIGHTS_BYTES = 3_087_467_144

ML = Path(__file__).resolve().parent.parent
DEST = ML / "models" / "qwen2.5-coder-1.5b-instruct"
MIN_FREE_AFTER = 8 * 1024**3


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> int:
    weights = DEST / WEIGHTS
    if weights.exists() and weights.stat().st_size == WEIGHTS_BYTES and sha256(weights) == WEIGHTS_SHA256:
        print(f"{REPO}@{REVISION[:7]} is already in {DEST} and its weights match.")
        return 0
    DEST.parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(DEST.parent).free
    if free - WEIGHTS_BYTES < MIN_FREE_AFTER:
        print(f"Not enough disk: {free / 1e9:.1f} GB free, and at least 8 GB must stay free after the download.")
        return 1

    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=REPO, revision=REVISION, local_dir=DEST)
    got = sha256(weights)
    if got != WEIGHTS_SHA256:
        print(f"{WEIGHTS} has sha256 {got}, expected {WEIGHTS_SHA256}. Delete {DEST} and try again.")
        return 1
    print(f"{REPO}@{REVISION[:7]} ({LICENSE}) is in {DEST}; {WEIGHTS} sha256 matches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
