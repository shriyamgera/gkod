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
