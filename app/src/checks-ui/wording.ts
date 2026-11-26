import type { CheckId, CheckResult, Report } from '@gkod/checks';
import type { ViewerMark } from '../viewer/mark';

// How each passed check reads in the one line under "Ready to print".
const PASSED: Record<CheckId, string> = {
  closed: 'solid',
  'fits-bed': 'fits your printer',
  'flat-base': 'sits flat',
  overhang: 'needs no supports',
};

export const SUPPORTS_LINE = 'Supports will hold up the part that would sag. You break them off after printing.';

export function problems(report: Report): CheckResult[] {
  return report.results.filter((result) => !result.ok);
}

export function problemTitle(count: number): string {
  return count === 1 ? 'One thing to fix' : `${count} things to fix`;
}

/** "Solid, fits your printer, sits flat and needs no supports." */
export function readyLine(report: Report): string {
  const words = report.results.filter((result) => result.ok).map((result) => PASSED[result.id]);
  if (words.length === 0) return 'Every check passed.';
  const last = words.pop()!;
  const line = words.length > 0 ? `${words.join(', ')} and ${last}` : last;
  return `${line[0]!.toUpperCase()}${line.slice(1)}.`;
}

/** Supports can carry an overhang, but they cannot close a hole or shrink a part to fit. */
export function onlyOverhang(report: Report): boolean {
  const found = problems(report);
  return found.length === 1 && found[0]!.id === 'overhang';
}

export type BoxKind = 'none' | 'ready' | 'supports' | 'problems';

export function boxKind(report: Report | null, supportsChosen: boolean): BoxKind {
  if (!report) return 'none';
  if (problems(report).length === 0) return 'ready';
  return supportsChosen && onlyOverhang(report) ? 'supports' : 'problems';
}

/** What the box says to screen readers when it settles. */
export function announcement(report: Report | null, supportsChosen: boolean): string {
  if (!report) return '';
  switch (boxKind(report, supportsChosen)) {
    case 'ready':
      return `Ready to print. ${readyLine(report)}`;
    case 'supports':
      return `Prints with supports. ${SUPPORTS_LINE}`;
    default: {
      const found = problems(report);
      return `${problemTitle(found.length)}. ${found.map((result) => result.detail).join(' ')}`;
    }
  }
}

/** What "Fix it for me" asks the engine: the checks' own instructions, one per problem. */
export function fixRequest(report: Report): string {
  return problems(report)
    .map((result) => result.fix ?? result.detail)
    .join('\n');
}

/** The viewer mark for a steep overhang, or null when there is none to show. */
export function overhangMark(report: Report | null | undefined): ViewerMark | null {
  const overhang = report?.results.find((result) => result.id === 'overhang' && !result.ok);
  if (!report || !overhang?.triangles?.length) return null;
  // to a tenth of a mm, the same as the sentence in the box
  const height = overhang.at ? Math.round((overhang.at[2] - report.stats.min[2]) * 10) / 10 : null;
  return {
    triangles: overhang.triangles,
    at: overhang.at,
    label: 'Would sag here',
    description: height === null ? 'Steep overhang' : `Steep overhang at ${height} mm height`,
  };
}
