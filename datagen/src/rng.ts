// A small seeded random number generator (mulberry32), so the same seed always gives the same parts.

// Mixes the bits of a 32-bit number (the murmur3 finalizer).
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The seed of child number `index`: it depends only on the parent seed and the index, never on how many came before. */
export function childSeed(seed: number, index: number): number {
  return mix((mix(seed >>> 0) + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
}

const tidy = (value: number) => Number(value.toFixed(6));

export class Rng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('A seed is a whole number from 0 to 4294967295.');
    this.seed = seed;
    this.state = seed;
  }

  /** A number from 0 up to, not including, 1. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from lo to hi, both included. */
  int(lo: number, hi: number): number {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`No whole number from ${lo} to ${hi}.`);
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(list: readonly T[]): T {
    if (list.length === 0) throw new RangeError('Cannot pick from an empty list.');
    return list[this.int(0, list.length - 1)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A size from lo to hi on a fixed step (1 for whole mm, 0.5 for half mm), so values look like real design sizes. */
  size(lo: number, hi: number, step = 1): number {
    const first = Math.ceil(tidy(lo / step));
    const last = Math.floor(tidy(hi / step));
    if (last < first) throw new RangeError(`No size from ${lo} to ${hi} on a ${step} step.`);
    return tidy(this.int(first, last) * step);
  }

  /** A new generator for child number `index`, the same however much of this one has been used. */
  child(index: number): Rng {
    return new Rng(childSeed(this.seed, index));
  }
}
