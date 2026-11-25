#!/bin/sh
# Downloads the official OpenSCAD WebAssembly nightly builds (about 13 MB) into vendor/.
set -e
VER="${1:-2026.11.23}"
BASE=https://files.openscad.org/snapshots
cd "$(dirname "$0")"
mkdir -p vendor/dl
for kind in node node-module web; do
  f="OpenSCAD-$VER-WebAssembly-$kind.zip"
  curl -sSf -o "vendor/dl/$f" "$BASE/$f"
  curl -sSf -o "vendor/dl/$f.sha256" "$BASE/$f.sha256"
  (cd vendor/dl && shasum -a 256 -c "$f.sha256")
  mkdir -p "vendor/$kind"
  unzip -q -o "vendor/dl/$f" -d "vendor/$kind"
done
