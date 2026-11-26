import { describe, expect, it } from 'vitest';
import { extractCode, MAX_CODE_BYTES } from './extract';
import { SYSTEM_INSTRUCTION, userText } from './prompts';

const part = '// Width (mm)\nwidth = 40; // [20:1:80]\ncube([width, 20, 5]);';

describe('extractCode', () => {
  it('takes an openscad block and drops the words around it', () => {
    const answer = `Here is the part:\n\n\`\`\`openscad\n${part}\n\`\`\`\n\nEnjoy.`;
    expect(extractCode(answer)).toEqual({ ok: true, code: `${part}\n` });
  });

  it('accepts scad and unmarked blocks, and Windows line ends', () => {
    expect(extractCode(`\`\`\`scad\n${part}\n\`\`\``)).toMatchObject({ ok: true, code: `${part}\n` });
    expect(extractCode(`\`\`\`\r\n${part.replace(/\n/g, '\r\n')}\r\n\`\`\``)).toMatchObject({ ok: true, code: `${part}\n` });
  });

  it('uses only the first block', () => {
    const answer = `\`\`\`openscad\n${part}\n\`\`\`\nOr:\n\`\`\`openscad\nsphere(5);\n\`\`\``;
    expect(extractCode(answer)).toMatchObject({ ok: true, code: `${part}\n` });
  });

  it('skips a block in another language', () => {
    const answer = `\`\`\`json\n{"width": 40}\n\`\`\`\n\`\`\`openscad\n${part}\n\`\`\``;
    expect(extractCode(answer)).toMatchObject({ ok: true, code: `${part}\n` });
  });

  it('prefers a block marked as openscad over an earlier unmarked one', () => {
    const answer = `Sizes used:\n\`\`\`\nwidth: 40 mm\n\`\`\`\nCode:\n\`\`\`openscad\n${part}\n\`\`\``;
    expect(extractCode(answer)).toMatchObject({ ok: true, code: `${part}\n` });
  });

  it('keeps a block that was cut off before its closing fence', () => {
    expect(extractCode(`\`\`\`openscad\n${part}`)).toMatchObject({ ok: true, code: `${part}\n` });
  });

  it('uses unfenced text only when it reads as code', () => {
    expect(extractCode(part)).toMatchObject({ ok: true, code: `${part}\n` });
    expect(extractCode('I made a box for you: cube(10); hope it helps')).toMatchObject({ ok: false, problem: 'no-code' });
    expect(extractCode('Sorry, I cannot help with that.')).toMatchObject({ ok: false, problem: 'no-code' });
    expect(extractCode('')).toMatchObject({ ok: false, problem: 'no-code' });
    expect(extractCode('```openscad\n\n```')).toMatchObject({ ok: false, problem: 'no-code' });
  });

  it('refuses code over the size limit', () => {
    const long = `${part}\n${'// filler line\n'.repeat(Math.ceil(MAX_CODE_BYTES / 15))}`;
    expect(extractCode(`\`\`\`openscad\n${long}\n\`\`\``)).toMatchObject({ ok: false, problem: 'too-long' });
  });

  it('marks banned calls as blocked and keeps the code for a repair', () => {
    const banned = 'minkowski() { cube(10); sphere(1); }';
    const result = extractCode(`\`\`\`openscad\n${banned}\n\`\`\``);
    expect(result).toMatchObject({ ok: false, problem: 'blocked', code: `${banned}\n` });
    if (!result.ok) expect(result.message).toMatch(/hull\(\)/);
  });
});

describe('prompts', () => {
  it('asks for named sizes with ranges and lists the banned calls', () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/width = 80; \/\/ \[40:1:160\]/);
    expect(SYSTEM_INSTRUCTION).toMatch(/minkowski\(\)/);
    expect(SYSTEM_INSTRUCTION).toMatch(/text\(\)/);
    expect(SYSTEM_INSTRUCTION).toMatch(/1\.2 mm/);
  });

  it('adds a picture note only when a picture is sent', () => {
    const image = { mimeType: 'image/jpeg' as const, base64: 'AAAA', width: 10, height: 10 };
    expect(userText({ kind: 'create', prompt: ' Phone stand ' })).toBe('Make this part: Phone stand');
    expect(userText({ kind: 'create', prompt: 'Bracket', image })).toMatch(/^Make this part: Bracket\n\nA photo or sketch/);
    expect(userText({ kind: 'create', prompt: '', image })).toMatch(/^A photo or sketch/);
  });

  it('sends the current code with an edit and asks to keep the other sizes', () => {
    const text = userText({ kind: 'edit', instruction: 'make it 10 mm wider', code: part });
    expect(text).toContain(`\`\`\`openscad\n${part}\n\`\`\``);
    expect(text).toContain('Change it like this: make it 10 mm wider');
    expect(text).toMatch(/Keep every other size/);
  });

  it('sends the code, the error and the request with a repair', () => {
    const text = userText({ kind: 'repair', code: part, error: 'Line 3: Unknown variable "depth"', request: 'A box' });
    expect(text).toContain('"A box"');
    expect(text).toContain('Line 3: Unknown variable "depth"');
    expect(text).toContain(part);
  });
});
