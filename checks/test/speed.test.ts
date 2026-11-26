import { expect, it } from 'vitest';
import { checkMesh } from '#checks/index';
import { sphere, toPositions } from './shapes';

it('checks a 200,000 triangle mesh in well under a second', async ({ annotate }) => {
  const positions = toPositions(sphere(50, 400, 251, [0, 0, 50]));
  const first = checkMesh(positions);
  const second = checkMesh(positions);
  expect(first.stats.triangles).toBe(200_000);
  expect(first.results.map((r) => r.ok)).toEqual([true, true, false, false]);
  expect(first.ms).toBeLessThan(1000);
  await annotate(`checked in ${first.ms.toFixed(0)} ms, then ${second.ms.toFixed(0)} ms`);
});
