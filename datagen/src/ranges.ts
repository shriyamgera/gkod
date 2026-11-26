// Slider ranges: each size moves out from its value one step at a time while the whole part still passes every rule,
// so any one slider can be set anywhere in its range and the part stays printable.
import { envOf, type Model, type Size } from './model.ts';
import type { Param } from './scad.ts';
import { check } from './validate.ts';

/** How far a slider may reach from the value: about a third either way, two for counts. */
const SHARE = 0.3;
const COUNT_REACH = 2;

const tidy = (value: number) => Number(value.toFixed(6));

function reach(s: Size): number {
  if (s.name.endsWith('_count')) return COUNT_REACH;
  return Math.max(2 * s.step, Math.floor((SHARE * s.value) / s.step) * s.step);
}

function farthest(model: Model, s: Size, direction: 1 | -1): number {
  const limit = direction < 0 ? Math.max(s.lo, s.value - reach(s)) : Math.min(s.hi, s.value + reach(s));
  let best = s.value;
  for (let k = 1; ; k++) {
    const candidate = tidy(s.value + direction * k * s.step);
    if (direction < 0 ? candidate < limit - 1e-9 : candidate > limit + 1e-9) break;
    if (check(model, envOf(model, { [s.name]: candidate })).length) break;
    best = candidate;
  }
  return best;
}

/** The slider for every size, or the reason one size has no room to move. */
export function rangesOf(model: Model): { params: Param[] } | { reason: string } {
  const params: Param[] = [];
  for (const s of model.sizes) {
    const min = farthest(model, s, -1);
    const max = farthest(model, s, 1);
    if (min === max) return { reason: `${s.caption.replace(/ \(mm\)$/, '')} has no room to change.` };
    params.push({ name: s.name, caption: s.caption, value: s.value, min, step: s.step, max });
  }
  return { params };
}
