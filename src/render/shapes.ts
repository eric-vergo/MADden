// Small path/paint helpers shared by the renderers. Nothing here touches the
// DOM, so the whole set is exercisable against a mock Ctx2D.

import type { Ctx2D } from './ctx';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth 0→1 ease used for banner/popup timing. */
export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

export function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function polygonPath(ctx: Ctx2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

export function circlePath(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.01), 0, Math.PI * 2);
}

export function fillCircle(ctx: Ctx2D, x: number, y: number, r: number, fill: string): void {
  circlePath(ctx, x, y, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function fillEllipse(
  ctx: Ctx2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(rx, 0.01), Math.max(ry, 0.01), rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Text with a cheap drop shadow — legible over both grass and dark slabs. */
export function shadowText(
  ctx: Ctx2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  shadow = 'rgba(0,0,0,0.65)',
  offset = 1.5,
): void {
  ctx.fillStyle = shadow;
  ctx.fillText(text, x + offset, y + offset);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/**
 * Rough advance-width estimate. measureText is deliberately absent from Ctx2D
 * so drawing code stays mockable; layout only needs slab sizing accuracy.
 */
export function approxTextWidth(text: string, sizePx: number, bold = false): number {
  return text.length * sizePx * (bold ? 0.58 : 0.52);
}

const HEX3 = /^#([0-9a-fA-F]{3})$/;
const HEX6 = /^#([0-9a-fA-F]{6})$/;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const short = HEX3.exec(hex);
  if (short && short[1]) {
    const s = short[1];
    return {
      r: parseInt(`${s[0]}${s[0]}`, 16),
      g: parseInt(`${s[1]}${s[1]}`, 16),
      b: parseInt(`${s[2]}${s[2]}`, 16),
    };
  }
  const long = HEX6.exec(hex);
  if (long && long[1]) {
    const s = long[1];
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return { r: 128, g: 128, b: 128 };
}

export function toHex(c: Rgb): string {
  const h = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Perceptual-ish luminance in 0..1. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

export function shade(hex: string, amount: number): string {
  const c = parseHex(hex);
  const t = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return toHex({
    r: lerpN(c.r, t, k),
    g: lerpN(c.g, t, k),
    b: lerpN(c.b, t, k),
  });
}

export function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex);
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${clamp(alpha, 0, 1).toFixed(3)})`;
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.55 ? '#101418' : '#F5F7FA';
}

/**
 * Deterministic 0..1 noise from integers — replaces Math.random in effects so
 * a replayed tick draws the identical dust cloud.
 */
export function hashNoise(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 2246822519);
  h = Math.imul(h ^ (b + 0x85ebca6b), 3266489917);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
