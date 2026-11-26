import { findBannedCall } from '../scad/guard';

export const MAX_CODE_BYTES = 40_000;

export type Extracted =
  | { ok: true; code: string }
  | { ok: false; problem: 'no-code' | 'too-long' | 'blocked'; message: string; code?: string };

export const NO_CODE_MESSAGE = 'Gemini did not send any OpenSCAD code. Try again, or say it another way.';
export const TOO_LONG_MESSAGE = 'Gemini sent more code than a part needs, so it was not used. Try again.';

const fenceOpen = /^[ \t]*```[ \t]*([\w+-]*)/;
const fenceClose = /^[ \t]*```[ \t]*$/;
const scadTags = new Set(['openscad', 'scad']);

type Block = { tag: string; body: string };

// Every fenced block with its language tag. A block cut off at the end still counts.
function fencedBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = fenceOpen.exec(lines[i]!);
    if (!open) continue;
    let end = i + 1;
    while (end < lines.length && !fenceClose.test(lines[end]!)) end++;
    blocks.push({ tag: open[1]!.toLowerCase(), body: lines.slice(i + 1, end).join('\n') });
    i = end;
  }
  return blocks;
}

// The first block marked as OpenSCAD; failing that, the first one not marked at all.
function codeBlock(text: string): string | null {
  const blocks = fencedBlocks(text);
  const block = blocks.find((item) => scadTags.has(item.tag)) ?? blocks.find((item) => item.tag === '');
  return block ? block.body : null;
}

const shapes = /\b(cube|cylinder|sphere|polygon|polyhedron|square|circle|linear_extrude|rotate_extrude|hull|difference|union)\s*\(/;
const codeStart = /^(\/\/|\/\*|\$?\w+\s*=|module\b|function\b|(translate|rotate|scale|mirror|difference|union|intersection|hull|linear_extrude|rotate_extrude|cube|cylinder|sphere)\s*\()/;

// With no fence, the whole answer is used only when it reads as code from its first line.
function looksLikeScad(text: string): boolean {
  const first = text.trimStart().split('\n', 1)[0] ?? '';
  return shapes.test(text) && text.includes(';') && codeStart.test(first);
}

export function extractCode(answer: string): Extracted {
  const text = answer.replace(/\r\n?/g, '\n');
  let code = codeBlock(text);
  if (code === null && looksLikeScad(text)) code = text;
  code = code?.trim() ?? '';
  if (!code) return { ok: false, problem: 'no-code', message: NO_CODE_MESSAGE };
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) {
    return { ok: false, problem: 'too-long', message: TOO_LONG_MESSAGE };
  }
  code += '\n';
  const banned = findBannedCall(code);
  if (banned) return { ok: false, problem: 'blocked', message: banned, code };
  return { ok: true, code };
}
