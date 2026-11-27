// The benchmark harness (ml/bench) reads answers with a Python copy of the site's extractCode. Its test cases carry
// the expected result of each answer; this test checks those results against the site's own code, so the two can
// never drift apart without a failing test.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractCode } from '../../app/src/engine/extract.ts';

type Case = { name: string; answer: string; expected: unknown };

const fixture = new URL('../../ml/bench/tests/fixtures/extract_cases.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(fixture, 'utf8')) as { cases: Case[] };

describe('benchmark extractor cases', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(extractCode(c.answer)).toEqual(c.expected);
  });
});
