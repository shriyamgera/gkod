#!/bin/sh
# Builds the Kiri:Moto slicing engine from a pinned source commit into app/public/kiri/.
# The bundles are about 4 MB each, so they are not committed.
#
# Pinned to the tip of branch rel-4.7 on 26 Nov 2026 (version 4.7.4 in its package.json). It is
# the newest 4.7 patch release and the exact source the slicer test in spikes/kiri-slicer measured.
# The last tag, 4.7.3, is older and was never tested here.
set -eu

COMMIT=47efc37eca9a387dfdcd2990273fae6b9680cb64
SHA256=23a0fd92804b57a9ef4abdf297fe39733d106d56d65636b12a6ef8a3283a84db
URL="https://codeload.github.com/GridSpace/grid-apps/tar.gz/$COMMIT"

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/app/public/kiri"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Kiri:Moto source at $COMMIT"
curl -sSfL -o "$tmp/source.tgz" "$URL"

actual="$(shasum -a 256 "$tmp/source.tgz" | cut -d' ' -f1)"
if [ "$actual" != "$SHA256" ]; then
  echo "sha256 mismatch for the Kiri:Moto source" >&2
  echo "  expected $SHA256" >&2
  echo "  got      $actual" >&2
  exit 1
fi

# The libraries the engine bundles, at the versions in scripts/kiri/package-lock.json. No install scripts run.
mkdir "$tmp/deps"
cp "$root/scripts/kiri/package.json" "$root/scripts/kiri/package-lock.json" "$tmp/deps/"
(cd "$tmp/deps" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)

# docs/ is 53 MB of website content the engine does not use
mkdir "$tmp/src"
tar xzf "$tmp/source.tgz" -C "$tmp/src" --strip-components=1 --exclude='*/docs/*'
ln -s "$tmp/deps/node_modules" "$tmp/src/node_modules"

node "$root/scripts/kiri/build.mjs" "$tmp/src" "$dest" "$COMMIT"
echo "Kiri:Moto engine is in app/public/kiri/ (sha256, bytes, file above)"
