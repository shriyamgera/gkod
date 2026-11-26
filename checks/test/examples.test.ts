import { describe, expect, it } from 'vitest';
import { checkStl } from '#checks/index';
import cableClip from './fixtures/cable_clip.stl?inline';
import phoneStand from './fixtures/phone_stand.stl?inline';
import wallHook from './fixtures/wall_hook.stl?inline';
import cableClipSource from '../../app/src/examples/cable_clip.scad?raw';
import phoneStandSource from '../../app/src/examples/phone_stand.scad?raw';
import wallHookSource from '../../app/src/examples/wall_hook.scad?raw';
import sources from './fixtures/sources.json';

function bytes(dataUrl: string): Uint8Array {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

// FNV-1a, as in scripts/make-fixtures.mjs
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

// The built-in examples at their default sizes, compiled by scripts/make-fixtures.mjs.
// They were drawn to print without supports, so every check must pass.
const examples = [
  { id: 'phone_stand', stl: phoneStand, source: phoneStandSource, triangles: 80, size: [80, 90, 103.4] },
  { id: 'wall_hook', stl: wallHook, source: wallHookSource, triangles: 756, size: [35, 80, 20] },
  { id: 'cable_clip', stl: cableClip, source: cableClipSource, triangles: 400, size: [20, 9.9, 12] },
] as const;

describe('built-in examples', () => {
  it('has fixtures made from the current example code (else run: npm run fixtures --workspace checks)', () => {
    for (const example of examples) expect(hash(example.source), example.id).toBe(sources[example.id]);
  });

  for (const example of examples) {
    it(`passes every check for the ${example.id.replace('_', ' ')}`, () => {
      const report = checkStl(bytes(example.stl));
      expect(report.results.filter((r) => !r.ok)).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.stats.triangles).toBe(example.triangles);
      expect(report.stats.size.map((side) => Math.round(side * 10) / 10)).toEqual(example.size);
    });
  }
});
