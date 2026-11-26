import { useSyncExternalStore } from 'react';
import { DEFAULT_PRINTER_ID, findPrinter, type Printer } from './printers';

// The visitor's printer, remembered on this device as a convenience. Storage can be missing or blocked.
const KEY = 'gkod.printer';

let current: string | null = null;
const listeners = new Set<(id: string) => void>();

function read(): string {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    if (stored && findPrinter(stored)) return stored;
  } catch {
    // no storage here: use the default
  }
  return DEFAULT_PRINTER_ID;
}

export function getPrinterId(): string {
  current ??= read();
  return current;
}

export function getPrinter(): Printer {
  return findPrinter(getPrinterId()) ?? findPrinter(DEFAULT_PRINTER_ID)!;
}

/** Chooses a printer; an id that is not in the list is ignored. */
export function setPrinterId(id: string): void {
  if (!findPrinter(id) || id === getPrinterId()) return;
  current = id;
  try {
    globalThis.localStorage?.setItem(KEY, id);
  } catch {
    // remembered for this visit only
  }
  for (const listener of [...listeners]) listener(id);
}

export function subscribePrinterId(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chosen printer id, for React components; they render again when it changes. */
export function usePrinterId(): string {
  return useSyncExternalStore(subscribePrinterId, getPrinterId, () => DEFAULT_PRINTER_ID);
}

/** The chosen printer, for React components. */
export function useChosenPrinter(): Printer {
  const id = usePrinterId();
  return findPrinter(id) ?? findPrinter(DEFAULT_PRINTER_ID)!;
}
