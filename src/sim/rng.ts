// Seeded, forkable PRNG. mulberry32 core with xmur3-style label hashing so
// adding a random call in one module never reshuffles another module's stream.
// ALL sim/meta randomness must flow through an Rng instance — never Math.random.

export function hashSeed(...parts: readonly (string | number)[]): number {
  let h = 1779033703 ^ parts.length;
  const s = parts.join(':');
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  private s: number;
  private spareGauss: number | null = null;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    const v = arr[this.int(0, arr.length - 1)];
    if (v === undefined && arr.length === 0) throw new Error('Rng.pick on empty array');
    return v as T;
  }

  /** Standard normal (mean 0, sd 1) via Box–Muller. */
  gauss(): number {
    if (this.spareGauss !== null) {
      const v = this.spareGauss;
      this.spareGauss = null;
      return v;
    }
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareGauss = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Derive an independent stream keyed by label (does not advance this stream). */
  fork(label: string): Rng {
    return new Rng(hashSeed(this.s, label));
  }
}

/** The sim's fixed set of independent streams, forked once at GameSim construction. */
export interface RngSet {
  physics: Rng;
  ai: Rng;
  penalties: Rng;
  misc: Rng;
}

export function makeRngSet(seed: number): RngSet {
  const root = new Rng(seed);
  return {
    physics: root.fork('physics'),
    ai: root.fork('ai'),
    penalties: root.fork('penalties'),
    misc: root.fork('misc'),
  };
}
