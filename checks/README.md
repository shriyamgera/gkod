# @gkod/checks

Print checks for a part's mesh. Plain TypeScript with no DOM or Node APIs, so the same code runs in the site's compile worker, in Node and in the tests.

```ts
import { checkMesh, checkStl } from '@gkod/checks';

const report = checkStl(stlBytes, { bed: { x: 256, y: 256, z: 256 }, overhangDeg: 45 });
report.ok; // true when every check passes
report.results; // closed, fits-bed, flat-base, overhang, always in that order
```

`checkMesh` takes separate triangles, nine numbers each (what `parseStl` in the app returns). `checkStl` takes a binary STL file.

## The checks

| Check | Passes when |
|---|---|
| Solid, no holes | After joining corners closer than 0.0001 mm, every edge is shared by exactly two triangles that run along it in opposite directions, and the enclosed volume is above zero. Each separate piece faces outwards, or inwards when it is the wall of a hollow inside another piece. |
| Fits your printer | The part's size in X, Y and Z is within the bed. |
| Sits flat on the bed | The downward faces in the lowest 0.05 mm add up to at least 20 mm² and at least 1% of the footprint. A small part passes if half its footprint is flat. The lowest point counts as the bed, since the slicer drops a part onto it. |
| No steep overhangs | No patch of faces underneath that leans more than 45 degrees from vertical is both at least 20 mm² and more than 5 mm from a wall that holds it up. So a 10 mm bridge and the top of a hole up to about 13 mm across pass. A wall holds a patch up only as well as it is held up itself: one that hangs from another overhang carries on that overhang's reach, less the height it rises (a 45 degree slope reaches out as far as it rises). A patch with nothing holding it up, such as the bottom of a piece floating in the air, fails at any size. Faces within 1 mm of the bed are left out: they sag onto it. |

Every threshold, with the reason for its value, is in [src/limits.ts](src/limits.ts).

A failed check has a plain sentence in `detail` and an instruction for the engine in `fix`. The overhang check also lists the triangles to mark in `triangles`, and in `at` the point of the biggest problem area that is farthest from what holds it up (its middle, when nothing holds it up).

## Command

```sh
npx gkod-check part.stl [more.stl ...] [--bed 256x256x256] [--overhang 45] [--json]
```

`--json` prints one report per line. The exit code is 0 when every file passes, 1 when a check fails and 2 when a file cannot be read.

## Tests

`npm test` runs the same test files in Node and in headless Chrome (Vitest browser mode). It uses the Google Chrome installed on the machine and downloads no browser, so Chrome must be installed (or run `npx playwright install chrome`). The STL files in `test/fixtures` are the built-in examples at their default sizes; `npm run fixtures` rebuilds them.
