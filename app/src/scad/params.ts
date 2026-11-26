import type { Param } from './types';

type ExportedParam = {
  name?: unknown;
  type?: unknown;
  initial?: unknown;
  min?: unknown;
  max?: unknown;
  step?: unknown;
  caption?: unknown;
  options?: unknown;
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function decimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot < 0 || text.includes('e') ? 0 : Math.min(text.length - dot - 1, 4);
}

function tidy(value: number): number {
  return Number(value.toFixed(6));
}

// A number written without a range still needs slider ends: half to double, in steps that match how it was written.
function guessRange(value: number): { min: number; max: number; step: number } {
  const step = 10 ** -decimals(value);
  if (value === 0) return { min: -10, max: 10, step };
  const low = Math.floor(Math.min(value / 2, value * 2) / step) * step;
  const high = Math.ceil(Math.max(value / 2, value * 2) / step) * step;
  return { min: tidy(low), max: tidy(high), step };
}

function optionRange(options: unknown): { min: number; max: number; step: number } | null {
  if (!Array.isArray(options)) return null;
  const values = options
    .map((option) => (option as { value?: unknown } | null)?.value)
    .filter(isNumber)
    .sort((a, b) => a - b);
  if (values.length < 2 || values.length !== options.length) return null;
  let step = Infinity;
  for (let i = 1; i < values.length; i++) {
    const gap = values[i]! - values[i - 1]!;
    if (gap > 0) step = Math.min(step, gap);
  }
  if (!Number.isFinite(step)) return null;
  return { min: values[0]!, max: values[values.length - 1]!, step: tidy(step) };
}

function toParam(entry: ExportedParam): Param | null {
  if (typeof entry.name !== 'string' || entry.type !== 'number' || !isNumber(entry.initial)) return null;
  // $fn and the other special variables set how finely curves are drawn; they are not sizes
  if (entry.name.startsWith('$')) return null;
  const value = entry.initial;
  let range: { min: number; max: number; step: number };
  if (isNumber(entry.min) && isNumber(entry.max) && entry.min < entry.max) {
    const step = isNumber(entry.step) && entry.step > 0 ? entry.step : 1;
    range = { min: entry.min, max: entry.max, step };
  } else {
    range = optionRange(entry.options) ?? guessRange(value);
  }
  const param: Param = { name: entry.name, value, ...range };
  if (typeof entry.caption === 'string' && entry.caption.trim()) param.caption = entry.caption.trim();
  return param;
}

// Reads the JSON written by OpenSCAD's "param" export and keeps the plain numbers.
export function parseParams(exported: string | unknown): Param[] {
  let data: unknown = exported;
  if (typeof exported === 'string') {
    try {
      data = JSON.parse(exported);
    } catch {
      return [];
    }
  }
  const list = (data as { parameters?: unknown } | null)?.parameters;
  if (!Array.isArray(list)) return [];
  const params: Param[] = [];
  for (const entry of list) {
    const param = entry && typeof entry === 'object' ? toParam(entry as ExportedParam) : null;
    if (param) params.push(param);
  }
  return params;
}

export function applyOverrides(params: Param[], overrides: Record<string, number> = {}): Param[] {
  return params.map((param) => {
    const value = overrides[param.name];
    return isNumber(value) ? { ...param, value } : param;
  });
}
