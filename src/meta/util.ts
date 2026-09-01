// Small pure helpers shared by the meta layer. No randomness, no time.

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  // Normalize -0 to 0: it survives in memory but JSON.stringify writes "0",
  // which would break save round-trip equality.
  return v === 0 ? 0 : v;
}

/** Indexed access that fails loudly instead of leaking `undefined` (noUncheckedIndexedAccess). */
export function req<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range (len ${arr.length})`);
  return v;
}

export function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += req(values, i);
  return s / values.length;
}

/**
 * Split `total` (an integer) across `weights` so the parts sum to exactly total.
 * Largest-remainder method; ties broken by lower index => fully deterministic.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;
  let wSum = 0;
  for (let i = 0; i < n; i++) wSum += Math.max(0, req(weights, i));
  if (wSum <= 0) {
    out[0] = total;
    return out;
  }
  const rem: Array<{ i: number; frac: number }> = [];
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * Math.max(0, req(weights, i))) / wSum;
    const floor = Math.floor(exact);
    out[i] = floor;
    assigned += floor;
    rem.push({ i, frac: exact - floor });
  }
  rem.sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  let k = 0;
  while (assigned < total && rem.length > 0) {
    const slot = req(rem, k % rem.length);
    out[slot.i] = req(out, slot.i) + 1;
    assigned++;
    k++;
  }
  return out;
}

/** Stable sort of record keys — never iterate a Record without this. */
export function sortedKeys(rec: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(rec).sort();
}
