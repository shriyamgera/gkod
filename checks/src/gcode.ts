import type { Bed } from '#checks/types';

export type GcodeLimits = { bed: Bed; nozzleMin: number; nozzleMax: number; bedMax: number; allowed?: string[] };
export type GcodeProblem = { line: number; text: string; reason: string };
export type GcodeReport = {
  ok: boolean;
  problems: GcodeProblem[];
  stats: {
    lines: number;
    moves: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    minZ: number;
    nozzle: number[];
    bed: number[];
    fanOnLayer: number | null;
    extruderMode: 'absolute' | 'relative' | null;
  };
};

export const PLA_LIMITS = { nozzleMin: 190, nozzleMax: 230, bedMax: 70 };

/** The commands our slicer and our printers' start and end code use. Anything else fails the check. */
export const DEFAULT_ALLOWED = [
  'G0', 'G1', 'G2', 'G3', 'G4', 'G21', 'G28', 'G90', 'G91', 'G92',
  'M82', 'M83', 'M84', 'M104', 'M106', 'M107', 'M109', 'M117', 'M140', 'M190', 'M300', 'M400', 'M420',
];

// The fan must be on by this layer (1 is the first layer).
export const FAN_BY_LAYER = 3;
// One move pushing more filament than this means the extruder mode is wrong. Purge lines use 15 to 25 mm.
export const MAX_E_PER_MOVE_MM = 50;
// Coordinates are written with a few decimals; this only absorbs rounding.
const EPS = 1e-6;
// Marlin keeps 95 characters of a line before its comment (MAX_CMD_SIZE 96) and drops the rest.
export const MAX_LINE_CHARS = 95;
// Marlin ends a line at "\r" as well as "\n", and a backspace (0x08) erases what it read before it. Tab is harmless.
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;
const NOT_ASCII = /[^\x00-\x7f]/;
// Only the first few problems of each kind are kept, so a broken file of millions of lines cannot fill memory.
const MAX_PER_KIND = 5;

const known: Record<string, string> = {
  M500: 'saves settings to the printer’s memory',
  M501: 'loads saved settings from the printer’s memory',
  M502: 'resets the printer’s settings to factory defaults',
  M504: 'checks the printer’s settings memory',
  M997: 'starts a firmware update',
  M999: 'restarts the printer after an error',
  M302: 'allows extruding with a cold nozzle',
  M211: 'turns the printer’s own limits on or off',
  M92: 'changes the motor steps per millimetre',
  M851: 'changes the nozzle height offset',
  M206: 'changes the home position',
};

type Axis = 'X' | 'Y' | 'Z';
type Words = Map<string, number>;

export function createGcodeChecker(limits: GcodeLimits) {
  const allowed = new Set((limits.allowed ?? DEFAULT_ALLOWED).map(normalize));
  const { bed } = limits;
  const problems: GcodeProblem[] = [];
  const kinds = new Map<string, number>();
  const seenNozzle: number[] = [];
  const seenBed: number[] = [];

  let lineNo = 0;
  let moves = 0;
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  let minZ = Infinity;
  // null: the position is not known (never homed, or just homed)
  const pos: Record<Axis, number | null> = { X: null, Y: null, Z: null };
  const homed: Record<Axis, boolean> = { X: false, Y: false, Z: false };
  let relative = false;
  let eMode: 'absolute' | 'relative' | null = null;
  let eStated = false;
  let e = 0;
  let heated = false;
  let extruded = false;
  let extruderMode: 'absolute' | 'relative' | null = null;
  let fan = 0;
  let fanOnLayer: number | null = null;
  let fanOffReported = false;
  let fanLateReported = false;
  let layer = 0;
  let layerZ: number | null = null;

  function problem(text: string, reason: string, kind = reason) {
    const count = kinds.get(kind) ?? 0;
    kinds.set(kind, count + 1);
    if (count < MAX_PER_KIND) problems.push({ line: lineNo, text: shown(text), reason });
  }

  function remember(list: number[], value: number) {
    if (list.length < 20 && !list.includes(value)) list.push(value);
  }

  // The nozzle must stay above the bed: at Z 0 it touches it.
  function inside(axis: Axis, value: number): boolean {
    const max = axis === 'X' ? bed.x : axis === 'Y' ? bed.y : bed.z;
    return (axis === 'Z' ? value > EPS : value >= -EPS) && value <= max + EPS;
  }

  function place(text: string, axis: Axis, value: number) {
    if (!inside(axis, value)) {
      if (axis === 'Z' && value < -EPS) problem(text, `Moves the nozzle below the bed (Z ${round(value)} mm).`, 'below');
      else if (axis === 'Z' && value <= EPS) problem(text, `Moves the nozzle down onto the bed (Z ${round(value)} mm).`, 'below');
      else {
        const max = axis === 'X' ? bed.x : axis === 'Y' ? bed.y : bed.z;
        problem(text, `Moves outside the bed: ${axis} ${round(value)} mm, the printer allows 0 to ${max} mm.`, `out-${axis}`);
      }
    }
    if (axis === 'X') maxX = Math.max(maxX, value);
    if (axis === 'Y') maxY = Math.max(maxY, value);
    if (axis === 'Z') {
      maxZ = Math.max(maxZ, value);
      minZ = Math.min(minZ, value);
    }
  }

  function target(text: string, words: Words, axis: Axis): number | null {
    const value = words.get(axis);
    if (value === undefined) return pos[axis];
    if (!homed[axis]) return relative ? null : value;
    if (!relative) return value;
    const from = pos[axis];
    if (from === null) {
      problem(text, `Moves ${axis} by a relative amount while its position is unknown, right after homing.`, 'unknown');
      return null;
    }
    return from + value;
  }

  function extrude(text: string, words: Words, movedXY: boolean) {
    const value = words.get('E');
    if (value === undefined) return;
    const absolute = eMode === 'absolute';
    const de = absolute ? value - e : value;
    e = absolute ? value : e + value;
    if (Math.abs(de) > MAX_E_PER_MOVE_MM) {
      problem(text, `Moves ${round(Math.abs(de))} mm of filament in one move, so the extruder mode is probably wrong.`, 'e-big');
    }
    if (de <= 0) return;
    if (!extruded) {
      extruded = true;
      extruderMode = eMode;
      if (!eStated) problem(text, 'Extrudes before the extruder mode is set (M82 or M83).');
      if (!heated) problem(text, 'Extrudes before waiting for the nozzle to heat (M109).');
    }
    if (movedXY && pos.Z !== null) countLayer(text, pos.Z);
  }

  function countLayer(text: string, z: number) {
    if (layerZ === null || z < layerZ - 1e-3) {
      layer = 1;
      layerZ = z;
    } else if (z > layerZ + 1e-3) {
      layer++;
      layerZ = z;
    }
    if (fan > 0) {
      fanOnLayer ??= layer;
      return;
    }
    if (fanOnLayer !== null && layer > fanOnLayer && !fanOffReported) {
      fanOffReported = true;
      problem(text, `The part fan is turned off again at layer ${layer}.`);
    } else if (fanOnLayer === null && layer > FAN_BY_LAYER && !fanLateReported) {
      fanLateReported = true;
      problem(text, `The part fan is still off at layer ${layer}. PLA needs it on by layer ${FAN_BY_LAYER}.`);
    }
  }

  function move(text: string, code: string, words: Words) {
    const isArc = code === 'G2' || code === 'G3';
    const touches = ['X', 'Y', 'Z', 'E', ...(isArc ? ['I', 'J', 'R'] : [])].some((key) => words.has(key));
    if (!touches) return;
    if (words.has('X') || words.has('Y') || words.has('Z')) moves++;
    if ((['X', 'Y', 'Z'] as Axis[]).some((axis) => words.has(axis) && !homed[axis])) {
      problem(text, 'Moves before the printer is homed (G28).', 'not-homed');
    }
    const from = { X: pos.X, Y: pos.Y };
    const x = target(text, words, 'X');
    const y = target(text, words, 'Y');
    const z = target(text, words, 'Z');
    if (isArc) arc(text, code, words, from, x, y);
    if (x !== null && words.has('X')) place(text, 'X', x);
    if (y !== null && words.has('Y')) place(text, 'Y', y);
    if (z !== null && words.has('Z')) place(text, 'Z', z);
    pos.X = x;
    pos.Y = y;
    pos.Z = z;
    extrude(text, words, words.has('X') || words.has('Y') || isArc);
  }

  function arc(
    text: string,
    code: string,
    words: Words,
    from: { X: number | null; Y: number | null },
    x: number | null,
    y: number | null,
  ) {
    if (from.X === null || from.Y === null || x === null || y === null) {
      problem(text, 'Draws an arc from a position that is not known.');
      return;
    }
    const clockwise = code === 'G2';
    let cx: number;
    let cy: number;
    const r = words.get('R');
    if (r !== undefined) {
      const dx = x - from.X;
      const dy = y - from.Y;
      const d = Math.hypot(dx, dy);
      const h2 = (r - d / 2) * (r + d / 2);
      if (d === 0 || h2 < -EPS) {
        problem(text, 'Draws an arc whose radius is too small for its two ends.');
        return;
      }
      const h = Math.sqrt(Math.max(0, h2));
      const side = clockwise !== r < 0 ? -1 : 1;
      cx = from.X + dx / 2 + (side * -dy * h) / d;
      cy = from.Y + dy / 2 + (side * dx * h) / d;
    } else {
      cx = from.X + (words.get('I') ?? 0);
      cy = from.Y + (words.get('J') ?? 0);
    }
    const radius = Math.hypot(from.X - cx, from.Y - cy);
    const a0 = Math.atan2(from.Y - cy, from.X - cx);
    const a1 = Math.atan2(y - cy, x - cx);
    const full = Math.abs(x - from.X) < EPS && Math.abs(y - from.Y) < EPS;
    const turn = 2 * Math.PI;
    let sweep = full ? turn : ((clockwise ? a0 - a1 : a1 - a0) % turn + turn) % turn;
    if (sweep === 0) sweep = turn;
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      const along = (((clockwise ? a0 - angle : angle - a0) % turn) + turn) % turn;
      if (along > sweep + EPS) continue;
      const px = cx + radius * Math.cos(angle);
      const py = cy + radius * Math.sin(angle);
      if (!inside('X', px) || !inside('Y', py)) {
        problem(text, `Draws an arc that leaves the bed (it reaches X ${round(px)}, Y ${round(py)} mm).`, 'arc-out');
        return;
      }
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  function temperature(text: string, code: string, words: Words) {
    const why = heaterWordProblem(code, words);
    if (why) {
      problem(text, why, 'heater-word');
      return;
    }
    const value = (words.get('S') ?? words.get('R'))!;
    if (code === 'M104' || code === 'M109') {
      remember(seenNozzle, value);
      const inRange = value >= limits.nozzleMin && value <= limits.nozzleMax;
      if (value !== 0 && !inRange) {
        problem(text, `Sets the nozzle to ${value} °C. PLA must be ${limits.nozzleMin} to ${limits.nozzleMax} °C.`);
      }
      if (code === 'M109') heated = inRange;
    } else {
      remember(seenBed, value);
      if (value < 0 || value > limits.bedMax) {
        problem(text, `Sets the bed to ${value} °C. PLA needs at most ${limits.bedMax} °C.`);
      }
    }
  }

  function fanCommand(code: string, words: Words) {
    if ((words.get('P') ?? 0) !== 0) return;
    fan = code === 'M107' ? 0 : Math.max(0, words.get('S') ?? 255);
  }

  function home(words: Words) {
    const axes: Axis[] = ['X', 'Y', 'Z'].filter((a) => words.has(a)) as Axis[];
    for (const axis of axes.length ? axes : (['X', 'Y', 'Z'] as Axis[])) {
      homed[axis] = true;
      pos[axis] = null;
    }
  }

  function setPosition(text: string, words: Words) {
    const e0 = words.get('E');
    if (e0 !== undefined) e = e0;
    for (const axis of ['X', 'Y', 'Z'] as Axis[]) {
      const value = words.get(axis);
      if (value === undefined) continue;
      problem(text, `G92 gives ${axis} a new position, so the moves after it cannot be checked against the bed.`);
      pos[axis] = value;
    }
  }

  function line(raw: string) {
    lineNo++;
    // one "\r" left over from a "\r\n" line end
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const at = text.indexOf(';');
    const before = at === -1 ? text : text.slice(0, at);
    if (CONTROL.test(text)) {
      problem(text, 'Has a control character, such as a carriage return or a backspace, that changes what the printer reads.', 'control');
      return;
    }
    if (NOT_ASCII.test(before)) {
      problem(text, 'Has a character that is not plain text before its comment, which the printer reads differently.', 'not-ascii');
      return;
    }
    if (before.length > MAX_LINE_CHARS) {
      problem(text, `Is longer than the ${MAX_LINE_CHARS} characters the printer reads from a line.`, 'too-long');
      return;
    }
    // a trailing "*71" is a checksum, not part of the command
    const code = before.trim().replace(/\*\d*$/, '').trim();
    if (!code) return;
    const parts = code.split(/\s+/);
    let head = parts[0]!.toUpperCase();
    let first = 1;
    if (/^N\d+$/.test(head)) {
      head = (parts[1] ?? '').toUpperCase();
      first = 2;
    }
    const cmd = normalize(head);
    if (!allowed.has(cmd)) {
      const why = known[cmd];
      problem(text, why ? `${cmd} ${why}, which a print file must never do.` : `${cmd} is not on the list of allowed commands.`);
      return;
    }
    if (cmd === 'M117') return;
    const words = parseWords(parts.slice(first));
    if (words === null) {
      problem(text, 'This line could not be read.');
      return;
    }
    switch (cmd) {
      case 'G0':
      case 'G1':
      case 'G2':
      case 'G3':
        move(text, cmd, words);
        break;
      case 'G28':
        home(words);
        break;
      case 'G90':
        relative = false;
        eMode = 'absolute';
        break;
      case 'G91':
        relative = true;
        eMode = 'relative';
        break;
      case 'G92':
        setPosition(text, words);
        break;
      case 'M82':
        eMode = 'absolute';
        eStated = true;
        break;
      case 'M83':
        eMode = 'relative';
        eStated = true;
        break;
      case 'M104':
      case 'M109':
      case 'M140':
      case 'M190':
        temperature(text, cmd, words);
        break;
      case 'M106':
      case 'M107':
        fanCommand(cmd, words);
        break;
      case 'M420':
        if ([...words.keys()].some((key) => key !== 'S') || ![0, 1].includes(words.get('S') ?? -1)) {
          problem(text, 'M420 may only turn bed levelling on or off (S1 or S0).');
        }
        break;
    }
  }

  function finish(): GcodeReport {
    const lines = lineNo;
    if (moves === 0) {
      lineNo = 0;
      problem('', 'The file has no moves.');
    }
    return {
      ok: problems.length === 0,
      problems: [...problems],
      stats: {
        lines,
        moves,
        maxX,
        maxY,
        maxZ,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        nozzle: [...seenNozzle],
        bed: [...seenBed],
        fanOnLayer,
        extruderMode,
      },
    };
  }

  return { line, finish };
}

/** Checks a whole G-code file. It reads one line at a time and keeps no copy of the text. */
export function checkGcode(gcode: string, limits: GcodeLimits): GcodeReport {
  const checker = createGcodeChecker(limits);
  const lines = createLineSplitter(checker.line);
  lines.push(gcode);
  lines.end();
  return checker.finish();
}

/**
 * Splits text that arrives in pieces into lines the way the printer does: "\r\n", "\r" and "\n" each end a line.
 * The site's slicer, the file check command and checkGcode all read lines with this.
 */
export function createLineSplitter(line: (text: string) => void) {
  let rest = '';
  const ends = /\r\n?|\n/g;
  return {
    push(chunk: string) {
      const text = rest ? rest + chunk : chunk;
      let start = 0;
      ends.lastIndex = 0;
      for (let end = ends.exec(text); end; end = ends.exec(text)) {
        // a "\r" at the very end may be the first half of a "\r\n" in the next piece
        if (end[0] === '\r' && end.index === text.length - 1) break;
        line(text.slice(start, end.index));
        start = end.index + end[0].length;
      }
      rest = text.slice(start);
    },
    end() {
      const last = rest.endsWith('\r') ? rest.slice(0, -1) : rest;
      if (rest !== '') line(last);
      rest = '';
    },
  };
}

// The only words a heater line may have. On Marlin, I picks a stored preset (and wins over S), F turns on
// automatic temperature and B sets its upper limit; the Kobra 2 Neo's firmware has both.
const HEATER_WORDS: Record<string, string[]> = { M104: ['S', 'T'], M109: ['S', 'R', 'T'], M140: ['S'], M190: ['S', 'R'] };

function heaterWordProblem(code: string, words: Words): string | null {
  for (const [key, value] of words) {
    if (!HEATER_WORDS[code]!.includes(key)) {
      if (key === 'I') return `${code} I picks a stored preset temperature, which a print file must never use.`;
      if (key === 'F' || key === 'B') return `${code} ${key} changes the temperature on its own while printing, which a print file must never use.`;
      return `${code} ${key} is not allowed. A heater line may only give the temperature with S${HEATER_WORDS[code]!.includes('R') ? ' or R' : ''}.`;
    }
    if (key === 'T' && value !== 0) return `${code} T${value} heats another nozzle, and these printers have one.`;
  }
  if (words.has('S') && words.has('R')) return `${code} gives the temperature twice, with both S and R.`;
  if (!words.has('S') && !words.has('R')) return `${code} gives no temperature.`;
  return null;
}

// Control characters are written as \x08 so the report can be shown.
function shown(text: string): string {
  return text.slice(0, 120).replace(/[\x00-\x08\x0a-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// "G01" and "g1" are the same command as "G1".
function normalize(command: string): string {
  const match = /^([A-Z])0*(\d+(?:\.\d+)?)$/i.exec(command);
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : command.toUpperCase();
}

// Plain decimals only. Marlin stops a number at "E" or "X", so "X300E-1" is X 300 and E -1 to the printer,
// not X 30 as Number() reads it; hex and exponents are refused.
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function parseWords(tokens: string[]): Words | null {
  const words: Words = new Map();
  for (const token of tokens) {
    const letter = token[0]!.toUpperCase();
    const rest = token.slice(1);
    // a letter given twice may be read either way
    if (!/^[A-Z]$/.test(letter) || words.has(letter)) return null;
    if (rest !== '' && !NUMBER.test(rest)) return null;
    words.set(letter, rest === '' ? 0 : Number(rest));
  }
  return words;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
