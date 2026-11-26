import type { CheckId, CheckResult, Report } from '@gkod/checks';
import type { ViewerMark } from '../viewer/mark';

// How each passed check reads in the one line under "Ready to print".
const PASSED: Record<CheckId, string> = {
  closed: 'solid',
  'fits-bed': 'fits your printer',
  'flat-base': 'sits flat',
  overhang: 'needs no supports',
};

// Nothing in the site adds supports yet, so the box says what to turn on in the visitor's own slicer.
export const SUPPORTS_TITLE = 'Needs supports';
export const SUPPORTS_LINE = 'Turn on supports in your slicer for the marked part that would sag. You break them off after printing.';

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
      return `${SUPPORTS_TITLE}. ${SUPPORTS_LINE}`;
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

// How each failed check is named in the label of the version that fixes it.
const FIXED: Record<CheckId, string> = {
  closed: 'holes in the surface',
  'fits-bed': 'size for the bed',
  'flat-base': 'flat base',
  overhang: 'steep overhang',
};

export type FixOutcome = 'fixed' | 'new-problem' | 'not-fixed' | 'unchecked';

/** Whether the version a fix made passes: fully, or with a problem the fix did not aim at, or not at all. */
export function fixOutcome(before: Report, after: Report | undefined): FixOutcome {
  if (!after) return 'unchecked';
  const left = problems(after);
  if (left.length === 0) return 'fixed';
  const aimedAt = new Set(problems(before).map((result) => result.id));
  return left.some((result) => aimedAt.has(result.id)) ? 'not-fixed' : 'new-problem';
}

/** "Fixed: steep overhang", or "Tried to fix: steep overhang" when the new version still fails that check. */
export function fixLabel(before: Report, after: Report | undefined): string {
  const names = problems(before).map((result) => FIXED[result.id]);
  const last = names.pop() ?? 'print checks';
  const what = names.length > 0 ? `${names.join(', ')} and ${last}` : last;
  const outcome = fixOutcome(before, after);
  return `${outcome === 'fixed' || outcome === 'new-problem' ? 'Fixed' : 'Tried to fix'}: ${what}`;
}

/** What we say once a fix has made version v; from is the version it started from, which is kept. */
export function fixedNote(v: number, from: number, before: Report, after: Report | undefined): string {
  const kept = `Version ${from} is kept under Changes.`;
  const count = after ? problems(after).length : 0;
  switch (fixOutcome(before, after)) {
    case 'fixed':
      return `Fixed. Version ${v} is ready to print.`;
    case 'unchecked':
      return `Version ${v} is made, but it could not be checked.`;
    case 'new-problem':
      return `Version ${v} fixes that, but has ${count === 1 ? 'a new problem' : `${count} new problems`}. ${kept}`;
    default:
      return `The fix did not work: version ${v} still has ${count === 1 ? 'a problem' : `${count} problems`}. ${kept}`;
  }
}

/** What the viewer marks: the steep overhang, as where supports go once the visitor chose to print with them. */
export function viewerMark(report: Report | null | undefined, supportsChosen: boolean): ViewerMark | null {
  return overhangMark(report, boxKind(report ?? null, supportsChosen) === 'supports' ? 'Needs supports here' : undefined);
}

/** The viewer mark for a steep overhang, or null when there is none to show. */
export function overhangMark(report: Report | null | undefined, label = 'Would sag here'): ViewerMark | null {
  const overhang = report?.results.find((result) => result.id === 'overhang' && !result.ok);
  if (!report || !overhang?.triangles?.length) return null;
  // the height of the point the marker is on, to a tenth of a mm like the heights in the box
  const height = overhang.at ? Math.round((overhang.at[2] - report.stats.min[2]) * 10) / 10 : null;
  return {
    triangles: overhang.triangles,
    at: overhang.at,
    label,
    description: height === null ? 'Steep overhang' : `Steep overhang at ${height} mm height`,
  };
}
