// Reads the rows of one split for training or scoring. The test split stays closed until the final run: reading it
// needs final set to true, which only the day 10 run passes (as --final).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Split } from './design.ts';
import type { CreateRow, SetEditRow } from './make.ts';

export const FROZEN = 'The test split is frozen until the final run. Only the final run passes --final to read it.';

export function readSplit(dir: string, split: Split, task: 'create', opts?: { final?: boolean }): CreateRow[];
export function readSplit(dir: string, split: Split, task: 'edit', opts?: { final?: boolean }): SetEditRow[];
export function readSplit(dir: string, split: Split, task: 'create' | 'edit', opts: { final?: boolean } = {}): (CreateRow | SetEditRow)[] {
  if (split === 'test' && opts.final !== true) throw new Error(FROZEN);
  const file = join(dir, split, `${task}.jsonl`);
  if (!existsSync(file)) throw new Error(`There is no ${split} ${task} file in ${dir}.`);
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as CreateRow | SetEditRow);
}
