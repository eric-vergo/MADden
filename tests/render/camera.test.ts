import { describe, expect, it } from 'vitest';
import { Camera, CAMERA_TUNING } from '../../src/render/Camera';
import { CENTER_X, FIELD_L, FIELD_W } from '../../src/sim/constants';
import { RecordingCtx } from './mockCtx';

const W = 1280;
const H = 720;

function cam(): Camera {
  const c = new Camera(W, H, 1);
  c.snapTo(FIELD_L / 2);
  return c;
}

describe('Camera scale', () => {
  it('fits the field width plus margin', () => {
    const c = cam();
    const spanYd = W / c.pxPerYard;
    expect(spanYd).toBeCloseTo(FIELD_W + CAMERA_TUNING.sideMarginYd * 2, 6);
    // Both sidelines are on screen with margin to spare.
    expect(c.toScreenX(0)).toBeGreaterThan(0);
    expect(c.toScreenX(FIELD_W)).toBeLessThan(W);
  });

  it('rescales on resize and respects the zoom clamp', () => {
    const c = cam();
    const before = c.pxPerYard;
    c.resize(W * 2, H, 1);
    expect(c.pxPerYard).toBeCloseTo(before * 2, 6);
    c.setZoom(99);
    expect(c.zoom).toBe(CAMERA_TUNING.zoomMax);
    c.setZoom(0);
    expect(c.zoom).toBe(CAMERA_TUNING.zoomMin);
  });
});

describe('Camera world <-> screen', () => {
  it('round-trips in both orientations', () => {
    for (const flipped of [false, true]) {
      const c = cam();
      c.setOrientation(flipped ? -1 : 1);
      c.snapTo(42);
      for (const [wx, wy] of [
        [0, 0],
        [CENTER_X, 60],
        [FIELD_W, FIELD_L],
        [12.5, 37.25],
      ] as Array<[number, number]>) {
        const s = c.worldToScreen(wx, wy);
        const back = c.screenToWorld(s.x, s.y);
        expect(back.x).toBeCloseTo(wx, 6);
        expect(back.y).toBeCloseTo(wy, 6);
      }
    }
  });

  it('renders +y up for the team attacking +y and flips on request', () => {
    const c = cam();
    c.snapTo(50);
    expect(c.toScreenY(60)).toBeLessThan(c.toScreenY(40));
    c.setOrientation(-1);
    expect(c.toScreenY(60)).toBeGreaterThan(c.toScreenY(40));
  });

  it('puts the camera centre at the viewport centre', () => {
    const c = cam();
    c.snapTo(33);
    expect(c.toScreenY(33)).toBeCloseTo(H / 2, 6);
    expect(c.toScreenX(CENTER_X)).toBeCloseTo(W / 2, 6);
  });

  it('converts lengths consistently with positions', () => {
    const c = cam();
    expect(c.toPx(10)).toBeCloseTo(Math.abs(c.toScreenY(60) - c.toScreenY(50)), 6);
  });
});

describe('Camera clamping', () => {
  it('never shows past either end line', () => {
    const c = cam();
    const half = c.halfHeightYd();
    c.snapTo(-50);
    expect(c.centerY).toBeCloseTo(half, 6);
    expect(c.visibleYRange()[0]).toBeGreaterThanOrEqual(0);
    c.snapTo(500);
    expect(c.centerY).toBeCloseTo(FIELD_L - half, 6);
    expect(c.visibleYRange()[1]).toBeLessThanOrEqual(FIELD_L);
  });

  it('centres when the viewport is taller than the field', () => {
    const c = new Camera(200, 4000, 1);
    c.snapTo(10);
    expect(c.centerY).toBeCloseTo(FIELD_L / 2, 6);
  });

  it('clamps the follow target into the field', () => {
    const c = cam();
    c.setTarget(-30);
    expect(c.targetY).toBe(0);
    c.setTarget(1000);
    expect(c.targetY).toBe(FIELD_L);
    c.setTarget(Number.NaN);
    expect(c.targetY).toBe(FIELD_L / 2);
  });
});

describe('Camera follow', () => {
  it('converges on the target without overshooting', () => {
    const c = cam();
    c.snapTo(40);
    c.setTarget(80);
    let maxSeen = -Infinity;
    for (let i = 0; i < 240; i++) {
      c.update(1 / 60);
      maxSeen = Math.max(maxSeen, c.centerY);
    }
    expect(c.centerY).toBeCloseTo(80, 3);
    expect(maxSeen).toBeLessThanOrEqual(80 + 1e-6);
  });

  it('moves monotonically toward the target', () => {
    const c = cam();
    c.snapTo(30);
    c.setTarget(70);
    let prev = c.centerY;
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60);
      expect(c.centerY).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c.centerY;
    }
  });

  it('ignores a zero or absurd dt', () => {
    const c = cam();
    c.snapTo(40);
    c.setTarget(80);
    c.update(0);
    expect(c.centerY).toBe(40);
    c.update(Number.NaN);
    expect(c.centerY).toBe(40);
    c.update(60); // clamped to 0.25s, still finite and inside the field
    expect(Number.isFinite(c.centerY)).toBe(true);
    expect(c.centerY).toBeLessThanOrEqual(FIELD_L);
  });

  it('stays inside the field while following a target near the end zone', () => {
    const c = cam();
    c.setTarget(118);
    for (let i = 0; i < 300; i++) c.update(1 / 60);
    const [lo, hi] = c.visibleYRange();
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(FIELD_L);
  });
});

describe('Camera device pixel ratio', () => {
  it('caps DPR at 2 and floors it at 1', () => {
    const c = new Camera(W, H, 3);
    expect(c.dpr).toBe(CAMERA_TUNING.maxDpr);
    c.resize(W, H, 0.5);
    expect(c.dpr).toBe(1);
    c.resize(W, H, 1.5);
    expect(c.dpr).toBe(1.5);
  });

  it('sizes the backing store and emits one setTransform', () => {
    const c = new Camera(W, H, 3);
    expect(c.backingWidth()).toBe(W * 2);
    expect(c.backingHeight()).toBe(H * 2);
    const ctx = new RecordingCtx();
    c.applyTransform(ctx);
    expect(ctx.log).toEqual(['setTransform(2,0,0,2,0,0)']);
  });

  it('keeps CSS-pixel drawing independent of DPR', () => {
    const a = new Camera(W, H, 1);
    const b = new Camera(W, H, 2);
    expect(b.pxPerYard).toBeCloseTo(a.pxPerYard, 9);
    expect(b.toScreenY(70)).toBeCloseTo(a.toScreenY(70), 9);
  });
});

describe('Camera culling', () => {
  it('rejects points well outside the view', () => {
    const c = cam();
    c.snapTo(20);
    expect(c.isVisible(CENTER_X, 20)).toBe(true);
    expect(c.isVisible(CENTER_X, 119)).toBe(false);
    expect(c.isVisible(-40, 20)).toBe(false);
  });
});
