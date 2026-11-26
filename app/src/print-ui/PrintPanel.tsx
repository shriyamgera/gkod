import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { slice as sliceFn } from '../slicer/client';
import { setPrinterId, usePrinterId } from '../slicer/printerChoice';
import { DEFAULT_PRINTER_ID, type Printer } from '../slicer/printers';
import { type Infill, INFILLS, LAYER_MM, type Quality, type SliceResult, type SliceSettings } from '../slicer/types';
import { blockReason, gcodeFileName } from './format';
import { PrintOutcome, phaseAnnouncement } from './PrintOutcome';
import { type Phase, phaseFrom, type Sliced, staleNote } from './run';
import '../checks-ui/checks-ui.css';
import '../part/part.css';
import './print-ui.css';

const QUALITY_CHOICES: { value: Quality; label: string; help: string }[] = [
  { value: 'normal', label: 'Normal', help: `${LAYER_MM.normal} mm layers` },
  { value: 'fine', label: 'Fine', help: `${LAYER_MM.fine} mm layers, slower` },
];

export type PrintPanelProps = {
  stl: ArrayBuffer | null;
  title: string;
  version?: number;
  supports: boolean;
  onSupportsChange: (v: boolean) => void;
  // every check passed, or only the overhang failed and supports are on; null while checking
  checksOk: boolean | null;
  // why slicing is off, when the page knows better than the checks (e.g. the last change did not build)
  blocked?: string | null;
  slice: typeof sliceFn;
  printers: Printer[];
  // the chosen printer, when the page keeps it; otherwise the one remembered on this device
  printerId?: string;
  onPrinterChange?: (id: string) => void;
};

export function PrintPanel(props: PrintPanelProps) {
  const { stl, title, version, supports, onSupportsChange, checksOk, slice, printers } = props;
  const remembered = usePrinterId();
  const [quality, setQuality] = useState<Quality>('normal');
  const [infill, setInfill] = useState<Infill>(15);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const run = useRef<AbortController | null>(null);
  // the control to focus after the next render, when the one that had focus went away
  const focusNext = useRef<string | null>(null);
  const area = useRef<HTMLElement>(null);
  const id = useId();
  const ids = {
    title: `${id}title`,
    printer: `${id}printer`,
    infill: `${id}infill`,
    supports: `${id}supports`,
    reason: `${id}reason`,
  };

  const printer = pick(printers, props.printerId ?? remembered);
  const settings: SliceSettings = { printerId: printer?.id ?? '', quality, infill, supports };
  const sliced = 'sliced' in phase ? phase.sliced : null;
  // compares the shape byte by byte, so it runs only when one of these changes, not on every progress step
  const stale = useMemo(
    () => (sliced && phase.kind !== 'slicing' ? staleNote(sliced, stl, settings) : null),
    [sliced, phase.kind, stl, settings.printerId, quality, infill, supports],
  );
  const reason = printer ? props.blocked || blockReason(stl !== null, checksOk) : 'No printer to slice for.';
  // progress and a fresh file take the place of the button
  const showButton = phase.kind !== 'slicing' && !(phase.kind === 'done' && !stale);

  // Leaving the screen stops a slice that is still running.
  useEffect(() => () => run.current?.abort(), []);

  useEffect(() => {
    const selector = focusNext.current;
    focusNext.current = null;
    if (selector) area.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [phase.kind]);

  function choosePrinter(id: string) {
    (props.onPrinterChange ?? setPrinterId)(id);
  }

  async function start() {
    if (reason || !stl || !printer || run.current) return;
    const controller = new AbortController();
    run.current = controller;
    const job: Sliced = { stl, settings, printer };
    focusNext.current = '.print-stop';
    setPhase({ kind: 'slicing', percent: 0, sliced: job });
    let result: SliceResult;
    try {
      result = await slice(stl, settings, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (run.current !== controller) return;
          const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
          setPhase((now) => (now.kind === 'slicing' && now.percent !== percent ? { ...now, percent } : now));
        },
      });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : 'The slicer stopped working.', ms: 0 };
    }
    if (run.current !== controller) return;
    run.current = null;
    // Stop goes away, so the keyboard moves on to what came out instead of the top of the page.
    if (document.activeElement?.classList.contains('print-stop')) focusNext.current = '.print-download, .print-slice';
    setPhase(phaseFrom(result, job));
  }

  function stop() {
    run.current?.abort();
    run.current = null;
    focusNext.current = '.print-slice';
    setPhase({ kind: 'stopped' });
  }

  function download() {
    if (phase.kind !== 'done' || stale) return;
    saveBlob(phase.result.gcode, gcodeFileName(title, phase.sliced.printer.name, version));
  }

  const fileName = sliced ? gcodeFileName(title, sliced.printer.name, version) : '';

  return (
    <section className="print" aria-labelledby={ids.title} ref={area}>
      <h2 id={ids.title}>Print</h2>

      <div className="print-field">
        <label htmlFor={ids.printer}>Printer</label>
        <select
          id={ids.printer}
          className="print-select"
          value={printer?.id ?? ''}
          onChange={(event) => choosePrinter(event.target.value)}
          aria-describedby={`${ids.printer}-help`}
        >
          {printers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <p id={`${ids.printer}-help`} className="print-help">
          {printer ? `${printer.bed.x} x ${printer.bed.y} x ${printer.bed.z} mm bed, PLA only` : 'PLA only'}
        </p>
      </div>

      <fieldset className="print-field print-quality">
        <legend>Quality</legend>
        <div className="print-choices">
          {QUALITY_CHOICES.map((item) => (
            <label key={item.value} className="print-choice">
              <input
                type="radio"
                name={`${id}quality`}
                value={item.value}
                checked={quality === item.value}
                onChange={() => setQuality(item.value)}
              />
              <span>
                {item.label}
                <span className="print-help">{item.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="print-row">
        <div className="print-label">
          <label htmlFor={ids.infill}>Infill</label>
          <span id={`${ids.infill}-help`} className="print-help">
            More is stronger and slower
          </span>
        </div>
        <select
          id={ids.infill}
          className="print-select print-select-small"
          aria-describedby={`${ids.infill}-help`}
          value={infill}
          onChange={(event) => setInfill(Number(event.target.value) as Infill)}
        >
          {INFILLS.map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      </div>

      <div className="print-check">
        <input
          id={ids.supports}
          type="checkbox"
          checked={supports}
          aria-describedby={`${ids.supports}-help`}
          onChange={(event) => onSupportsChange(event.target.checked)}
        />
        <div className="print-label">
          <label htmlFor={ids.supports}>Print with supports</label>
          <span id={`${ids.supports}-help`} className="print-help">
            Holds up parts that would sag. You break them off after printing.
          </span>
        </div>
      </div>

      {showButton && (
        <div className="print-go">
          <button
            type="button"
            className="button-dark print-slice"
            aria-disabled={reason !== null}
            aria-describedby={reason ? ids.reason : undefined}
            onClick={reason ? undefined : () => void start()}
          >
            Slice for my printer
          </button>
          {reason && (
            <p id={ids.reason} className="print-note">
              {reason}
            </p>
          )}
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">
        {phaseAnnouncement(phase, stale)}
      </p>

      <PrintOutcome
        phase={phase}
        stale={stale}
        fileName={fileName}
        onStop={stop}
        onDownload={download}
      />
    </section>
  );
}

function pick(printers: Printer[], id: string): Printer | undefined {
  const find = (wanted: string) => printers.find((item) => item.id === wanted);
  return find(id) ?? find(DEFAULT_PRINTER_ID) ?? printers[0];
}

// The file is already in memory; nothing is sent anywhere.
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
