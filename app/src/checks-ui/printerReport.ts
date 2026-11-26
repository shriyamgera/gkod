import { type Report, withBed } from '@gkod/checks';
import { useMemo } from 'react';
import { printerShortName } from '../print-ui/format';
import type { Printer } from '../slicer/printers';

/** The report measured against the chosen printer, so choosing another printer needs no new compile. */
export function usePrinterReport(report: Report | null, printer: Printer): Report | null {
  return useMemo(() => (report ? withBed(report, printer.bed, printerShortName(printer.name)) : null), [report, printer]);
}
