import { describe, expect, it } from 'vitest';
import { findBannedCall } from '../../app/src/scad/guard.ts';
import { checkStl } from '@gkod/checks';
import { compileScad } from '../../tools/src/compile.ts';
import { PRINTERS } from '../../tools/src/printers.ts';
import { FAMILIES, sampleTree } from '../src/families/index.ts';
import { Rng } from '../src/rng.ts';
import { serialize, type Written } from '../src/serialize.ts';
import type { Tree } from '../src/tree.ts';
import { validate } from '../src/validate.ts';

// The same line the app counts as a size: a top-level number with a customizer range.
const SIZE_LINE = /^([a-z_]\w*) = (-?[\d.]+); \/\/ \[(-?[\d.]+):([\d.]+):(-?[\d.]+)\]$/;

function written(tree: Tree, title = 'Test part'): Written {
  const result = serialize(tree, title);
  if ('reason' in result) throw new Error(result.reason);
  return result;
}

function samples(seed: number, count: number): Tree[] {
  const run = new Rng(seed);
  const trees: Tree[] = [];
  for (let i = 0; trees.length < count; i++) {
    const tree = sampleTree(run.child(i));
    if (validate(tree).length === 0 && !('reason' in serialize(tree, 'x'))) trees.push(tree);
  }
  return trees;
}

/** Reads the size block the way the customizer does: a caption comment line, then the number and its range. */
function sizeBlock(code: string) {
  const lines = code.split('\n');
  expect(lines[0]).toMatch(/^\/\/ \S/);
  expect(lines[1]).toBe('');
  const sizes = [];
  let i = 2;
  while (lines[i]?.startsWith('// ')) {
    const caption = lines[i]!.slice(3);
    const match = SIZE_LINE.exec(lines[i + 1] ?? '');
    expect(match, `line ${i + 2}: ${lines[i + 1]}`).not.toBeNull();
    const [, name, value, min, step, max] = match!;
    sizes.push({ name: name!, value: Number(value), min: Number(min), step: Number(step), max: Number(max), caption });
    i += 2;
  }
  return { sizes, rest: lines.slice(i) };
}

describe('serialize', () => {
  const trees = samples(3, 240);

  it('writes the size block in the site format for every family', () => {
    const families = new Set<string>();
    for (const tree of trees) {
      families.add(tree.family);
      const { code, params } = written(tree);
      const { sizes, rest } = sizeBlock(code);
      expect(sizes).toEqual(params);
      expect(sizes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(sizes.map((s) => s.name)).size).toBe(sizes.length);
      for (const s of sizes) {
        expect(s.caption).toMatch(/^[A-Z][^()]*( \(mm\))?$/);
        expect(s.min).toBeLessThan(s.max);
        expect(s.value).toBeGreaterThanOrEqual(s.min);
        expect(s.value).toBeLessThanOrEqual(s.max);
        // the value and the top end are reachable from the bottom end in whole steps
        for (const end of [s.value, s.max]) expect(Math.abs((end - s.min) / s.step - Math.round((end - s.min) / s.step))).toBeLessThan(1e-6);
        // every size does something: it is used below the size block
        expect(rest.join('\n')).toMatch(new RegExp(`\\b${s.name}\\b`));
      }
      // the hidden block, when there is anything to hide, comes straight after the sizes
      expect(rest[0]).toBe('');
      expect(rest[1]).toMatch(/^(\/\* \[Hidden\] \*\/|module \w+\(\) \{)$/);
      expect(rest.slice(2).join('\n')).not.toContain('[Hidden]');
    }
    expect(families.size).toBe(FAMILIES.length);
  });

  it('uses only allowed calls and no other files', () => {
    for (const tree of trees) {
      const { code } = written(tree);
      expect(findBannedCall(code)).toBeNull();
      expect(code).not.toMatch(/\b(minkowski|text|import|surface)\s*\(|^\s*(include|use)\b/m);
      expect(code.split('\n').length).toBeLessThan(150);
    }
  });

  it('gives the same code for the same tree and title', () => {
    for (const tree of trees.slice(0, 20)) {
      expect(written(structuredClone(tree)).code).toBe(written(tree).code);
    }
  });

  it('marks how finely curves are drawn only when there are curves', () => {
    const block: Tree = { family: 'test', body: { kind: 'angle', width: 30, base: 40, height: 40, thickness: 4 }, features: [] };
    expect(written(block).code).not.toContain('$fn');
    const hex: Tree = { family: 'test', body: { kind: 'round', diameter: 10, height: 12, bore: 4, hex: true }, features: [] };
    expect(written(hex).code).toContain('cylinder(d = across_flats / cos(30), h = height, $fn = 6);');
    expect(written(hex).code).toContain('$fn = 48;');
  });
});

// One part per family through the real compiler, as the site and the gkod command compile it.
describe('serialized parts compile and pass the print checks', () => {
  const run = new Rng(17);
  const picks = FAMILIES.map((family) => {
    for (let i = 0; ; i++) {
      const tree = family.sample(run.child(i));
      if (validate(tree).length || tree.features.length === 0) continue;
      const result = serialize(tree, `${family.id} test`);
      if (!('reason' in result)) return [family.id, result] as const;
    }
  });

  const bed = PRINTERS.kobra2neo!.bed;

  it.each(picks)('%s: the compiled sizes match the size block, and the part passes', async (_, part) => {
    const result = await compileScad(part.code);
    expect(result.error).toBeNull();
    expect(result.params).toEqual(part.params);
    expect(checkStl(result.stl!, { bed }).results.filter((check) => !check.ok)).toEqual([]);
  }, 30000);

  it.each(picks)('%s: still compiles and passes at both ends of every slider', async (_, part) => {
    const ends = part.params.flatMap((p) => [{ [p.name]: p.min }, { [p.name]: p.max }]);
    for (let i = 0; i < ends.length; i += 8) {
      const batch = await Promise.all(ends.slice(i, i + 8).map((defines) => compileScad(part.code, defines)));
      batch.forEach((result, j) => {
        const where = JSON.stringify(ends[i + j]);
        expect(result.error, where).toBeNull();
        const failed = checkStl(result.stl!, { bed }).results.filter((check) => !check.ok);
        expect(failed.map((check) => `${where} ${check.title}: ${check.detail}`)).toEqual([]);
      });
    }
  }, 120000);
});

// The bodies and features the newer families are built from, each from a fixed tree, through the real compiler.
describe('newer bodies and features compile and pass the print checks', () => {
  const holes = (face: string, d: number, countersink: boolean, place: Extract<Tree['features'][number], { kind: 'holes' }>['place']) =>
    ({ kind: 'holes', face, d, countersink, place }) as const;
  const trees: [string, Tree][] = [
    ['disc with a rim', { family: 'test', body: { kind: 'disc', diameter: 90, thickness: 4 }, features: [{ kind: 'lip', height: 2, wall: 2 }] }],
    ['saddle', { family: 'test', body: { kind: 'saddle', pipe: 22, thickness: 3, foot: 14, width: 20 }, features: [holes('feet', 4, false, { pattern: 'pair', spacing: 42 })] }],
    [
      'handle with grooves',
      { family: 'test', body: { kind: 'handle', spacing: 96, length: 130, height: 30, grip: 10, post: 12, width: 14, screw: 3.5, screwDepth: 12 }, features: [{ kind: 'grooves', count: 4, d: 10 }] },
    ],
    ['foot', { family: 'test', body: { kind: 'foot', diameter: 30, top: 22, height: 12 }, features: [holes('top', 4, true, { pattern: 'center' })] }],
    ['sleeve with a flange', { family: 'test', body: { kind: 'sleeve', diameter: 60, wall: 2, height: 20 }, features: [{ kind: 'flange', d: 84, thickness: 3, holes: 3, hole: 4 }] }],
    ['hex cup', { family: 'test', body: { kind: 'cup', diameter: 70, height: 90, wall: 2, floor: 2.4, sides: 6 }, features: [holes('floor', 5, false, { pattern: 'grid', x: 20, y: 20 })] }],
    [
      'comb',
      { family: 'test', body: { kind: 'comb', width: 100, depth: 35, thickness: 4, slots: 8, slot: 6, slotDepth: 18 }, features: [holes('spine', 4, true, { pattern: 'pair', spacing: 60 })] },
    ],
    [
      'corner plate',
      {
        family: 'test',
        body: { kind: 'corner', length: 80, arm: 18, thickness: 4 },
        features: [holes('arm1', 4, false, { pattern: 'pair', spacing: 20 }), holes('arm2', 4, false, { pattern: 'pair', spacing: 20 })],
      },
    ],
    ['slotted washer', { family: 'test', body: { kind: 'round', diameter: 20, height: 2, bore: 8.5, hex: false }, features: [{ kind: 'slit' }] }],
    [
      'hex sockets',
      { family: 'test', body: { kind: 'plate', width: 80, depth: 40, thickness: 12, corner: 'round', cornerSize: 4 }, features: [{ kind: 'sockets', columns: 6, rows: 3, d: 6.8, depth: 9, pitch: 11, hex: true }] },
    ],
    [
      'standoffs in a box',
      {
        family: 'test',
        body: { kind: 'box', width: 100, depth: 70, height: 30, wall: 2, floor: 2.4, corner: 'round', cornerSize: 4 },
        features: [{ kind: 'bosses', d: 7, height: 6, hole: 3, place: { pattern: 'grid', x: 60, y: 40 } }],
      },
    ],
  ];

  const bed = PRINTERS.kobra2neo!.bed;

  it.each(trees)('%s', async (_, tree) => {
    expect(validate(tree)).toEqual([]);
    const part = written(tree);
    const result = await compileScad(part.code);
    expect(result.error).toBeNull();
    expect(result.params).toEqual(part.params);
    expect(checkStl(result.stl!, { bed }).results.filter((check) => !check.ok)).toEqual([]);
  }, 30000);
});
