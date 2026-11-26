import { list, mm } from '#checks/format';
import { FIT_SLACK_MM } from '#checks/limits';
import type { Bed, CheckResult, Vec3 } from '#checks/types';

const axes = [
  { name: 'X', word: 'wide', key: 'x' },
  { name: 'Y', word: 'deep', key: 'y' },
  { name: 'Z', word: 'tall', key: 'z' },
] as const;

export function bedLabel(bed: Bed): string {
  return bed.x === bed.y && bed.y === bed.z ? `${mm(bed.x)} mm bed` : `${mm(bed.x)} x ${mm(bed.y)} x ${mm(bed.z)} mm bed`;
}

// "220 mm bed" for a square bed, else "220 x 250 mm bed"; the height is in the detail when it matters.
function floorLabel(bed: Bed): string {
  return bed.x === bed.y ? `${mm(bed.x)} mm bed` : `${mm(bed.x)} x ${mm(bed.y)} mm bed`;
}

/** printer: a short printer name for the title, e.g. "Fits your printer (Kobra 2 Neo, 220 mm bed)". */
export function checkFits(size: Vec3, bed: Bed, printer?: string): CheckResult {
  const title = printer ? `Fits your printer (${printer}, ${floorLabel(bed)})` : `Fits your printer (${bedLabel(bed)})`;
  const measured = `${mm(size[0])} x ${mm(size[1])} x ${mm(size[2])} mm`;
  const over = axes.flatMap((axis, i) => {
    const extra = size[i]! - bed[axis.key];
    return extra > FIT_SLACK_MM ? [`${mm(extra)} mm too ${axis.word} (${mm(size[i]!)} mm in ${axis.name})`] : [];
  });
  if (over.length === 0) return { id: 'fits-bed', ok: true, title, detail: `It measures ${measured}.` };
  return {
    id: 'fits-bed',
    ok: false,
    title,
    detail: `It is ${list(over)} for a ${mm(bed.x)} x ${mm(bed.y)} x ${mm(bed.z)} mm bed.`,
    fix:
      `Change the design so it fits in ${mm(bed.x)} x ${mm(bed.y)} x ${mm(bed.z)} mm (X x Y x Z); it is now ${measured}. ` +
      'Make it smaller or lay it out differently, and keep the other named sizes.',
  };
}
