#!/bin/sh
# Fetch Kiri:Moto source (GridSpace/grid-apps, MIT) and build only the slicing
# engine as static files into ./kiri/ . Uses esbuild only (no webpack, no electron).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="${KIRI_REF:-rel-4.7}"
W="$HERE/.work"
mkdir -p "$W" && cd "$W"
if [ ! -d "grid-apps-$REF" ]; then
  curl -sL -o ga.tgz "https://codeload.github.com/GridSpace/grid-apps/tar.gz/refs/heads/$REF"
  # docs/ is 53 MB of website content that we do not need
  tar xzf ga.tgz --exclude='*/docs/*'
  rm ga.tgz
fi
cd "grid-apps-$REF"
# hide upstream package.json so npm installs only the packages named below
[ -f package.json ] && mv package.json package.upstream.json
echo '{"name":"kiri-engine-build","private":true}' > package.json
# only the libraries the engine + worker import (the full upstream package.json pulls electron, docusaurus, ...)
npm install --ignore-scripts --no-audit --no-fund --no-save \
  esbuild@0.25.5 three@0.182.0 three-mesh-bvh@0.7.6 jszip@3.10.1 earcut@3.0.1 \
  base64-js@1.5.1 manifold-3d@3.3.2 @tweenjs/tween.js@16.6.0 \
  @tracespace/parser@5.0.0-next.0 @gridspace/raster-path@1.1.1 quickjs-emscripten@0.20.0
node "$HERE/build-kiri.mjs" "$PWD" "$HERE/kiri"
