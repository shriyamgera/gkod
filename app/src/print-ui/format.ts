import type { Report } from '@gkod/checks';
import { onlyOverhang } from '../checks-ui/wording';

/** "About 1 h 40 min", rounded to the minute. The slicer's time is a rough estimate. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Time not known';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `About ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `About ${hours} h` : `About ${hours} h ${rest} min`;
}

/** Filament length in metres with one decimal: "12.4 m". */
export function formatFilament(mm: number): string {
  if (!Number.isFinite(mm) || mm < 0) return 'Not known';
  const metres = mm / 1000;
  return metres < 0.05 ? 'Under 0.1 m' : `${metres.toFixed(1)} m`;
}

/** "205 °C", or "200 to 210 °C" when the file sets more than one, with a space that does not break. Zero only turns a heater off. */
export function formatTemps(values: number[]): string {
  const set = [...new Set(values.filter((value) => value > 0))].sort((a, b) => a - b);
  if (set.length === 0) return '';
  const low = set[0]!;
  const high = set[set.length - 1]!;
  return low === high ? `${low}\u00a0°C` : `${low} to ${high}\u00a0°C`;
}

function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
}

const BRANDS = /^(anycubic|bambu lab|creality|prusa research|prusa|elegoo|sovol|qidi|flashforge|artillery|voron)\s+/i;

/** The short printer name in a file name: "Anycubic Kobra 2 Neo" becomes "kobra2neo". */
export function printerSlug(name: string): string {
  const model = (name.split(',')[0] ?? '').trim().replace(BRANDS, '');
  const short = model.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
  return !short || short.startsWith('other') ? 'printer' : short;
}

/** phone_stand_kobra2neo.gcode, or phone_stand_v3_kobra2neo.gcode for a version of a made part. */
export function gcodeFileName(title: string, printerName: string, version?: number): string {
  const v = version === undefined ? '' : `_v${version}`;
  return `${slug(title) || 'part'}${v}_${printerSlug(printerName)}.gcode`;
}

/**
 * Whether the checks allow slicing: every check passed, or only the overhang failed and supports are on.
 * Null while there is no report yet.
 */
export function checksAllowSlicing(report: Report | null, supports: boolean): boolean | null {
  if (!report) return null;
  return report.ok || (supports && onlyOverhang(report));
}

export const NO_SHAPE = 'There is no shape to slice yet.';
export const WAIT_FOR_CHECKS = 'Waiting for the print checks.';
export const FIX_FIRST = 'Fix the problems above first, or choose Print with supports.';

/** Why the slice button is off, or null when it is on. */
export function blockReason(hasShape: boolean, checksOk: boolean | null): string | null {
  if (!hasShape) return NO_SHAPE;
  if (checksOk === null) return WAIT_FOR_CHECKS;
  return checksOk ? null : FIX_FIRST;
}
