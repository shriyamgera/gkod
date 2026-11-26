import { findBannedCall } from '../scad/guard';

export const MAX_CODE_BYTES = 40_000;

export type Extracted =
  | { ok: true; code: string }
  | { ok: false; problem: 'no-code' | 'too-long' | 'blocked'; message: string; code?: string };

export const NO_CODE_MESSAGE = 'Gemini did not send any OpenSCAD code. Try again, or say it another way.';
export const TOO_LONG_MESSAGE = 'Gemini sent more code than a part needs, so it was not used. Try again.';

const fenceOpen = /^[ \t]*```[ \t]*([\w+-]*)/;
const fenceClose = /^[ \t]*```[ \t]*$/;
const scadTags = new Set(['', 'openscad', 'scad']);

// The first fenced block marked as OpenSCAD or not marked at all. A block cut off at the end still counts.
function firstBlock(text: string): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = fenceOpen.exec(lines[i]!);
    if (!open) continue;
    let end = i + 1;
    while (end < lines.length && !fenceClose.test(lines[end]!)) end++;
    if (scadTags.has(open[1]!.toLowerCase())) return lines.slice(i + 1, end).join('\n');
    // a block in another language is skipped as a whole
    i = end;
  }
  return null;
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
  let code = firstBlock(text);
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
