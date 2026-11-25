const noise = /^Could not initialize localization/;

export function cleanLog(lines: string[]): string[] {
  return lines.map((line) => line.trimEnd()).filter((line) => line && !noise.test(line));
}

// Number of triangles a binary STL says it holds, or 0 when it is too short to be one.
export function stlTriangles(stl: Uint8Array | null): number {
  if (!stl || stl.byteLength < 84) return 0;
  return new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
}

function readable(line: string): string {
  const where = /,? in file \S+, line (\d+)\s*$/.exec(line);
  const text = line
    .replace(/^(ERROR|EXCEPTION):\s*/, '')
    .replace(/,? in file \S+, line \d+\s*$/, '')
    .trim();
  return where ? `Line ${where[1]}: ${text}` : text;
}

// Picks one short message for a failed compile, or returns null when the compile is fine.
export function findFailure(exitCode: number, log: string[], triangles: number): string | null {
  const error = log.find((line) => line.startsWith('ERROR:'));
  if (error) return readable(error);
  const thrown = log.find((line) => line.startsWith('EXCEPTION:'));
  if (thrown) {
    return /call stack|out of memory|memory access/i.test(thrown)
      ? 'The code ran out of room, most likely from endless recursion.'
      : `The compiler stopped: ${readable(thrown)}`;
  }
  if (log.some((line) => /top level object is empty/i.test(line))) return 'The code does not make any solid shape.';
  if (log.some((line) => /not a 3D object/i.test(line))) return 'The code makes a flat 2D shape, not a 3D part.';
  if (exitCode !== 0) {
    const last = [...log].reverse().find((line) => !/^(WARNING|TRACE|ECHO|DEPRECATED)/.test(line));
    return last ?? `The compiler stopped with exit code ${exitCode}.`;
  }
  if (triangles === 0) return 'The code does not make any solid shape.';
  return null;
}
