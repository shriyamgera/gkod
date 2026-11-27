import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTION, userText } from '../../app/src/engine/prompts.ts';
import { parseCommand, UsageError } from '../src/args.ts';
import { parseJob, runBatch } from '../src/batch.ts';
import { PRINTERS } from '../src/printers.ts';

const bed = PRINTERS.kobra2neo!.bed;
const part = '// Width (mm)\nwidth = 40; // [20:1:80]\ncube([width, 20, 5]);\n';

async function* from(lines: string[]) {
  yield* lines;
}

async function run(jobs: unknown[], workers = 2) {
  const out: string[] = [];
  await runBatch(from(jobs.map((job) => (typeof job === 'string' ? job : JSON.stringify(job)))), (line) => out.push(line), { workers, bed });
  return out.map((line) => JSON.parse(line) as Record<string, any>);
}

describe('batch options', () => {
  it('reads workers and the printer', () => {
    expect(parseCommand(['batch'])).toEqual({ command: 'batch', workers: 4, printer: 'kobra2neo', bed });
    expect(parseCommand(['batch', '--workers', '8', '--printer', 'mk4'])).toMatchObject({ workers: 8, printer: 'mk4' });
    expect(() => parseCommand(['batch', '--workers', '0'])).toThrow(UsageError);
    expect(() => parseCommand(['batch', 'jobs.jsonl'])).toThrow(/standard input/);
  });
});

describe('parseJob', () => {
  it('refuses lines that are not jobs', () => {
    expect(parseJob('not json')).toEqual({ id: null, error: expect.stringMatching(/JSON/) });
    expect(parseJob('{"op": "compile", "code": "cube(1);"}')).toEqual({ id: null, error: expect.stringMatching(/id/) });
    expect(parseJob('{"id": "a", "op": "slice"}')).toEqual({ id: 'a', error: expect.stringMatching(/Unknown op/) });
    expect(parseJob('{"id": "a", "op": "compile", "code": "cube(1);", "defines": {"w": "big"}}')).toMatchObject({ id: 'a' });
    expect(parseJob('{"id": "a", "op": "prompt", "request": {"kind": "repair"}}')).toMatchObject({ error: expect.stringMatching(/create/) });
  });
});

describe('runBatch', () => {
  it('gives the site prompt for a create and an edit, and a training-style answer', async () => {
    const [create, edit] = await run([
      { id: 'c', op: 'prompt', request: { kind: 'create', prompt: ' A box ' }, answer: part },
      { id: 'e', op: 'prompt', request: { kind: 'edit', instruction: 'make it 10 mm wider', code: part } },
    ]);
    expect(create).toEqual({ id: 'c', op: 'prompt', system: SYSTEM_INSTRUCTION, user: 'Make this part: A box', answer: `\`\`\`openscad\n${part.trim()}\n\`\`\`` });
    expect(edit!.user).toBe(userText({ kind: 'edit', instruction: 'make it 10 mm wider', code: part }));
    expect(edit!.answer).toBeUndefined();
  });

  it('compiles, writes the STL, checks it and answers bad lines without stopping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gkod-batch-'));
    const stl = join(dir, 'a.stl');
    const replies = await run([
      { id: 'a', op: 'compile', code: part, stl },
      'nonsense',
      { id: 'b', op: 'compile', code: part, defines: { width: 60 }, check: false },
      { id: 'c', op: 'compile', code: 'cube([10, 10, 10]);\nundefined_name + 1;\nsphere(r = nope);' },
    ]);
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
    expect(replies).toHaveLength(4);
    expect(byId.null).toMatchObject({ op: null, error: expect.stringMatching(/JSON/) });
    expect(byId.a).toMatchObject({ ok: true, error: null, triangles: 12, stl, checks: { ok: true, stats: { size: [40, 20, 5] } } });
    expect(byId.a!.params).toEqual([{ name: 'width', caption: 'Width (mm)', value: 40, min: 20, step: 1, max: 80 }]);
    expect(existsSync(stl)).toBe(true);
    expect(readFileSync(stl).length).toBe(84 + 50 * 12);
    expect(byId.a!.stl_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(byId.b).toMatchObject({ ok: true, stl: null, checks: null });
    expect(byId.b!.params[0].value).toBe(60);
    expect(byId.c).toMatchObject({ ok: false, stl: null, checks: null });
    expect(byId.c!.error).toEqual(expect.any(String));
  }, 60000);

  it('runs as a command over standard input', () => {
    const bin = fileURLToPath(new URL('../bin/gkod.mjs', import.meta.url));
    const input = [JSON.stringify({ id: 'p', op: 'prompt', request: { kind: 'create', prompt: 'A box' } }), JSON.stringify({ id: 'k', op: 'compile', code: 'cube(5);' })].join('\n');
    const out = execFileSync(process.execPath, [bin, 'batch', '--workers', '1'], { input, encoding: 'utf8' });
    const replies = out.trim().split('\n').map((line) => JSON.parse(line));
    expect(replies.map((r) => r.id).sort()).toEqual(['k', 'p']);
    expect(replies.find((r) => r.id === 'k')).toMatchObject({ ok: true, checks: { ok: true } });
  }, 60000);
});
