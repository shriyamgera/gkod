// A rough token count for training rows: the site's system prompt, the words the site sends for the request (or the
// edit), and the answer as one code block, at about 3.5 characters a token. Day 8 measures with the real tokenizer.
import { SYSTEM_INSTRUCTION, userText } from '../../../app/src/engine/prompts.ts';

export const CHARS_PER_TOKEN = 3.5;

/** The answer a training row teaches: the code in one fenced block, as the site reads it. */
export const answerOf = (code: string) => `\`\`\`openscad\n${code.trim()}\n\`\`\``;

export type Chars = { system: number; user: number; answer: number };

export function createChars(row: { request: string; code: string }): Chars {
  return { system: SYSTEM_INSTRUCTION.length, user: userText({ kind: 'create', prompt: row.request }).length, answer: answerOf(row.code).length };
}

export function editChars(row: { instruction: string; a: { code: string }; b: { code: string } }): Chars {
  return {
    system: SYSTEM_INSTRUCTION.length,
    user: userText({ kind: 'edit', instruction: row.instruction, code: row.a.code }).length,
    answer: answerOf(row.b.code).length,
  };
}

export type TokenCount = {
  rows: number;
  chars: Chars & { total: number };
  /** every character / CHARS_PER_TOKEN, rounded */
  tokens: number;
  /** the same without the system prompt, for training that leaves it out of each row */
  tokens_without_system: number;
  /** the answer only: what the loss is taken on when the prompt is masked */
  answer_tokens: number;
};

export function countTokens(chars: Chars[]): TokenCount {
  const sum = { system: 0, user: 0, answer: 0 };
  for (const c of chars) {
    sum.system += c.system;
    sum.user += c.user;
    sum.answer += c.answer;
  }
  const total = sum.system + sum.user + sum.answer;
  const tokens = (n: number) => Math.round(n / CHARS_PER_TOKEN);
  return {
    rows: chars.length,
    chars: { ...sum, total },
    tokens: tokens(total),
    tokens_without_system: tokens(sum.user + sum.answer),
    answer_tokens: tokens(sum.answer),
  };
}
