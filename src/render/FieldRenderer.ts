// The field is pre-rendered once into an offscreen canvas (it only changes on
// zoom / DPR / team change) and blitted a slice at a time. Local surface space
// is CSS pixels with (0,0) at world (x=0, y=FIELD_L) — i.e. the image is
// already oriented +y up.

import {
  CENTER_X, FIELD_L, FIELD_W, GOAL_AWAY_Y, GOAL_HOME_Y, HASH_LEFT_X, HASH_RIGHT_X,
} from '../sim/constants';
import type { LogoSpec } from '../meta/types';
import type { TeamSide } from '../sim/types';
import type { Camera } from './Camera';
import type { Ctx2D, Ctx2DImage } from './ctx';
import { UI_FONT } from './ctx';
import { drawLogo } from './logo';
import { clamp, rgba, shade } from './shapes';
import type { TeamPresentation } from './types';

// TODO(balance): field paint — colors/weights pending the consolidation pass.
export const FIELD_STYLE = {
  bandLight: '#3A7D2C',
  bandDark: '#357029',
  outOfBounds: '#0D1117',
  line: '#EEF2EC',
  lineAlpha: 0.88,
  lineWidthYd: 0.13,
  goalLineWidthYd: 0.3,
  hashLenYd: 0.62,
  sidelineTickLenYd: 1.0,
  numberHeightYd: 3.0,
  numberInsetYd: 8.0,
  endZoneTextMaxYd: 5.6,
  midfieldDiscRadiusYd: 4.6,
  losColor: '#3FA9F5',
  firstDownColor: '#F2C744',
  situationLineWidthYd: 0.22,
  /** Offscreen surface budget in device pixels (~32MB of backing store). */
  maxSurfacePixels: 8_000_000,
} as const;

export interface EndZoneTheme {
  color: string;
  textColor: string;
  text: string;
}

export interface FieldTheme {
  /** End zone spanning world y [0, 10]. */
  low: EndZoneTheme;
  /** End zone spanning world y [110, 120]. */
  high: EndZoneTheme;
  midfieldLogo: LogoSpec | null;
  midfieldLetter: string;
}

/**
 * Map the two teams onto the two end zones. A team defends the low-y end zone
 * while it attacks +y.
 */
export function fieldThemeFromTeams(
  teams: readonly [TeamPresentation, TeamPresentation],
  attackDir: readonly [1 | -1, 1 | -1],
): FieldTheme {
  const lowDefender: TeamSide = attackDir[0] === 1 ? 0 : 1;
  const highDefender: TeamSide = lowDefender === 0 ? 1 : 0;
  const low = teams[lowDefender];
  const high = teams[highDefender];
  return {
    low: {
      color: low.colors.primary,
      textColor: low.colors.secondary,
      text: low.nickname.toUpperCase(),
    },
    high: {
      color: high.colors.primary,
      textColor: high.colors.secondary,
      text: high.nickname.toUpperCase(),
    },
    midfieldLogo: low.logo,
    midfieldLetter: low.city.slice(0, 1).toUpperCase(),
  };
}

export function fieldThemeKey(theme: FieldTheme): string {
  const l = theme.midfieldLogo;
  return [
    theme.low.color, theme.low.textColor, theme.low.text,
    theme.high.color, theme.high.textColor, theme.high.text,
    theme.midfieldLetter,
    l ? `${l.frame}${l.motif}${l.motifCount}${l.rotationDeg}${l.frameColor}${l.motifColor}${l.accentColor}` : 'none',
  ].join('|');
}

// ---------------------------------------------------------------------------
// Pre-render
// ---------------------------------------------------------------------------

/**
 * Paint the whole 120-yard field into `ctx` at `ppy` CSS px per yard.
 * Pure canvas commands — the caller owns the surface.
 */
export function drawFieldTo(ctx: Ctx2D, ppy: number, theme: FieldTheme): void {
  const lx = (worldX: number): number => worldX * ppy;
  const ly = (worldY: number): number => (FIELD_L - worldY) * ppy;
  const w = FIELD_W * ppy;

  // Base grass: alternating 5-yard bands across the whole 120 yards.
  for (let y = 0; y < FIELD_L; y += 5) {
    ctx.fillStyle = (y / 5) % 2 === 0 ? FIELD_STYLE.bandLight : FIELD_STYLE.bandDark;
    ctx.fillRect(0, ly(y + 5), w, 5 * ppy);
  }

  drawEndZone(ctx, ppy, theme.low, 0, GOAL_HOME_Y);
  drawEndZone(ctx, ppy, theme.high, GOAL_AWAY_Y, FIELD_L);

  ctx.globalAlpha = FIELD_STYLE.lineAlpha;
  ctx.strokeStyle = FIELD_STYLE.line;
  ctx.lineCap = 'butt';

  // Yard lines every 5 yards between the goal lines.
  for (let y = GOAL_HOME_Y; y <= GOAL_AWAY_Y; y += 5) {
    const goal = y === GOAL_HOME_Y || y === GOAL_AWAY_Y;
    ctx.lineWidth = (goal ? FIELD_STYLE.goalLineWidthYd : FIELD_STYLE.lineWidthYd) * ppy;
    ctx.beginPath();
    ctx.moveTo(0, ly(y));
    ctx.lineTo(w, ly(y));
    ctx.stroke();
  }

  // Sidelines.
  ctx.lineWidth = FIELD_STYLE.goalLineWidthYd * ppy;
  ctx.beginPath();
  ctx.moveTo(lx(0.15), ly(FIELD_L));
  ctx.lineTo(lx(0.15), ly(0));
  ctx.moveTo(lx(FIELD_W - 0.15), ly(FIELD_L));
  ctx.lineTo(lx(FIELD_W - 0.15), ly(0));
  ctx.stroke();

  // Hash marks + sideline ticks, one per yard between the goal lines.
  ctx.lineWidth = FIELD_STYLE.lineWidthYd * ppy;
  ctx.beginPath();
  for (let y = GOAL_HOME_Y + 1; y < GOAL_AWAY_Y; y++) {
    if ((y - GOAL_HOME_Y) % 5 === 0) continue;
    const half = (FIELD_STYLE.hashLenYd / 2) * ppy;
    const yy = ly(y);
    ctx.moveTo(lx(HASH_LEFT_X) - half, yy);
    ctx.lineTo(lx(HASH_LEFT_X) + half, yy);
    ctx.moveTo(lx(HASH_RIGHT_X) - half, yy);
    ctx.lineTo(lx(HASH_RIGHT_X) + half, yy);
    ctx.moveTo(lx(0.2), yy);
    ctx.lineTo(lx(0.2 + FIELD_STYLE.sidelineTickLenYd), yy);
    ctx.moveTo(lx(FIELD_W - 0.2), yy);
    ctx.lineTo(lx(FIELD_W - 0.2 - FIELD_STYLE.sidelineTickLenYd), yy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  drawYardNumbers(ctx, ppy);
  drawMidfield(ctx, ppy, theme);
}

function drawEndZone(
  ctx: Ctx2D,
  ppy: number,
  zone: EndZoneTheme,
  y0: number,
  y1: number,
): void {
  const w = FIELD_W * ppy;
  const top = (FIELD_L - y1) * ppy;
  const h = (y1 - y0) * ppy;
  ctx.fillStyle = zone.color;
  ctx.fillRect(0, top, w, h);

  // Subtle inner band so flat end zones do not read as a solid slab.
  ctx.fillStyle = rgba(shade(zone.color, -0.35), 0.45);
  ctx.fillRect(0, top + h * 0.06, w, h * 0.06);
  ctx.fillRect(0, top + h * 0.88, w, h * 0.06);

  // Text spans the field WIDTH (the 53-yard axis) so it stays readable in the
  // vertical camera; its cap height is bounded by the 10-yard end zone depth.
  const text = zone.text;
  if (text.length === 0) return;
  const maxLenYd = 46;
  const byHeight = FIELD_STYLE.endZoneTextMaxYd * ppy;
  const byLength = (maxLenYd * ppy) / Math.max(1, text.length * 0.68);
  const size = Math.max(4, Math.min(byHeight, byLength));

  const cx = (FIELD_W / 2) * ppy;
  const cy = (FIELD_L - (y0 + y1) / 2) * ppy;
  ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = zone.textColor;
  ctx.fillText(text, cx, cy);
  ctx.lineWidth = Math.max(1, size * 0.045);
  ctx.strokeStyle = rgba('#000000', 0.35);
  ctx.strokeText(text, cx, cy);
}

function drawYardNumbers(ctx: Ctx2D, ppy: number): void {
  const size = FIELD_STYLE.numberHeightYd * ppy;
  ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(FIELD_STYLE.line, 0.82);

  for (let y = GOAL_HOME_Y + 10; y <= GOAL_AWAY_Y - 10; y += 10) {
    const n = y <= 60 ? y - GOAL_HOME_Y : GOAL_AWAY_Y - y;
    const label = String(n);
    const yy = (FIELD_L - y) * ppy;

    ctx.save();
    ctx.translate(FIELD_STYLE.numberInsetYd * ppy, yy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate((FIELD_W - FIELD_STYLE.numberInsetYd) * ppy, yy);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

function drawMidfield(ctx: Ctx2D, ppy: number, theme: FieldTheme): void {
  const cx = CENTER_X * ppy;
  const cy = (FIELD_L - 60) * ppy;
  const r = FIELD_STYLE.midfieldDiscRadiusYd * ppy;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#0E1A0C', 0.28);
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.12 * ppy);
  ctx.strokeStyle = rgba(FIELD_STYLE.line, 0.75);
  ctx.stroke();

  if (theme.midfieldLogo) {
    drawLogo(ctx, theme.midfieldLogo, r * 1.55, cx, cy, { letter: theme.midfieldLetter });
    return;
  }
  ctx.font = `bold ${(r * 0.62).toFixed(1)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(FIELD_STYLE.line, 0.8);
  ctx.fillText('CFA', cx, cy);
}

// ---------------------------------------------------------------------------
// Surface + blit
// ---------------------------------------------------------------------------

export class FieldRenderer {
  private surface: HTMLCanvasElement | null = null;
  private surfaceScale = 1;
  private ppy = 0;
  private key = '';

  /** Rebuild the offscreen field when scale, DPR, or teams change. */
  ensure(cam: Camera, theme: FieldTheme): void {
    const key = `${cam.pxPerYard.toFixed(3)}|${cam.dpr.toFixed(2)}|${fieldThemeKey(theme)}`;
    if (key === this.key && this.surface) return;
    this.key = key;
    this.ppy = cam.pxPerYard;
    this.surface = null;
    if (typeof document === 'undefined') return;

    const wCss = FIELD_W * this.ppy;
    const hCss = FIELD_L * this.ppy;
    const budget = Math.sqrt(FIELD_STYLE.maxSurfacePixels / Math.max(1, wCss * hCss));
    this.surfaceScale = clamp(Math.min(cam.dpr, budget), 0.35, 2);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(wCss * this.surfaceScale));
    canvas.height = Math.max(1, Math.ceil(hCss * this.surfaceScale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.surfaceScale, 0, 0, this.surfaceScale, 0, 0);
    drawFieldTo(ctx, this.ppy, theme);
    this.surface = canvas;
  }

  /** Paint the out-of-bounds ground and blit the visible slice of the field. */
  blit(ctx: Ctx2DImage, cam: Camera): void {
    ctx.fillStyle = FIELD_STYLE.outOfBounds;
    ctx.fillRect(0, 0, cam.widthCss, cam.heightCss);

    const [vy0, vy1] = cam.visibleYRange();
    const y0 = clamp(vy0 - 1, 0, FIELD_L);
    const y1 = clamp(vy1 + 1, 0, FIELD_L);
    if (y1 - y0 <= 0) return;

    const a = cam.worldToScreen(0, y1);
    const b = cam.worldToScreen(FIELD_W, y0);
    const dx = Math.min(a.x, b.x);
    const dy = Math.min(a.y, b.y);
    const dw = Math.abs(b.x - a.x);
    const dh = Math.abs(b.y - a.y);

    if (!this.surface) {
      ctx.fillStyle = FIELD_STYLE.bandLight;
      ctx.fillRect(dx, dy, dw, dh);
      return;
    }

    const s = this.ppy * this.surfaceScale;
    const sx = 0;
    const sy = (FIELD_L - y1) * s;
    const sw = FIELD_W * s;
    const sh = (y1 - y0) * s;

    if (cam.flipped) {
      ctx.save();
      ctx.translate(dx + dw / 2, dy + dh / 2);
      ctx.rotate(Math.PI);
      ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
    }
    ctx.drawImage(this.surface, sx, sy, sw, sh, dx, dy, dw, dh);
    if (cam.flipped) ctx.restore();
  }

  /** Line of scrimmage (blue) and the sticks (yellow), drawn live each frame. */
  drawSituationLines(
    ctx: Ctx2D,
    cam: Camera,
    losY: number | null,
    firstDownY: number | null,
  ): void {
    const lw = Math.max(1.5, FIELD_STYLE.situationLineWidthYd * cam.pxPerYard);
    const x0 = cam.toScreenX(0);
    const x1 = cam.toScreenX(FIELD_W);
    const draw = (worldY: number, color: string): void => {
      if (worldY < 0 || worldY > FIELD_L) return;
      const y = cam.toScreenY(worldY);
      if (y < -lw || y > cam.heightCss + lw) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (losY !== null) draw(losY, FIELD_STYLE.losColor);
    if (firstDownY !== null) draw(firstDownY, FIELD_STYLE.firstDownColor);
  }

  /** Drop the cached surface (team change between games, memory pressure). */
  invalidate(): void {
    this.surface = null;
    this.key = '';
  }
}
