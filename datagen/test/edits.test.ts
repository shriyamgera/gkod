import { describe, expect, it } from 'vitest';
import { envOf } from '../src/model.ts';
import { modelOf } from '../src/part.ts';
import { plan, type Row } from '../src/run.ts';
import { num } from '../src/scad.ts';
import { check } from '../src/validate.ts';
import { NUMBER_WORDS } from '../src/words.ts';
import { buildB, diffSizes, sideOf, titleOf } from '../src/edits/build.ts';
import { stepsOf } from '../src/edits/ops.ts';
import { type Pair, planPair } from '../src/edits/pair.ts';

const generator = { name: 'gkod-datagen', version: '0.1.0', commit: 'test', dirty: false };

/** The families the edits were written for: the day 6 set. */
const KNOWN = new Set(['plate', 'bracket', 'channel', 'tray', 'spacer', 'hook', 'knob', 'clip']);

/** Parts as a run writes them, without the compiler: labels are not read by the edits. */
function sources(seed: number, count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; rows.length < count; i++) {
    const planned = plan(seed, i, generator);
    if (planned.row && KNOWN.has(planned.row.family)) rows.push({ ...planned.row, labels: {} as Row['labels'] });
  }
  return rows;
}

// The same line the app counts as a size: a top-level number with a customizer range.
const SIZE_LINE = /^([a-z_]\w*) = (-?[\d.]+); \/\/ \[(-?[\d.]+):([\d.]+):(-?[\d.]+)\]$/;

/** The size block of a code file: name, caption line and the whole size line. */
function sizeBlock(code: string) {
  const lines = code.split('\n');
  const out: { name: string; value: number; caption: string; line: string }[] = [];
  for (let i = 2; lines[i]?.startsWith('// '); i += 2) {
    const m = SIZE_LINE.exec(lines[i + 1]!);
    expect(m, lines[i + 1]).not.toBeNull();
    out.push({ name: m![1]!, value: Number(m![2]), caption: lines[i]!.slice(3), line: lines[i + 1]! });
  }
  return out;
}

const rows = sources(21, 600);
const options = { seed: 3, generator, sources: rows, fileSha256: 'test' };
const pairs: Pair[] = Array.from({ length: 400 }, (_, i) => planPair(options, i).pair!).filter(Boolean);

describe('the edited part', () => {
  it('gets the title the request would give it, counting its holes', () => {
    for (const row of rows) expect(titleOf(row, row.tree), row.id).toBe(row.title);
    const plate = rows.find((row) => /^Mounting plate with/.test(row.title))!;
    expect(titleOf(plate, { ...plate.tree, features: [] })).toBe('Plate');
    const holes = pairs.find((pair) => pair.op.kind === 'count' && pair.op.name === null && pair.op.feature === 'holes' && pair.op.to === 2);
    if (holes && holes.a.title.includes(' with a hole')) expect(holes.b.title).toMatch(/ with (two|2) holes$/);
  });

  it('refuses a tree that breaks a rule, with the reason', () => {
    const row = rows.find((r) => r.tree.body.kind === 'plate')!;
    const side = sideOf(row.tree);
    if ('reason' in side) throw new Error(side.reason);
    const broken = structuredClone(row.tree);
    if (broken.body.kind === 'plate') broken.body.thickness = 0.5;
    expect(buildB(row, side.params, broken)).toEqual({ reason: expect.stringMatching(/thickness/i) });
  });

  it('keeps every slider usable anywhere in its range, whether the range was kept or worked out afresh', () => {
    for (const pair of pairs.slice(0, 150)) {
      const model = modelOf(pair.b.tree);
      for (const s of sizeBlock(pair.b.code)) {
        const m = SIZE_LINE.exec(s.line)!;
        for (const value of stepsOf({ name: s.name, caption: s.caption, value: s.value, min: Number(m[3]), step: Number(m[4]), max: Number(m[5]) })) {
          expect(check(model, envOf(model, { [s.name]: value })), `${pair.id} ${s.name}=${value}`).toEqual([]);
        }
      }
    }
  });

  it('lists how two size blocks differ', () => {
    const a = [{ name: 'w', value: 1 }, { name: 'd', value: 2 }, { name: 'gone', value: 3 }];
    const b = [{ name: 'w', value: 1 }, { name: 'd', value: 4 }, { name: 'new', value: 5 }];
    expect(diffSizes(a, b)).toEqual({
      changed: [{ name: 'd', from: 2, to: 4 }],
      added: [{ name: 'new', value: 5 }],
      removed: [{ name: 'gone', value: 3 }],
      kept: [{ name: 'w', value: 1 }],
    });
  });
});

describe('edit pairs', () => {
  it('are made for nearly every index, with every kind of edit', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(395);
    const kinds = new Set(pairs.map((pair) => pair.op.kind));
    expect([...kinds].sort()).toEqual(['add', 'count', 'hole_d', 'move', 'remove', 'scale', 'size']);
    expect(new Set(pairs.map((pair) => pair.family))).toEqual(KNOWN);
  });

  it('keep every unchanged size: same name, caption and value in code A and code B', () => {
    for (const pair of pairs) {
      const a = sizeBlock(pair.a.code);
      const b = sizeBlock(pair.b.code);
      expect(diffSizes(a, b), pair.id).toEqual({ changed: pair.facts.changed, added: pair.facts.added, removed: pair.facts.removed, kept: pair.facts.kept });
      for (const k of pair.facts.kept) {
        const [x, y] = [a.find((s) => s.name === k.name)!, b.find((s) => s.name === k.name)!];
        expect([y.caption, y.value], `${pair.id} ${k.name}`).toEqual([x.caption, x.value]);
      }
      // one named size moved inside its range keeps every slider range as it was
      if ('mode' in pair.op && pair.op.kind !== 'count') {
        expect(pair.facts.changed.map((c) => c.name)).toEqual([pair.op.name]);
      }
      expect(pair.b.tree_sha256).not.toBe(pair.a.tree_sha256);
      expect(pair.b.code.startsWith(`// ${pair.b.title}\n\n`)).toBe(true);
    }
  });

  it('change only the edited size line when one size moves inside its range, and a range only where the old one no longer holds', () => {
    const one = pairs.filter((pair) => pair.op.kind === 'size' || pair.op.kind === 'hole_d' || pair.op.kind === 'move');
    expect(one.length).toBeGreaterThan(100);
    let untouched = 0;
    for (const pair of one) {
      const name = (pair.op as { name: string }).name;
      const a = pair.a.code.split('\n');
      const b = pair.b.code.split('\n');
      expect(b.length, pair.id).toBe(a.length);
      const changed = b.map((line, i) => [a[i]!, line] as const).filter(([x, y]) => x !== y);
      expect(changed.filter(([, y]) => y.startsWith(`${name} = `)), pair.id).toHaveLength(1);
      // any other line that changed is a size line whose name and value stay: only its slider range moved
      for (const [x, y] of changed.filter(([, line]) => !line.startsWith(`${name} = `))) {
        expect(y.split(' // ')[0], `${pair.id}: ${pair.instruction}`).toBe(x.split(' // ')[0]);
        expect(y).toMatch(SIZE_LINE);
      }
      if (changed.length === 1) untouched++;
    }
    // most edits leave every other line exactly as it was
    expect(untouched / one.length).toBeGreaterThan(0.6);
  });

  it('state every changed number in the instruction', () => {
    for (const pair of pairs) {
      const text = pair.instruction;
      expect(text, pair.id).not.toMatch(/undefined|NaN|\s\s|\s[,.?]/);
      // a count in digits never sits right before a size
      expect(text, pair.id).not.toMatch(/\b\d+ \d/);
      for (const fact of pair.facts.stated) {
        // an edit by an amount says the amount; the fact is the size it gives
        const by = 'mode' in pair.op && pair.op.mode === 'by' && fact.key === pair.op.name;
        const value = by ? Math.abs((pair.op as { to: number }).to - (pair.op as { from: number }).from) : fact.value;
        if (fact.unit === 'mm' && (by || pair.op.kind !== 'scale')) expect(text, `${pair.id} ${fact.key}`).toMatch(new RegExp(`(^|[^\\d.])${num(value).replace('.', '\\.')}( ?mm| x| by|x)`));
        if (fact.unit === 'count' && fact.value > 0 && !text.toLowerCase().startsWith('remove') && !/fewer|another|more|a (second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)/.test(text)) {
          const said = [String(fact.value), NUMBER_WORDS[fact.value]!, ...(fact.value === 1 ? ['a', 'one'] : [])];
          expect(said.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text)), `${fact.key} in "${text}"`).toBe(true);
        }
        if (fact.unit === 'ratio') {
          expect(text).toMatch(/%|twice|1\.5 times|three quarters/i);
          // every scale is said of what it scales, from the word list; none is a fixed sentence
          expect(text, pair.id).toMatch(/\b(it|the whole part|everything)\b/i);
        }
      }
    }
  });

  it('say the stated value of every changed size and the stated overall size on its axis', () => {
    for (const pair of pairs) {
      const op = pair.op;
      if (!('mode' in op)) continue;
      const fact = pair.facts.stated.find((f) => f.key === op.name || f.key === 'compartment_count')!;
      expect(fact.value, pair.id).toBe(op.kind === 'count' && fact.key === 'compartment_count' ? op.to + 1 : op.to);
    }
    const wider = pairs.find((pair) => 'name' in pair.op && pair.op.name === 'width' && pair.family === 'plate');
    if (wider) expect(wider.facts.stated[0]!.axis).toBe('x');
  });

  it('carry their provenance', () => {
    for (const pair of pairs) {
      const row = rows.find((r) => r.id === pair.source.id)!;
      expect(pair.source).toEqual({ id: row.id, seed: row.seed, part_seed: row.part_seed, generator: row.generator, file_sha256: 'test' });
      expect(pair.a.tree_sha256).toBe(row.tree_sha256);
      expect(pair.generator).toEqual(generator);
      expect(pair.id).toBe(`e3-${String(pair.index).padStart(6, '0')}`);
    }
  });

  it('are the same for the same seed and index, and different for another seed', () => {
    for (const i of [0, 7, 99]) expect(planPair(options, i)).toEqual(planPair({ ...options, sources: structuredClone(rows) }, i));
    const other = Array.from({ length: 20 }, (_, i) => planPair({ ...options, seed: 4 }, i).pair?.instruction);
    expect(other).not.toEqual(pairs.slice(0, 20).map((pair) => pair.instruction));
  });

  it('never make a part another split holds', () => {
    const first = pairs.slice(0, 30);
    const avoid = new Set(first.map((pair) => pair.b.tree_sha256));
    for (const [i, pair] of first.entries()) {
      const again = planPair({ ...options, avoid }, pair.index);
      if (again.pair) expect(avoid.has(again.pair.b.tree_sha256), `pair ${i}`).toBe(false);
    }
  });
});
