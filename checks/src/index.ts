import { bedFaces, checkBase } from '#checks/base';
import { checkClosed } from '#checks/closed';
import { checkFits } from '#checks/fits';
import { DEFAULT_OVERHANG_DEG } from '#checks/limits';
import { buildMesh, signedVolume } from '#checks/mesh';
import { checkOverhang } from '#checks/overhang';
import { readStl } from '#checks/stl';
import { type CheckOptions, DEFAULT_BED, type Report, type Vec3 } from '#checks/types';

export type { Bed, CheckId, CheckOptions, CheckResult, Report, Vec3 } from '#checks/types';
export { DEFAULT_BED } from '#checks/types';
export { bedLabel } from '#checks/fits';
export * as limits from '#checks/limits';
export {
  checkGcode,
  createGcodeChecker,
  DEFAULT_ALLOWED,
  FAN_BY_LAYER,
  MAX_E_PER_MOVE_MM,
  PLA_LIMITS,
  type GcodeLimits,
  type GcodeProblem,
  type GcodeReport,
} from '#checks/gcode';

/**
 * Runs the print checks on a mesh.
 * positions: separate triangles, nine numbers each (three corners), in mm, with Z up.
 */
export function checkMesh(positions: Float32Array, opts: CheckOptions = {}): Report {
  const started = now();
  const bed = opts.bed ?? DEFAULT_BED;
  const deg = opts.overhangDeg ?? DEFAULT_OVERHANG_DEG;
  validate(positions, opts);

  const mesh = buildMesh(positions);
  const volume = signedVolume(mesh);
  const size: Vec3 = [mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]];
  const onBed = bedFaces(mesh);
  const results = [checkClosed(mesh, volume), checkFits(size, bed), checkBase(mesh, onBed), checkOverhang(mesh, onBed, deg)];
  return {
    ok: results.every((result) => result.ok),
    results,
    ms: now() - started,
    stats: { triangles: mesh.triangles, volume, size, min: mesh.min },
  };
}

/** Runs the print checks on a binary STL file. */
export function checkStl(buf: ArrayBuffer | Uint8Array, opts: CheckOptions = {}): Report {
  return checkMesh(readStl(buf), opts);
}

function validate(positions: Float32Array, { bed, overhangDeg }: CheckOptions) {
  if (positions.length % 9 !== 0) throw new Error(`Expected nine numbers per triangle, got ${positions.length} numbers.`);
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error(`Triangle ${Math.floor(i / 9) + 1} has a value that is not a number.`);
  }
  if (bed && ![bed.x, bed.y, bed.z].every((side) => Number.isFinite(side) && side > 0)) {
    throw new RangeError('Each bed size must be a number above zero.');
  }
  if (overhangDeg !== undefined && !(overhangDeg >= 0 && overhangDeg <= 90)) {
    throw new RangeError('The overhang limit must be between 0 and 90 degrees.');
  }
}

// performance.now where it exists (browsers, workers, Node), without needing DOM or Node types.
function now(): number {
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  return clock ? clock.now() : Date.now();
}
