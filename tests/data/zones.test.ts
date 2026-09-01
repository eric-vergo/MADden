import { describe, expect, it } from 'vitest';
import { ZONES, ZONE_LANDMARKS, ZONE_NAMES, isDeepZone, resolveZone } from '../../src/data/zones';
import { FIELD_W } from '../../src/sim/constants';
import type { ZoneName } from '../../src/sim/types';

/** Every member of the frozen ZoneName union, spelled out on purpose. */
const EVERY_ZONE: readonly ZoneName[] = [
  'deepThird-L', 'deepThird-M', 'deepThird-R',
  'deepHalf-L', 'deepHalf-R',
  'deepQuarter-1', 'deepQuarter-2', 'deepQuarter-3', 'deepQuarter-4',
  'curlFlat-L', 'curlFlat-R',
  'hook-L', 'hook-M', 'hook-R',
  'flat-L', 'flat-R',
];

describe('zone table', () => {
  it('covers every ZoneName exactly once', () => {
    expect([...ZONE_NAMES].sort()).toEqual([...EVERY_ZONE].sort());
    expect(Object.keys(ZONES).sort()).toEqual([...EVERY_ZONE].sort());
    expect(new Set(ZONE_NAMES).size).toBe(ZONE_NAMES.length);
  });

  it('gives every zone a usable radius and depth band', () => {
    for (const name of EVERY_ZONE) {
      const z = ZONES[name];
      expect(z.radius, name).toBeGreaterThan(3);
      expect(z.radius, name).toBeLessThan(14);
      expect(z.minDepth, name).toBeLessThan(z.maxDepth);
      expect(z.depth, name).toBeGreaterThanOrEqual(z.minDepth);
      expect(z.depth, name).toBeLessThanOrEqual(z.maxDepth);
      expect(Math.abs(z.dx), name).toBeLessThan(20);
    }
  });

  it('classifies deep zones by their floor, not their name', () => {
    for (const name of EVERY_ZONE) {
      expect(isDeepZone(name), name).toBe(name.startsWith('deep'));
    }
  });

  it('orders the field left to right within each family', () => {
    expect(ZONES['deepThird-L'].dx).toBeLessThan(ZONES['deepThird-M'].dx);
    expect(ZONES['deepThird-M'].dx).toBeLessThan(ZONES['deepThird-R'].dx);
    expect(ZONES['deepHalf-L'].dx).toBeLessThan(ZONES['deepHalf-R'].dx);
    expect(ZONES['deepQuarter-1'].dx).toBeLessThan(ZONES['deepQuarter-2'].dx);
    expect(ZONES['deepQuarter-2'].dx).toBeLessThan(ZONES['deepQuarter-3'].dx);
    expect(ZONES['deepQuarter-3'].dx).toBeLessThan(ZONES['deepQuarter-4'].dx);
    expect(ZONES['hook-L'].dx).toBeLessThan(ZONES['hook-R'].dx);
    expect(ZONES['flat-L'].dx).toBeLessThan(ZONES['flat-R'].dx);
  });

  it('puts the flats outside the curls outside the hooks', () => {
    expect(Math.abs(ZONES['flat-R'].dx)).toBeGreaterThan(Math.abs(ZONES['curlFlat-R'].dx));
    expect(Math.abs(ZONES['curlFlat-R'].dx)).toBeGreaterThan(Math.abs(ZONES['hook-R'].dx));
    expect(ZONES['flat-R'].depth).toBeLessThan(ZONES['curlFlat-R'].depth);
    expect(ZONES['curlFlat-R'].depth).toBeLessThan(ZONES['hook-R'].depth);
  });
});

describe('resolveZone', () => {
  it('places landmarks downfield of the LOS in the attack direction', () => {
    const up = resolveZone('deepThird-M', 26.6, 50, 1);
    expect(up.y).toBeGreaterThan(50);
    const down = resolveZone('deepThird-M', 26.6, 50, -1);
    expect(down.y).toBeLessThan(50);
  });

  it('mirrors x with the attack direction', () => {
    const right = resolveZone('flat-R', 26.6, 50, 1);
    const mirrored = resolveZone('flat-R', 26.6, 50, -1);
    expect(right.x - 26.6).toBeCloseTo(-(mirrored.x - 26.6), 6);
  });

  it('keeps landmarks inbounds from either hash', () => {
    for (const ballX of [23.583, 26.666, 29.75]) {
      for (const dir of [1, -1] as const) {
        for (const name of EVERY_ZONE) {
          const r = resolveZone(name, ballX, 40, dir);
          expect(r.x, `${name}@${ballX}`).toBeGreaterThanOrEqual(0);
          expect(r.x, `${name}@${ballX}`).toBeLessThanOrEqual(FIELD_W);
        }
      }
    }
  });

  it('returns an ordered depth band containing the landmark', () => {
    for (const dir of [1, -1] as const) {
      for (const name of EVERY_ZONE) {
        const r = resolveZone(name, 26.6, 60, dir);
        expect(r.minY, name).toBeLessThan(r.maxY);
        expect(r.y, name).toBeGreaterThanOrEqual(r.minY);
        expect(r.y, name).toBeLessThanOrEqual(r.maxY);
      }
    }
  });

  it('exposes the same table in the coverage AI landmark shape', () => {
    expect(Object.keys(ZONE_LANDMARKS).sort()).toEqual([...EVERY_ZONE].sort());
    for (const name of EVERY_ZONE) {
      const l = ZONE_LANDMARKS[name];
      const z = ZONES[name];
      expect(l.x, name).toBe(z.dx);
      expect(l.y, name).toBe(z.depth);
      expect(l.radius, name).toBe(z.radius);
      expect(l.minDepth, name).toBe(z.minDepth);
    }
  });

  it('is a pure function of its inputs', () => {
    const a = resolveZone('hook-M', 26.6, 33, 1);
    const b = resolveZone('hook-M', 26.6, 33, 1);
    expect(a).toEqual(b);
  });
});
