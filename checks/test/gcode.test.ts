import { describe, expect, it } from 'vitest';
import { checkGcode, createGcodeChecker, createLineSplitter, type GcodeReport, MAX_LINE_CHARS, PLA_LIMITS } from '#checks/index';

const limits = { bed: { x: 220, y: 220, z: 250 }, ...PLA_LIMITS };

const start = [
  'G90',
  'M83',
  'M140 S60',
  'M104 S205',
  'G28',
  'M190 S60',
  'M109 S205',
  'G1 Z0.3 F3000',
  'G1 X10 Y5',
  'G1 X60 Y5 E20 F500 ; purge line',
  'G92 E0',
];

function layer(n: number): string[] {
  const z = (0.2 * n).toFixed(2);
  return [`;LAYER:${n}`, ...(n === 2 ? ['M106 S255'] : []), `G1 Z${z}`, 'G1 X100 Y100', 'G1 X120 Y100 E1', 'G1 X120 Y120 E1'];
}

const end = ['M107', 'M104 S0', 'M140 S0', 'G91', 'G1 E-2', 'G1 Z5', 'G90', 'G28 X Y', 'M84'];

function file(layers = 6, edit: (lines: string[]) => void = () => {}): string {
  const lines = [...start];
  for (let n = 1; n <= layers; n++) lines.push(...layer(n));
  lines.push(...end);
  edit(lines);
  return lines.join('\n');
}

const check = (text: string) => checkGcode(text, limits);
const reasons = (report: GcodeReport) => report.problems.map((p) => p.reason);
const lineOf = (lines: string[], text: string) => lines.indexOf(text) + 1;

function replace(lines: string[], from: string, to: string[]) {
  const at = lines.indexOf(from);
  if (at === -1) throw new Error(`no line ${from}`);
  lines.splice(at, 1, ...to);
}

describe('checkGcode', () => {
  it('passes a plain file and reports what it read', () => {
    const text = file();
    const report = check(text);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats).toMatchObject({
      lines: text.split('\n').length,
      maxX: 120,
      maxY: 120,
      minZ: 0.2,
      nozzle: [205, 0],
      bed: [60, 0],
      fanOnLayer: 2,
      extruderMode: 'relative',
    });
    expect(report.stats.maxZ).toBeCloseTo(6.2, 6);
    expect(report.stats.moves).toBeGreaterThan(20);
  });

  it('gives the same report line by line', () => {
    const text = file();
    const checker = createGcodeChecker(limits);
    for (const line of text.split('\n')) checker.line(line);
    expect(checker.finish()).toEqual(check(text));
  });

  it('reads Windows line ends, comments, line numbers and checksums', () => {
    const text = file(6, (lines) => lines.splice(8, 0, '', '; only a comment', 'N12 G1 X50 Y50*71'));
    expect(check(text.replace(/\n/g, '\r\n')).problems).toEqual([]);
  });

  it('ends a line at a lone carriage return, as the printer does', () => {
    const cases: [string, string][] = [
      ['G1 X50 ;wipe\rM502', 'M502 resets the printer’s settings to factory defaults, which a print file must never do.'],
      ['G4 P0\rG1 X300 Y300', 'Moves outside the bed: X 300 mm, the printer allows 0 to 220 mm.'],
      ['M117 hi\rM104 S280', 'Sets the nozzle to 280 °C. PLA must be 190 to 230 °C.'],
      ['G1 X50 ; wipe\rM500', 'M500 saves settings to the printer’s memory, which a print file must never do.'],
    ];
    for (const [extra, reason] of cases) expect(reasons(check(file(6, (l) => l.push(extra))))).toContain(reason);
  });

  it('fails a control character left inside a line, such as a backspace that erases text on the printer', () => {
    const control = 'Has a control character, such as a carriage return or a backspace, that changes what the printer reads.';
    const backspaces = [
      `M117 abc${'\b'.repeat(8)}M502`,
      `M117 x${'\b'.repeat(6)}G1 X300 Y300`,
      `M117 x${'\b'.repeat(6)}M104 S275`,
      'G1 X10 ; note\u0000',
    ];
    for (const extra of backspaces) {
      const report = check(file(6, (l) => l.push(extra)));
      expect(reasons(report)).toEqual([control]);
      expect(report.problems[0]!.text).toMatch(/\\x0[08]/);
    }
    // a line handed over with a "\r" inside it is not split again
    const checker = createGcodeChecker(limits);
    for (const line of file(6, (l) => l.push('G4 P0\rM502')).split('\n')) checker.line(line);
    expect(reasons(checker.finish())).toEqual([control]);
    expect(check(file(6, (l) => l.push('G4\tP0'))).ok).toBe(true);
  });

  it('fails a byte order mark or other character that is not plain text before the comment', () => {
    const notPlain = 'Has a character that is not plain text before its comment, which the printer reads differently.';
    expect(reasons(check(`\uFEFF${file()}`))).toContain(notPlain);
    expect(reasons(check(file(6, (l) => replace(l, 'M104 S205', ['M104\u00a0S205']))))).toEqual([notPlain]);
    expect(check(file(6, (l) => replace(l, 'G1 X10 Y5', ['G1 X10 Y5 ; to the purge line, 205 °C'])))).toMatchObject({ ok: true });
  });

  it('fails a line longer than the printer reads, which would cut off its end', () => {
    expect(MAX_LINE_CHARS).toBe(95);
    const fits = `G1 X10${' '.repeat(86)}Y10`;
    expect(fits.length).toBe(95);
    expect(reasons(check(file(6, (l) => l.push(` ${fits}`))))).toEqual(['Is longer than the 95 characters the printer reads from a line.']);
    expect(check(file(6, (l) => l.push(`${fits}; a long comment does not count${'.'.repeat(80)}`))).ok).toBe(true);
  });

  it('splits lines the same way when the file arrives in pieces', () => {
    const text = `G28\r\nM83\rM104 S205\n\nM109 S205\r`;
    const whole: string[] = [];
    const split = createLineSplitter((line) => whole.push(line));
    split.push(text);
    split.end();
    expect(whole).toEqual(['G28', 'M83', 'M104 S205', '', 'M109 S205']);
    for (let cut = 0; cut <= text.length; cut++) {
      const pieces: string[] = [];
      const parts = createLineSplitter((line) => pieces.push(line));
      parts.push(text.slice(0, cut));
      parts.push(text.slice(cut));
      parts.end();
      expect(pieces).toEqual(whole);
    }
  });

  it('fails a move past the bed in X, with its line number', () => {
    let lines: string[] = [];
    const report = check(file(6, (l) => {
      replace(l, 'G1 X100 Y100', ['G1 X230 Y100']);
      lines = l;
    }));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toEqual({
      line: lineOf(lines, 'G1 X230 Y100'),
      text: 'G1 X230 Y100',
      reason: 'Moves outside the bed: X 230 mm, the printer allows 0 to 220 mm.',
    });
  });

  it('fails a move past the bed in Y and below zero in X', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X100 Y221']))))).toEqual([
      'Moves outside the bed: Y 221 mm, the printer allows 0 to 220 mm.',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X10 Y5', ['G1 X-1 Y5']))))).toEqual([
      'Moves outside the bed: X -1 mm, the printer allows 0 to 220 mm.',
    ]);
  });

  it('fails a move below the bed and above the build height', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 Z-0.1 F3000', 'G1 Z0.3']))))).toEqual([
      'Moves the nozzle below the bed (Z -0.1 mm).',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z5', ['G1 Z250']))))).toEqual([
      'Moves outside the bed: Z 251.2 mm, the printer allows 0 to 250 mm.',
    ]);
  });

  it('fails a move down to Z 0, where the nozzle touches the bed', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 Z0 F3000', 'G1 Z0.3']))))).toEqual([
      'Moves the nozzle down onto the bed (Z 0 mm).',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X120 Y100 E1', ['G1 Z0', 'G1 X120 Y100 E1']))))).toEqual([
      'Moves the nozzle down onto the bed (Z 0 mm).',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 Z-0.000001 F3000', 'G1 Z0.3']))))).toEqual([
      'Moves the nozzle down onto the bed (Z 0 mm).',
    ]);
    expect(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 Z0.05 F3000', 'G1 Z0.3']))).ok).toBe(true);
  });

  it('fails a move before the printer is homed', () => {
    const report = check(file(6, (l) => l.unshift('G1 X10 Y10')));
    expect(report.problems.map((p) => [p.line, p.reason])).toEqual([
      [1, 'Moves before the printer is homed (G28).'],
    ]);
  });

  it('fails a file with no home command at all', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G28', []))))).toContain('Moves before the printer is homed (G28).');
  });

  it('fails nozzle temperatures outside the PLA range, and allows 0 for off', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'M104 S205', ['M104 S250']))))).toEqual([
      'Sets the nozzle to 250 °C. PLA must be 190 to 230 °C.',
    ]);
    const cold = reasons(check(file(6, (l) => replace(l, 'M109 S205', ['M109 S170']))));
    expect(cold).toContain('Sets the nozzle to 170 °C. PLA must be 190 to 230 °C.');
    expect(cold).toContain('Extrudes before waiting for the nozzle to heat (M109).');
    expect(check(file()).stats.nozzle).toContain(0);
  });

  it('fails a bed that is too hot, also when set with R', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'M140 S60', ['M140 S80']))))).toEqual([
      'Sets the bed to 80 °C. PLA needs at most 70 °C.',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'M190 S60', ['M190 R75']))))).toEqual([
      'Sets the bed to 75 °C. PLA needs at most 70 °C.',
    ]);
  });

  it('fails heater words that set a temperature some other way than S or R', () => {
    const cases: [string, string][] = [
      ['M104 I1', 'M104 I picks a stored preset temperature, which a print file must never use.'],
      ['M140 I1', 'M140 I picks a stored preset temperature, which a print file must never use.'],
      ['M190 I1', 'M190 I picks a stored preset temperature, which a print file must never use.'],
      ['M109 S205 I1', 'M109 I picks a stored preset temperature, which a print file must never use.'],
      ['M104 S205 F1', 'M104 F changes the temperature on its own while printing, which a print file must never use.'],
      ['M109 S205 F2', 'M109 F changes the temperature on its own while printing, which a print file must never use.'],
      ['M104 S205 B260 F1', 'M104 B changes the temperature on its own while printing, which a print file must never use.'],
      ['M109 S205 B260', 'M109 B changes the temperature on its own while printing, which a print file must never use.'],
      ['M104 S205 T1', 'M104 T1 heats another nozzle, and these printers have one.'],
      ['M140 S60 P1', 'M140 P is not allowed. A heater line may only give the temperature with S.'],
      ['M109 S205 R205', 'M109 gives the temperature twice, with both S and R.'],
      ['M104', 'M104 gives no temperature.'],
      ['M140 R60', 'M140 R is not allowed. A heater line may only give the temperature with S.'],
    ];
    for (const [extra, reason] of cases) {
      const report = check(file(6, (l) => replace(l, 'M107', [extra, 'M107'])));
      expect(reasons(report)).toEqual([reason]);
      expect(report.stats.nozzle).toEqual([205, 0]);
    }
    expect(check(file(6, (l) => replace(l, 'M104 S205', ['M104 T0 S205']))).ok).toBe(true);
    expect(check(file(6, (l) => replace(l, 'M109 S205', ['M109 R205 T0']))).ok).toBe(true);
  });

  it('fails commands that change or save printer settings', () => {
    const report = check(file(6, (l) => l.push('M500', 'M502', 'M997', 'M999', 'G29', 'M92 E400')));
    expect(reasons(report)).toEqual([
      'M500 saves settings to the printer’s memory, which a print file must never do.',
      'M502 resets the printer’s settings to factory defaults, which a print file must never do.',
      'M997 starts a firmware update, which a print file must never do.',
      'M999 restarts the printer after an error, which a print file must never do.',
      'G29 is not on the list of allowed commands.',
      'M92 changes the motor steps per millimetre, which a print file must never do.',
    ]);
  });

  it('reads leading zeros and lower case as the same command', () => {
    expect(check(file(6, (l) => l.push('m500'))).ok).toBe(false);
    expect(check(file(6, (l) => replace(l, 'G1 X100 Y100', ['g01 x100 y100']))).ok).toBe(true);
  });

  it('takes its own list of allowed commands', () => {
    const report = checkGcode(file(), { ...limits, allowed: ['G0', 'G1', 'G28', 'G90', 'G91', 'G92', 'M82', 'M83', 'M104', 'M109', 'M140', 'M190', 'M106', 'M107'] });
    expect(reasons(report)).toEqual(['M84 is not on the list of allowed commands.']);
  });

  it('fails extruding before the extruder mode is set', () => {
    const report = check(file(6, (l) => replace(l, 'M83', [])));
    expect(reasons(report)).toEqual(['Extrudes before the extruder mode is set (M82 or M83).']);
    expect(report.problems[0]!.text).toBe('G1 X60 Y5 E20 F500 ; purge line');
    expect(report.stats.extruderMode).toBe('absolute');
  });

  it('reports absolute extrusion and reads E as a running total', () => {
    const text = file(6, (l) => {
      replace(l, 'M83', ['M82']);
      let total = 0;
      for (let i = 0; i < l.length; i++) {
        if (l[i] === 'G92 E0') total = 0;
        const match = / E(\d+)/.exec(l[i]!);
        if (match && l[i]!.startsWith('G1 X1')) {
          total += Number(match[1]);
          l[i] = l[i]!.replace(/ E\d+/, ` E${total}`);
        }
      }
    });
    const report = check(text);
    expect(report.problems).toEqual([]);
    expect(report.stats.extruderMode).toBe('absolute');
  });

  it('fails a move that pushes far too much filament, as a wrong extruder mode does', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X120 Y100 E1', ['G1 X120 Y100 E1068']))))).toEqual([
      'Moves 1068 mm of filament in one move, so the extruder mode is probably wrong.',
    ]);
  });

  it('fails a part fan that never turns on, at the first layer where it is too late', () => {
    let lines: string[] = [];
    const report = check(file(6, (l) => {
      replace(l, 'M106 S255', []);
      lines = l;
    }));
    expect(report.stats.fanOnLayer).toBe(null);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]!.reason).toBe('The part fan is still off at layer 4. PLA needs it on by layer 3.');
    expect(report.problems[0]!.line).toBe(lines.indexOf(';LAYER:4') + 4);
  });

  it('passes a fan that turns on at layer 3 and fails one that turns on at layer 5', () => {
    const at3 = check(file(6, (l) => {
      replace(l, 'M106 S255', []);
      replace(l, ';LAYER:3', [';LAYER:3', 'M106 S200']);
    }));
    expect(at3.ok).toBe(true);
    expect(at3.stats.fanOnLayer).toBe(3);
    const at5 = check(file(6, (l) => {
      replace(l, 'M106 S255', []);
      replace(l, ';LAYER:5', [';LAYER:5', 'M106']);
    }));
    expect(reasons(at5)).toEqual(['The part fan is still off at layer 4. PLA needs it on by layer 3.']);
    expect(at5.stats.fanOnLayer).toBe(5);
  });

  it('fails a part fan that is turned off again during the print', () => {
    expect(reasons(check(file(8, (l) => replace(l, ';LAYER:5', [';LAYER:5', 'M107']))))).toEqual([
      'The part fan is turned off again at layer 5.',
    ]);
    expect(check(file(8, (l) => replace(l, ';LAYER:5', [';LAYER:5', 'M106 P1 S0']))).ok).toBe(true);
  });

  it('counts a fan below half speed as off', () => {
    const slow = check(file(6, (l) => replace(l, 'M106 S255', ['M106 S1'])));
    expect(reasons(slow)).toEqual(['The part fan is still below half speed at layer 4. PLA needs it on by layer 3.']);
    expect(slow.stats.fanOnLayer).toBe(null);
    expect(check(file(6, (l) => replace(l, 'M106 S255', ['M106 S128']))).stats.fanOnLayer).toBe(2);
    expect(reasons(check(file(8, (l) => replace(l, ';LAYER:5', [';LAYER:5', 'M106 S100']))))).toEqual([
      'The part fan is turned down below half speed again at layer 5.',
    ]);
  });

  it('allows only S and P on fan lines', () => {
    for (const extra of ['M106 I1', 'M106 S255 T1', 'M107 S0']) {
      const code = extra.slice(0, 4);
      const key = extra.includes('I1') ? 'I' : extra.includes('T1') ? 'T' : 'S';
      expect(reasons(check(file(6, (l) => replace(l, 'M107', [extra, 'M107']))))).toEqual([
        `${code} ${key} is not allowed. A fan line may only give the speed with S and the fan with P.`,
      ]);
    }
  });

  it('fails a file whose moves do not push the filament total it states, as when E values do not match M82 or M83', () => {
    // 40 layers of 2 mm and a 20 mm purge line
    const stated = (mm: number) => (l: string[]) => l.push(`; --- filament used: ${mm} mm ---`);
    expect(check(file(40, stated(100))).ok).toBe(true);
    expect(check(file(40, stated(80))).ok).toBe(true);
    const mismatch = check(file(40, (l) => {
      replace(l, 'M83', ['M82']);
      stated(100)(l);
    }));
    expect(reasons(mismatch)).toEqual([
      'The moves push 21 mm of filament, but the file says it uses 100 mm, so the extruder mode is probably wrong.',
    ]);
    expect(mismatch.problems[0]!.line).toBe(file(40, stated(100)).split('\n').length);
    // the layers are still counted, so the fan check still runs
    expect(mismatch.stats.fanOnLayer).toBe(2);
    expect(reasons(check(file(40, (l) => {
      replace(l, 'M83', ['M82']);
      replace(l, 'M106 S255', []);
    })))).toEqual(['The part fan is still off at layer 4. PLA needs it on by layer 3.']);
  });

  it('counts the first layer again when it starts below the purge line', () => {
    const report = check(file(6));
    expect(report.stats.fanOnLayer).toBe(2);
  });

  it('follows relative moves and fails the one that walks out of the bed', () => {
    const back = check(file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X100 Y100', 'G91', 'G1 X50', 'G1 X50', 'G1 X-100', 'G90'])));
    expect(back.problems).toEqual([]);
    expect(back.stats.maxX).toBe(200);
    const walk = check(file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X100 Y100', 'G91', 'G1 X50', 'G1 X50', 'G1 X50', 'G90', 'G1 X100'])));
    expect(reasons(walk)).toEqual(['Moves outside the bed: X 250 mm, the printer allows 0 to 220 mm.']);
    expect(walk.problems[0]!.text).toBe('G1 X50');
  });

  it('fails a relative move right after homing, when the position is not known', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G28', ['G28', 'G91', 'G1 Z5', 'G90']))))).toEqual([
      'Moves Z by a relative amount while its position is unknown, right after homing.',
    ]);
  });

  it('fails filament pushed from a place homing left unknown', () => {
    const where = 'Pushes filament from a place that is not known, right after homing (G28). Move to X, Y and Z first.';
    // homing X and Y parks the head off the bed's edge on some printers, so a purge from there is refused
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X60 Y5 E20 F500 ; purge line', ['G28 X Y', 'G1 X100 E20 F500']))))).toContain(where);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X10 Y5', ['G1 E20', 'G1 X200 E10']))))).toContain(where);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 X10 Y5', ['G1 Y3']))))).toEqual([where]);
    // a travel move with one side still at its home position is fine, as at the end of the Kobra 2 Neo's code
    expect(check(file(6, (l) => replace(l, 'G28 X Y', ['G28 X Y', 'G1 Y220']))).ok).toBe(true);
  });

  it('fails a move across the bed before the nozzle height is set after homing', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 X10 Y10', 'G1 Z0.3 F3000']))))).toEqual([
      'Moves across the bed before the nozzle height is known, right after homing (G28).',
    ]);
    expect(reasons(check(file(6, (l) => replace(l, 'G1 Z0.3 F3000', ['G1 X10 Y10 Z5']))))).toEqual([
      'Moves across the bed before the nozzle height is known, right after homing (G28).',
    ]);
  });

  it('fails an arc that leaves the bed and passes one that stays on it', () => {
    const arc = (code: string) => file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X215 Y100', `${code} X215 Y120 I0 J10 E1`, 'G1 X100 Y100']));
    expect(reasons(check(arc('G3')))).toEqual(['Draws an arc that leaves the bed (it reaches X 225, Y 110 mm).']);
    expect(check(arc('G2')).ok).toBe(true);
  });

  it('fails a full circle and a radius arc that leave the bed', () => {
    const circle = file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X205 Y110', 'G2 I10 J0', 'G1 X100 Y100']));
    expect(reasons(check(circle))).toEqual(['Draws an arc that leaves the bed (it reaches X 225, Y 110 mm).']);
    // from (10, 100) to (10, 120): with R 14.142 the short way round, with R -14.142 the long way, which bulges past X 0
    const radius = (code: string, r: number) =>
      file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X10 Y100', `${code} X10 Y120 R${r}`, 'G1 X100 Y100']));
    expect(check(radius('G2', 14.142)).ok).toBe(true);
    expect(check(radius('G3', 14.142)).ok).toBe(true);
    expect(reasons(check(radius('G2', -14.142)))).toEqual(['Draws an arc that leaves the bed (it reaches X -14.14, Y 110 mm).']);
    expect(reasons(check(radius('G2', 5)))).toEqual(['Draws an arc whose radius is too small for its two ends.']);
  });

  it('fails G92 on X, Y or Z, which hides the real position', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'G92 E0', ['G92 X0 Y0 E0']))))).toEqual([
      'G92 gives X a new position, so the moves after it cannot be checked against the bed.',
      'G92 gives Y a new position, so the moves after it cannot be checked against the bed.',
    ]);
  });

  it('allows M420 only to turn bed levelling on or off', () => {
    expect(check(file(6, (l) => replace(l, 'G28', ['G28', 'M420 S1']))).ok).toBe(true);
    expect(reasons(check(file(6, (l) => replace(l, 'G28', ['G28', 'M420 Z10']))))).toEqual([
      'M420 may only turn bed levelling on or off (S1 or S0).',
    ]);
  });

  it('fails lines it cannot read, such as a template left unfilled', () => {
    expect(reasons(check(file(6, (l) => replace(l, 'M104 S205', ['M104 S{temp}']))))).toEqual([
      'This line could not be read.',
    ]);
  });

  it('fails numbers the printer reads differently, and a letter given twice', () => {
    for (const extra of ['G1 X300E-1', 'G1 X300E-1 Y50', 'G1 Z-0.5E-7', 'G1 X0x20', 'G1 X1e2', 'G1 X50 X300', 'G1 X50 x60', 'G1 X--5', 'G1 X.']) {
      expect(reasons(check(file(6, (l) => replace(l, 'M107', [extra, 'M107']))))).toEqual(['This line could not be read.']);
    }
    expect(check(file(6, (l) => replace(l, 'G1 X100 Y100', ['G1 X+100. Y.5', 'G1 X100 Y100']))).ok).toBe(true);
  });

  it('fails a file with no moves', () => {
    expect(reasons(check('M104 S0\n'))).toEqual(['The file has no moves.']);
  });

  it('keeps only the first few problems of each kind', () => {
    const report = check(file(6, (l) => {
      for (let i = 0; i < 10000; i++) l.push('G1 X300');
      l.push('M500');
    }));
    expect(report.problems).toHaveLength(6);
    expect(report.problems[5]!.reason).toContain('M500');
  });

  it('reads a large file one line at a time', () => {
    const body = 'G1 X100 Y100\nG1 X120 Y100 E0.5\nG1 X120 Y120 E0.5\n'.repeat(100000);
    const text = file(6, (l) => replace(l, ';LAYER:6', [';LAYER:6', body]));
    const report = check(text);
    expect(report.ok).toBe(true);
    expect(report.stats.lines).toBeGreaterThan(300000);
  });
});
