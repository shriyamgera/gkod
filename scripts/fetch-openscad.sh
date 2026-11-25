#!/bin/sh
# Downloads the pinned official OpenSCAD web build and unpacks it into app/public/openscad/.
# The files are not committed: openscad.wasm is 11 MB.
set -eu

VERSION=2026.11.23
SHA256=198d08ef3a1c064fcc208df523af1f5461b35f3f87b91f5a671704803deaf09d
ZIP="OpenSCAD-$VERSION-WebAssembly-web.zip"
URL="https://files.openscad.org/snapshots/$ZIP"

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/app/public/openscad"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $URL"
curl -sSfL -o "$tmp/$ZIP" "$URL"

actual="$(shasum -a 256 "$tmp/$ZIP" | cut -d' ' -f1)"
if [ "$actual" != "$SHA256" ]; then
  echo "sha256 mismatch for $ZIP" >&2
  echo "  expected $SHA256" >&2
  echo "  got      $actual" >&2
  exit 1
fi

mkdir -p "$dest"
unzip -q -o "$tmp/$ZIP" openscad.js openscad.wasm -d "$dest"
echo "OpenSCAD $VERSION web build is in app/public/openscad/"
ls -l "$dest"
