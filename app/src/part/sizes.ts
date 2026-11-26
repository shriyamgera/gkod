import type { Param } from '../scad/types';

export type SizeInfo = {
  label: string;
  // shown after the number box
  unit: string;
  // read out by screen readers
  unitName: string;
  help?: string;
};

const units: Record<string, { unit: string; unitName: string }> = {
  mm: { unit: 'mm', unitName: 'millimetres' },
  degrees: { unit: '°', unitName: 'degrees' },
  degree: { unit: '°', unitName: 'degrees' },
  deg: { unit: '°', unitName: 'degrees' },
  '%': { unit: '%', unitName: 'percent' },
};

// One-letter name parts are common shorthand in part code: screw_d, round_r.
const shorthand: Record<string, string> = { d: 'diameter', r: 'radius', w: 'width', h: 'height', t: 'thickness' };

export function labelOf(name: string): string {
  const words = name
    .split('_')
    .filter(Boolean)
    .map((word, i) => (i > 0 ? (shorthand[word] ?? word) : word));
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Stand width (mm)" gives the help text "Stand width" and the unit "mm". Sizes with no unit are taken as mm.
export function describeParam(param: Pick<Param, 'name' | 'caption'>): SizeInfo {
  const caption = param.caption?.trim() ?? '';
  const match = /\s*\(([^()]+)\)\s*$/.exec(caption);
  const written = match?.[1]?.trim() ?? '';
  const known = units[written.toLowerCase()];
  const unit = known ?? (written ? { unit: written, unitName: written } : units.mm!);
  const help = (match ? caption.slice(0, match.index) : caption).trim();
  const info: SizeInfo = { label: labelOf(param.name), ...unit };
  // a caption that only repeats the label would be shown and read out twice
  if (help && help.toLowerCase() !== info.label.toLowerCase()) info.help = help;
  return info;
}

const tidy = (value: number) => Number(value.toFixed(6));

// Snaps a typed or dragged value onto the slider's steps and keeps it inside the range.
export function fitToParam(value: number, param: Pick<Param, 'min' | 'max' | 'step'>): number {
  if (!Number.isFinite(value)) return param.min;
  const steps = param.step > 0 ? Math.round((value - param.min) / param.step) : 0;
  const snapped = param.step > 0 ? param.min + steps * param.step : value;
  return tidy(Math.min(param.max, Math.max(param.min, snapped)));
}

export function formatValue(value: number): string {
  return String(tidy(value));
}

// phone_stand_80mm.stl: the example id and its first size in mm, so two downloads of different sizes do not clash.
export function stlFileName(id: string, params: Param[]): string {
  const first = params.find((param) => describeParam(param).unit === 'mm');
  return first ? `${id}_${formatValue(first.value)}mm.stl` : `${id}.stl`;
}

// Writes changed sizes into the code, so the code shown is the code of the model shown.
export function withValues(source: string, values: Record<string, number>): string {
  return source.replace(/^([A-Za-z_]\w*)(\s*=\s*)(-?[\d.]+)(\s*;)/gm, (line, name: string, eq, old, end) => {
    const value = values[name];
    if (!Object.hasOwn(values, name) || value === undefined || value === Number(old)) return line;
    return `${name}${eq}${formatValue(value)}${end}`;
  });
}
