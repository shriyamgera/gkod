import type { Bed, Report } from '@gkod/checks';

const mm = (value: number) => String(Math.round(value * 10) / 10);

export function bedText(bed: Bed): string {
  return `${mm(bed.x)} x ${mm(bed.y)} x ${mm(bed.z)} mm`;
}

// The same lines as the gkod-check command: a headline, then pass or FAIL for each check.
export function reportLines(file: string, report: Report, printer: string): string[] {
  const { triangles, size } = report.stats;
  const lines = [
    `${file}: ${report.ok ? 'ready to print' : 'needs changes'} on ${printer} ` +
      `(${triangles} triangles, ${size.map(mm).join(' x ')} mm, checked in ${report.ms.toFixed(1)} ms)`,
  ];
  for (const result of report.results) {
    lines.push(`  ${result.ok ? 'pass' : 'FAIL'}  ${result.title}${result.ok ? '' : `: ${result.detail}`}`);
  }
  return lines;
}
