// Parametric team logos. A LogoSpec (frozen in meta/types.ts) is drawn as a
// frame + a repeated motif inside a 64-unit box; the result is cached into an
// offscreen canvas per (team, size, dpr) and blitted wherever a logo is needed.
//
// drawLogo() is pure canvas commands — no DOM, no randomness — so the same
// spec always produces the identical command sequence (tests assert this).

import type { LogoSpec } from '../meta/types';
import type { Ctx2D, Ctx2DImage } from './ctx';
import { UI_FONT } from './ctx';
import { polygonPath, shade } from './shapes';

/** Design box the motif/frame paths are authored in. */
export const LOGO_UNITS = 64;

export interface LogoDrawOptions {
  /**
   * Letter for the 'initial' motif. LogoSpec has no letter field, so the
   * caller (team identity) supplies the city initial.
   */
  letter?: string;
}

type MotifName = LogoSpec['motif'];

/** Motifs whose repeats read better stacked vertically than side by side. */
const STACK_VERTICAL: ReadonlySet<MotifName> = new Set<MotifName>(['chevron', 'crest-stripes']);

const COUNT_OFFSETS: Readonly<Record<1 | 2 | 3, readonly number[]>> = {
  1: [0],
  2: [-11, 11],
  3: [-16, 0, 16],
};

const COUNT_SCALE: Readonly<Record<1 | 2 | 3, number>> = { 1: 1.15, 2: 0.72, 3: 0.54 };

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

function framePath(ctx: Ctx2D, frame: LogoSpec['frame']): void {
  switch (frame) {
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(-24, -28);
      ctx.lineTo(24, -28);
      ctx.lineTo(24, 2);
      ctx.quadraticCurveTo(24, 21, 0, 30);
      ctx.quadraticCurveTo(-24, 21, -24, 2);
      ctx.closePath();
      return;
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      return;
    case 'hexagon': {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 6; i++) {
        const a = (-90 + i * 60) * (Math.PI / 180);
        pts.push([Math.cos(a) * 29, Math.sin(a) * 29]);
      }
      polygonPath(ctx, pts);
      return;
    }
    case 'diamond':
      polygonPath(ctx, [
        [0, -30],
        [26, 0],
        [0, 30],
        [-26, 0],
      ]);
      return;
    case 'roundel':
      ctx.beginPath();
      ctx.arc(0, 0, 29, 0, Math.PI * 2);
      return;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
  }
}

function drawFrame(ctx: Ctx2D, spec: LogoSpec): void {
  framePath(ctx, spec.frame);
  ctx.fillStyle = spec.frameColor;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();

  if (spec.frame === 'roundel') {
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = spec.accentColor;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Motifs — every path lives inside +/-16 units, centred on the origin.
// ---------------------------------------------------------------------------

function motifBolt(ctx: Ctx2D, spec: LogoSpec): void {
  polygonPath(ctx, [
    [-6, -16],
    [9, -16],
    [1, -3],
    [10, -3],
    [-7, 16],
    [-1, 1],
    [-9, 1],
  ]);
  ctx.fillStyle = spec.motifColor;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();
}

function motifStar(ctx: Ctx2D, spec: LogoSpec): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 16 : 6.6;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  polygonPath(ctx, pts);
  ctx.fillStyle = spec.motifColor;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();
}

function motifChevron(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = spec.motifColor;
  ctx.beginPath();
  ctx.moveTo(-14, 5);
  ctx.lineTo(0, -8);
  ctx.lineTo(14, 5);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = spec.accentColor;
  ctx.beginPath();
  ctx.moveTo(-14, 10);
  ctx.lineTo(0, -3);
  ctx.lineTo(14, 10);
  ctx.stroke();
}

function wingBlade(ctx: Ctx2D): void {
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.quadraticCurveTo(9, -13, 17, -9);
  ctx.quadraticCurveTo(10, -3, 15, 1);
  ctx.quadraticCurveTo(8, 3, 12, 8);
  ctx.quadraticCurveTo(5, 7, 0, 4);
  ctx.closePath();
}

function motifWing(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.fillStyle = spec.motifColor;
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = spec.accentColor;
  wingBlade(ctx);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.scale(-1, 1);
  wingBlade(ctx);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function motifFang(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.fillStyle = spec.motifColor;
  polygonPath(ctx, [
    [-15, -11],
    [15, -11],
    [15, -5],
    [-15, -5],
  ]);
  ctx.fill();
  polygonPath(ctx, [
    [-13, -6],
    [-3, -6],
    [-8, 15],
  ]);
  ctx.fill();
  polygonPath(ctx, [
    [3, -6],
    [13, -6],
    [8, 15],
  ]);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();
}

function motifClaw(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = spec.motifColor;
  for (let i = 0; i < 3; i++) {
    const ox = -10 + i * 10;
    ctx.lineWidth = 5 - Math.abs(i - 1) * 1.2;
    ctx.beginPath();
    ctx.moveTo(ox - 3, -14);
    ctx.quadraticCurveTo(ox + 5, 0, ox - 1, 15);
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = spec.accentColor;
  ctx.beginPath();
  ctx.arc(0, -15, 14, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
}

function motifPeak(ctx: Ctx2D, spec: LogoSpec): void {
  polygonPath(ctx, [
    [-16, 14],
    [-4, -7],
    [2, 2],
    [11, -15],
    [16, 14],
  ]);
  ctx.fillStyle = spec.motifColor;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();
  polygonPath(ctx, [
    [11, -15],
    [15, -6],
    [7, -6],
  ]);
  ctx.fillStyle = spec.accentColor;
  ctx.fill();
}

function motifOrbit(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = spec.motifColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7, -0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = spec.accentColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, 12.5, 4.6, -0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = spec.motifColor;
  ctx.fill();
}

function motifCrestStripes(ctx: Ctx2D, spec: LogoSpec): void {
  for (let i = 0; i < 3; i++) {
    const ox = -12 + i * 10;
    polygonPath(ctx, [
      [ox, 14],
      [ox + 6, 14],
      [ox + 13, -14],
      [ox + 7, -14],
    ]);
    ctx.fillStyle = i === 1 ? spec.accentColor : spec.motifColor;
    ctx.fill();
  }
}

function motifInitial(ctx: Ctx2D, spec: LogoSpec, letter: string): void {
  ctx.font = `bold 30px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = spec.motifColor;
  ctx.fillText(letter, 0, 1);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = spec.accentColor;
  ctx.strokeText(letter, 0, 1);
}

function motifShieldInShield(ctx: Ctx2D, spec: LogoSpec): void {
  ctx.save();
  ctx.scale(0.52, 0.52);
  framePath(ctx, 'shield');
  ctx.fillStyle = spec.motifColor;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = spec.accentColor;
  ctx.stroke();
  ctx.restore();
}

function drawMotif(ctx: Ctx2D, spec: LogoSpec, opts: LogoDrawOptions): void {
  switch (spec.motif) {
    case 'bolt': return motifBolt(ctx, spec);
    case 'star': return motifStar(ctx, spec);
    case 'chevron': return motifChevron(ctx, spec);
    case 'wing': return motifWing(ctx, spec);
    case 'fang': return motifFang(ctx, spec);
    case 'claw': return motifClaw(ctx, spec);
    case 'peak': return motifPeak(ctx, spec);
    case 'orbit': return motifOrbit(ctx, spec);
    case 'crest-stripes': return motifCrestStripes(ctx, spec);
    case 'initial': return motifInitial(ctx, spec, (opts.letter ?? 'C').slice(0, 1).toUpperCase());
    case 'shield-in-shield': return motifShieldInShield(ctx, spec);
    default: return motifStar(ctx, spec);
  }
}

// ---------------------------------------------------------------------------
// Public draw
// ---------------------------------------------------------------------------

/**
 * Draw `spec` centred at (cx, cy) filling a `size`-pixel square.
 * Emits only vector commands: identical spec => identical command sequence.
 */
export function drawLogo(
  ctx: Ctx2D,
  spec: LogoSpec,
  size: number,
  cx: number,
  cy: number,
  opts: LogoDrawOptions = {},
): void {
  const k = size / LOGO_UNITS;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  drawFrame(ctx, spec);

  const count = spec.motifCount;
  const offsets = COUNT_OFFSETS[count] ?? COUNT_OFFSETS[1];
  const mscale = COUNT_SCALE[count] ?? COUNT_SCALE[1];
  const vertical = STACK_VERTICAL.has(spec.motif);

  ctx.save();
  ctx.rotate((spec.rotationDeg * Math.PI) / 180);
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i] ?? 0;
    ctx.save();
    ctx.translate(vertical ? 0 : off, vertical ? off * 0.75 : 0);
    ctx.scale(mscale, mscale);
    drawMotif(ctx, spec, opts);
    ctx.restore();
  }
  ctx.restore();

  ctx.restore();
}

/** Flat disc + logo, used for HUD/standings rows where the frame needs a base. */
export function drawLogoBadge(
  ctx: Ctx2D,
  spec: LogoSpec,
  size: number,
  cx: number,
  cy: number,
  opts: LogoDrawOptions = {},
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.54, 0, Math.PI * 2);
  ctx.fillStyle = shade(spec.frameColor, -0.55);
  ctx.fill();
  drawLogo(ctx, spec, size, cx, cy, opts);
}

// ---------------------------------------------------------------------------
// Offscreen cache (browser only)
// ---------------------------------------------------------------------------

function specKey(spec: LogoSpec, opts: LogoDrawOptions): string {
  return [
    spec.frame,
    spec.motif,
    spec.motifCount,
    spec.rotationDeg,
    spec.frameColor,
    spec.motifColor,
    spec.accentColor,
    opts.letter ?? '',
  ].join('|');
}

/** Render a spec into a fresh offscreen canvas; null when there is no DOM. */
export function createLogoCanvas(
  spec: LogoSpec,
  sizePx: number,
  dpr: number,
  opts: LogoDrawOptions = {},
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const px = Math.max(8, Math.ceil(sizePx * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(px / LOGO_UNITS, 0, 0, px / LOGO_UNITS, 0, 0);
  drawLogo(ctx, spec, LOGO_UNITS, LOGO_UNITS / 2, LOGO_UNITS / 2, opts);
  return canvas;
}

const MAX_CACHE_ENTRIES = 64;

/** Map<key, canvas> with deterministic (insertion-order) eviction. */
export class LogoCache {
  private readonly map = new Map<string, HTMLCanvasElement | null>();

  /** Cached canvas for the spec at that pixel size, or null if unavailable. */
  get(spec: LogoSpec, sizePx: number, dpr: number, opts: LogoDrawOptions = {}): HTMLCanvasElement | null {
    const bucket = Math.max(16, Math.ceil(sizePx / 16) * 16);
    const key = `${specKey(spec, opts)}|${bucket}|${dpr.toFixed(2)}`;
    const hit = this.map.get(key);
    if (hit !== undefined) return hit;
    const made = createLogoCanvas(spec, bucket, dpr, opts);
    if (this.map.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, made);
    return made;
  }

  /** Blit (or vector-draw as a fallback) a logo centred at (cx, cy). */
  draw(
    ctx: Ctx2DImage,
    spec: LogoSpec,
    sizePx: number,
    cx: number,
    cy: number,
    dpr: number,
    opts: LogoDrawOptions = {},
  ): void {
    const canvas = this.get(spec, sizePx, dpr, opts);
    if (!canvas) {
      drawLogo(ctx, spec, sizePx, cx, cy, opts);
      return;
    }
    ctx.drawImage(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      cx - sizePx / 2,
      cy - sizePx / 2,
      sizePx,
      sizePx,
    );
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
