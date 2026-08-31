import { describe, expect, it } from 'vitest';
import { Rng, hashSeed, makeRngSet } from '../src/sim/rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('produces values in [0, 1) with a sane mean', () => {
    const rng = new Rng(777);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('int() covers the inclusive range', () => {
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('gauss() has approximately standard normal moments', () => {
    const rng = new Rng(99);
    const n = 50000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.gauss();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(variance).toBeGreaterThan(0.9);
    expect(variance).toBeLessThan(1.1);
  });

  it('fork() streams are independent and label-stable', () => {
    const root1 = new Rng(555);
    const root2 = new Rng(555);
    const a1 = root1.fork('physics');
    const a2 = root2.fork('physics');
    const b = root1.fork('ai');
    expect(a1.next()).toBe(a2.next());
    const av = a1.next();
    const bv = b.next();
    expect(av).not.toBe(bv);
  });

  it('fork() does not advance the parent stream', () => {
    const a = new Rng(31337);
    const b = new Rng(31337);
    a.fork('anything');
    expect(a.next()).toBe(b.next());
  });

  it('hashSeed is stable and order-sensitive', () => {
    expect(hashSeed(1, 'roster', 'ASH')).toBe(hashSeed(1, 'roster', 'ASH'));
    expect(hashSeed(1, 'roster', 'ASH')).not.toBe(hashSeed(1, 'ASH', 'roster'));
  });

  it('makeRngSet streams are mutually independent', () => {
    const s1 = makeRngSet(2024);
    const s2 = makeRngSet(2024);
    expect(s1.physics.next()).toBe(s2.physics.next());
    expect(s1.ai.next()).toBe(s2.ai.next());
    const p = s1.physics.next();
    const q = s1.ai.next();
    expect(p).not.toBe(q);
  });

  it('shuffle is deterministic per seed', () => {
    const a = new Rng(7).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng(7).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });
});
