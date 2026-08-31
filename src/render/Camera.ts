// THE yards <-> pixels authority. Every renderer converts through this class;
// nothing else is allowed to invent a scale factor.
//
// Screen space is CSS pixels with the device-pixel-ratio transform already
// applied to the context (see applyTransform). The field is vertical: by
// default +y (world) renders UP the screen, which is the correct orientation
// for the team attacking +y. setOrientation(-1) flips the view 180 degrees so
// the other team also attacks "up".

import { CENTER_X, FIELD_L, FIELD_W } from '../sim/constants';
import type { Ctx2D } from './ctx';
import { clamp } from './shapes';

// TODO(balance): camera feel — move to data/balance.ts in the consolidation pass.
export const CAMERA_TUNING = {
  /** Extra world margin either side of the field so sidelines are never flush. */
  sideMarginYd: 3.2,
  /** Natural frequency (Hz) of the critically damped follow spring. */
  followFreqHz: 1.7,
  /** Device-pixel-ratio ceiling — 4K phones do not get a 3x backing store. */
  maxDpr: 2,
  minPxPerYard: 3,
  maxPxPerYard: 80,
  zoomMin: 0.6,
  zoomMax: 2.2,
  /** Snap to target when this close, so the spring settles exactly. */
  settleEpsYd: 0.0005,
} as const;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export class Camera {
  /** Viewport size in CSS pixels. */
  widthCss = 1;
  heightCss = 1;
  /** Capped device pixel ratio actually used for the backing store. */
  dpr = 1;
  /** Scale authority: CSS pixels per world yard. */
  pxPerYard = 10;
  /** World y at the vertical centre of the viewport. */
  centerY = FIELD_L / 2;
  /** World y the follow spring is easing toward. */
  targetY = FIELD_L / 2;
  /** Spring velocity (yd/s) — public for debugging, written only by update(). */
  velY = 0;
  /** Zoom multiplier on top of the fit-the-width scale. */
  zoom = 1;
  /** True renders the world rotated 180 degrees (team attacking -y plays up). */
  flipped = false;

  constructor(widthCss = 1280, heightCss = 720, rawDpr = 1) {
    this.resize(widthCss, heightCss, rawDpr);
    this.snapTo(FIELD_L / 2);
  }

  /** Viewport change. `rawDpr` is clamped to [1, CAMERA_TUNING.maxDpr]. */
  resize(widthCss: number, heightCss: number, rawDpr = this.dpr): void {
    this.widthCss = Math.max(1, widthCss);
    this.heightCss = Math.max(1, heightCss);
    const d = Number.isFinite(rawDpr) ? rawDpr : 1;
    this.dpr = clamp(d, 1, CAMERA_TUNING.maxDpr);
    this.recomputeScale();
  }

  setZoom(zoom: number): void {
    this.zoom = clamp(zoom, CAMERA_TUNING.zoomMin, CAMERA_TUNING.zoomMax);
    this.recomputeScale();
  }

  /** +1 = the viewer's team attacks high y (default); -1 flips the view. */
  setOrientation(attackDir: 1 | -1): void {
    this.flipped = attackDir === -1;
  }

  private recomputeScale(): void {
    const usableYd = FIELD_W + CAMERA_TUNING.sideMarginYd * 2;
    const fit = (this.widthCss / usableYd) * this.zoom;
    this.pxPerYard = clamp(fit, CAMERA_TUNING.minPxPerYard, CAMERA_TUNING.maxPxPerYard);
    this.clampCenter();
  }

  /** Half the visible vertical extent, in yards. */
  halfHeightYd(): number {
    return this.heightCss / 2 / this.pxPerYard;
  }

  /** Visible world-y span, already clamped to the field. */
  visibleYRange(): [number, number] {
    const h = this.halfHeightYd();
    return [Math.max(0, this.centerY - h), Math.min(FIELD_L, this.centerY + h)];
  }

  private clampCenter(): void {
    const h = this.halfHeightYd();
    if (h * 2 >= FIELD_L) {
      this.centerY = FIELD_L / 2;
      return;
    }
    this.centerY = clamp(this.centerY, h, FIELD_L - h);
  }

  /** Where the follow spring is heading. Always clamped into the field. */
  setTarget(worldY: number): void {
    this.targetY = clamp(Number.isFinite(worldY) ? worldY : FIELD_L / 2, 0, FIELD_L);
  }

  /** Jump the camera (cuts between plays, first frame). */
  snapTo(worldY: number): void {
    this.setTarget(worldY);
    this.centerY = this.targetY;
    this.velY = 0;
    this.clampCenter();
  }

  /**
   * Critically damped follow (Game Programming Gems 4, 1.10). No overshoot, no
   * dependence on frame rate beyond dt itself.
   */
  update(dtSec: number): void {
    const dt = clamp(Number.isFinite(dtSec) ? dtSec : 0, 0, 0.25);
    if (dt <= 0) return;
    const omega = 2 * Math.PI * CAMERA_TUNING.followFreqHz;
    const exp = Math.exp(-omega * dt);
    const delta = this.centerY - this.targetY;
    const temp = (this.velY + omega * delta) * dt;
    this.velY = (this.velY - omega * temp) * exp;
    this.centerY = this.targetY + (delta + temp) * exp;
    if (Math.abs(this.centerY - this.targetY) < CAMERA_TUNING.settleEpsYd && Math.abs(this.velY) < 0.01) {
      this.centerY = this.targetY;
      this.velY = 0;
    }
    this.clampCenter();
  }

  private get axisSign(): 1 | -1 {
    return this.flipped ? -1 : 1;
  }

  toScreenX(worldX: number): number {
    return this.widthCss / 2 + (worldX - CENTER_X) * this.pxPerYard * this.axisSign;
  }

  toScreenY(worldY: number): number {
    return this.heightCss / 2 - (worldY - this.centerY) * this.pxPerYard * this.axisSign;
  }

  worldToScreen(worldX: number, worldY: number): ScreenPoint {
    return { x: this.toScreenX(worldX), y: this.toScreenY(worldY) };
  }

  screenToWorld(screenX: number, screenY: number): WorldPoint {
    const s = this.axisSign;
    return {
      x: CENTER_X + (screenX - this.widthCss / 2) / (this.pxPerYard * s),
      y: this.centerY - (screenY - this.heightCss / 2) / (this.pxPerYard * s),
    };
  }

  /** Yards → CSS pixels (lengths, not positions). */
  toPx(yards: number): number {
    return yards * this.pxPerYard;
  }

  /** Cheap cull for entity drawing; padYd widens the test. */
  isVisible(worldX: number, worldY: number, padYd = 2): boolean {
    const [y0, y1] = this.visibleYRange();
    if (worldY < y0 - padYd || worldY > y1 + padYd) return false;
    const halfW = this.widthCss / 2 / this.pxPerYard;
    return Math.abs(worldX - CENTER_X) <= halfW + padYd;
  }

  /** Backing-store size for a canvas of this viewport. */
  backingWidth(): number {
    return Math.max(1, Math.floor(this.widthCss * this.dpr));
  }

  backingHeight(): number {
    return Math.max(1, Math.floor(this.heightCss * this.dpr));
  }

  /** One setTransform per resize/frame; all draw code then works in CSS px. */
  applyTransform(ctx: Ctx2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
