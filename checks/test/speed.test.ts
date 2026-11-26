import { expect, it } from 'vitest';
import { checkMesh } from '#checks/index';
import { sphere, toPositions } from './shapes';

// The first run includes warm-up, which on a busy CI runner can pass a second on its own,
// so the limit applies to the best of three runs.
it('checks a 200,000 triangle mesh in well under a second', async ({ annotate }) => {
  const positions = toPositions(sphere(50, 400, 251, [0, 0, 50]));
  const first = checkMesh(positions);
  const runs = [first, checkMesh(positions), checkMesh(positions)];
  expect(first.stats.triangles).toBe(200_000);
  expect(first.results.map((r) => r.ok)).toEqual([true, true, false, false]);
  const best = Math.min(...runs.map((r) => r.ms));
  expect(best).toBeLessThan(1000);
  await annotate(`runs: ${runs.map((r) => r.ms.toFixed(0)).join(', ')} ms`);
});
