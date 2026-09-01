// Transient presentation: dust, flashes, the pass landing marker, the kick
// meter, the post-play yardage popup, big-play banners, and the replay
// letterbox. Every effect is timed in sim ticks (never wall clock) so a replay
// of the same ticks draws the same thing.

import { TICK_HZ } from '../sim/constants';
import { KICK } from '../data/balance';
import type { KickMeterState } from '../sim/types';
import type { Camera } from './Camera';
import type { Ctx2D } from './ctx';
import { UI_FONT } from './ctx';
import {
  clamp, easeOutCubic, fillEllipse, hashNoise, readableOn, rgba, roundRectPath, shadowText,
} from './shapes';
import type { BannerKind, BannerSpec, TeamPresentation, YardagePopup } from './types';

// TODO(balance): effect lifetimes/sizes pending consolidation.
export const EFFECT_STYLE = {
  dustTicks: 42,
  dustPuffs: 7,
  dustRadiusYd: 1.1,
  catchFlashTicks: 20,
  catchFlashRadiusYd: 1.6,
  bigHitTicks: 26,
  bigHitRadiusYd: 2.2,
  popupTicks: 48,
  popupRiseYd: 1.8,
  bannerTicks: 84,
  bannerInTicks: 9,
  bannerOutTicks: 14,
  letterboxFrac: 0.08,
  /** Skip hint size, relative to the REPLAY wordmark. */
  replayHintScale: 0.52,
  /**
   * Skip hint copy. It has to name keys the REPLAY context actually resolves:
   * that scope is empty (input/Bindings.ts) and falls through to GLOBAL, so
   * only the arrows/WASD, Enter and Escape produce a pressed action — Space,
   * Tab and the digits do nothing. The old "ANY KEY TO SKIP" promised a
   * behaviour the input layer does not have.
   */
  replaySkipHint: 'ENTER OR ESC TO SKIP',
  /**
   * Kick meter baseline, in CSS px above the bottom edge at uiScale 1. It has
   * to clear the HUD ticker line, whose box tops out 112px above the bottom
   * (strip margin 14 + strip height 44 + ticker offset 54); the meter hangs
   * 34px below this baseline for the aim arrow.
   */
  kickMeterBottomOffset: 152,
  passMarkerRadiusYd: 1.2,
  maxEffects: 48,
} as const;

export type EffectKind = 'dust' | 'catchFlash' | 'bigHit';

interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  startTick: number;
  ttl: number;
  seed: number;
}

const EFFECT_TTL: Readonly<Record<EffectKind, number>> = {
  dust: EFFECT_STYLE.dustTicks,
  catchFlash: EFFECT_STYLE.catchFlashTicks,
  bigHit: EFFECT_STYLE.bigHitTicks,
};

// ---------------------------------------------------------------------------
// Kick meter (pure)
// ---------------------------------------------------------------------------

export interface KickMeterVisual {
  power01: number;
  powerLocked: boolean;
  /** Accuracy marker position 0..1 along the bar; null before the power lock. */
  markerPos01: number | null;
  accuracyLocked: boolean;
  /** 0 = dead on the sweet spot, 1 = worst. */
  accuracyError01: number;
}

/**
 * Visual state of the meter at `tick`. Mirrors rules/kickMeter.ts timings from
 * data/balance.ts; the sim remains the authority for the resulting kick.
 */
export function computeKickMeter(meter: KickMeterState, tick: number): KickMeterVisual {
  const fill = Math.max(1, KICK.meterFillTicks);
  const sweep = Math.max(1, KICK.meterSweepTicks);
  const powerEndTick = meter.powerLockTick ?? tick;
  const power01 = clamp((powerEndTick - meter.startTick) / fill, 0, 1);
  const powerLocked = meter.powerLockTick !== null;
  if (!powerLocked) {
    return { power01, powerLocked, markerPos01: null, accuracyLocked: false, accuracyError01: 0 };
  }
  const lockTick = meter.powerLockTick ?? tick;
  const endTick = meter.accuracyLockTick ?? tick;
  const travelled = clamp((endTick - lockTick) / sweep, 0, 1);
  const markerPos01 = clamp(power01 * (1 - travelled), 0, 1);
  return {
    power01,
    powerLocked,
    markerPos01,
    accuracyLocked: meter.accuracyLockTick !== null,
    accuracyError01: clamp(markerPos01, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Overlay inputs
// ---------------------------------------------------------------------------

export interface OverlayOptions {
  tick: number;
  uiScale: number;
  teams: readonly [TeamPresentation, TeamPresentation];
  kickMeter: KickMeterState | null;
  yardagePopup: YardagePopup | null;
  banner: BannerSpec | null;
  replay: boolean;
}

const BANNER_TONE: Readonly<Record<BannerKind, { bg: string; fg: string; height: number }>> = {
  touchdown: { bg: '#1B3A6B', fg: '#FFFFFF', height: 64 },
  turnover: { bg: '#8A1C1C', fg: '#FFF2F2', height: 60 },
  flag: { bg: '#F2C744', fg: '#141414', height: 56 },
  fieldGoal: { bg: '#1F6F3D', fg: '#FFFFFF', height: 58 },
  sack: { bg: '#22252B', fg: '#FFD9D9', height: 56 },
  firstDown: { bg: '#12161C', fg: '#F2C744', height: 34 },
  twoMinute: { bg: '#12161C', fg: '#EFF3F7', height: 50 },
  halftime: { bg: '#12161C', fg: '#EFF3F7', height: 56 },
  final: { bg: '#12161C', fg: '#EFF3F7', height: 60 },
  generic: { bg: '#12161C', fg: '#EFF3F7', height: 50 },
};

export class EffectsRenderer {
  private readonly effects: Effect[] = [];

  /** Queue a world-space effect (called from SimEvent handlers). */
  emit(kind: EffectKind, x: number, y: number, tick: number): void {
    if (this.effects.length >= EFFECT_STYLE.maxEffects) this.effects.shift();
    this.effects.push({
      kind,
      x,
      y,
      startTick: tick,
      ttl: EFFECT_TTL[kind],
      seed: (this.effects.length + tick) | 0,
    });
  }

  clear(): void {
    this.effects.length = 0;
  }

  /** Drop finished effects; safe to call every frame. */
  prune(tick: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (!e) continue;
      if (tick - e.startTick > e.ttl) this.effects.splice(i, 1);
    }
  }

  get activeCount(): number {
    return this.effects.length;
  }

  drawWorld(
    ctx: Ctx2D,
    cam: Camera,
    tick: number,
    passLanding: { x: number; y: number } | null,
  ): void {
    if (passLanding) this.drawPassMarker(ctx, cam, passLanding, tick);
    for (const e of this.effects) {
      const age = tick - e.startTick;
      if (age < 0 || age > e.ttl) continue;
      const t = age / e.ttl;
      switch (e.kind) {
        case 'dust': this.drawDust(ctx, cam, e, t); break;
        case 'catchFlash': this.drawCatchFlash(ctx, cam, e, t); break;
        case 'bigHit': this.drawBigHit(ctx, cam, e, t); break;
        default: break;
      }
    }
  }

  private drawPassMarker(
    ctx: Ctx2D,
    cam: Camera,
    at: { x: number; y: number },
    tick: number,
  ): void {
    const sx = cam.toScreenX(at.x);
    const sy = cam.toScreenY(at.y);
    const pulse = 0.5 + 0.5 * Math.sin(tick * 0.22);
    const r = cam.toPx(EFFECT_STYLE.passMarkerRadiusYd) * (0.85 + pulse * 0.25);
    ctx.save();
    ctx.globalAlpha = 0.55 + pulse * 0.3;
    ctx.strokeStyle = '#F2F5F8';
    ctx.lineWidth = Math.max(1.5, cam.toPx(0.09));
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.5, sy - r * 0.28);
    ctx.lineTo(sx + r * 0.5, sy + r * 0.28);
    ctx.moveTo(sx + r * 0.5, sy - r * 0.28);
    ctx.lineTo(sx - r * 0.5, sy + r * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  private drawDust(ctx: Ctx2D, cam: Camera, e: Effect, t: number): void {
    const alpha = (1 - t) * 0.45;
    const spread = cam.toPx(EFFECT_STYLE.dustRadiusYd) * (0.35 + t * 1.2);
    for (let i = 0; i < EFFECT_STYLE.dustPuffs; i++) {
      const a = hashNoise(e.seed, i) * Math.PI * 2;
      const d = 0.35 + hashNoise(e.seed + 7, i) * 0.65;
      const px = cam.toScreenX(e.x) + Math.cos(a) * spread * d;
      const py = cam.toScreenY(e.y) + Math.sin(a) * spread * d * 0.5;
      const r = cam.toPx(0.22) * (0.6 + hashNoise(e.seed + 13, i) * 0.8) * (1 + t);
      fillEllipse(ctx, px, py, r, r * 0.6, 0, rgba('#C8BFA6', alpha));
    }
  }

  private drawCatchFlash(ctx: Ctx2D, cam: Camera, e: Effect, t: number): void {
    const r = cam.toPx(EFFECT_STYLE.catchFlashRadiusYd) * easeOutCubic(t);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.5, cam.toPx(0.12) * (1 - t * 0.6));
    ctx.beginPath();
    ctx.ellipse(cam.toScreenX(e.x), cam.toScreenY(e.y), r, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawBigHit(ctx: Ctx2D, cam: Camera, e: Effect, t: number): void {
    const r = cam.toPx(EFFECT_STYLE.bigHitRadiusYd) * easeOutCubic(t);
    const sx = cam.toScreenX(e.x);
    const sy = cam.toScreenY(e.y);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = '#FFE9A8';
    ctx.lineWidth = Math.max(1.5, cam.toPx(0.1));
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + hashNoise(e.seed, i) * 0.4;
      ctx.moveTo(sx + Math.cos(a) * r * 0.35, sy + Math.sin(a) * r * 0.2);
      ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.55);
    }
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Screen-space overlays
  // -------------------------------------------------------------------------

  drawOverlay(ctx: Ctx2D, cam: Camera, opts: OverlayOptions): void {
    if (opts.yardagePopup) this.drawYardagePopup(ctx, cam, opts.yardagePopup, opts);
    if (opts.kickMeter && opts.kickMeter.active) this.drawKickMeter(ctx, cam, opts.kickMeter, opts);
    if (opts.banner) this.drawBanner(ctx, cam, opts.banner, opts);
    if (opts.replay) this.drawReplayFrame(ctx, cam, opts);
  }

  private drawYardagePopup(
    ctx: Ctx2D,
    cam: Camera,
    popup: YardagePopup,
    opts: OverlayOptions,
  ): void {
    const age = opts.tick - popup.startTick;
    if (age < 0 || age > EFFECT_STYLE.popupTicks) return;
    const t = age / EFFECT_STYLE.popupTicks;
    const rise = cam.toPx(EFFECT_STYLE.popupRiseYd) * easeOutCubic(t);
    const yards = Math.round(popup.yards);
    const label = yards === 0 ? 'NO GAIN' : yards > 0 ? `+${yards}` : `${yards}`;
    const size = 22 * opts.uiScale;
    ctx.save();
    ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const color = yards > 0 ? '#5BE07A' : yards < 0 ? '#FF6B60' : '#E8EDF2';
    shadowText(ctx, label, cam.toScreenX(popup.x), cam.toScreenY(popup.y) - rise, color, 'rgba(0,0,0,0.75)', 2);
    ctx.restore();
  }

  private drawKickMeter(
    ctx: Ctx2D,
    cam: Camera,
    meter: KickMeterState,
    opts: OverlayOptions,
  ): void {
    const v = computeKickMeter(meter, opts.tick);
    const s = opts.uiScale;
    const w = 300 * s;
    const h = 20 * s;
    const x = cam.widthCss / 2 - w / 2;
    const y = cam.heightCss - EFFECT_STYLE.kickMeterBottomOffset * s;

    roundRectPath(ctx, x - 6 * s, y - 22 * s, w + 12 * s, h + 40 * s, 8 * s);
    ctx.fillStyle = 'rgba(9,12,17,0.82)';
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = 'rgba(240,244,248,0.35)';
    ctx.stroke();

    ctx.font = `bold ${(11 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#9FB0C0';
    ctx.fillText(v.powerLocked ? 'ACCURACY' : 'POWER', x, y - 7 * s);

    roundRectPath(ctx, x, y, w, h, 4 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();

    // Sweet spot band at the base of the bar.
    ctx.fillStyle = 'rgba(91,224,122,0.35)';
    ctx.fillRect(x, y, w * 0.08, h);

    const fillW = w * v.power01;
    ctx.fillStyle = v.power01 > 0.9 ? '#FF6B60' : v.power01 > 0.7 ? '#F2C744' : '#5BE07A';
    ctx.fillRect(x, y, fillW, h);

    if (v.markerPos01 !== null) {
      const mx = x + w * v.markerPos01;
      ctx.fillStyle = v.accuracyLocked ? '#FFFFFF' : '#F2F5F8';
      ctx.fillRect(mx - 2 * s, y - 5 * s, 4 * s, h + 10 * s);
    }

    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = 'rgba(240,244,248,0.5)';
    roundRectPath(ctx, x, y, w, h, 4 * s);
    ctx.stroke();

    // Aim indicator.
    const aim = clamp(meter.aimOffset / KICK.aimMaxOffsetRad, -1, 1);
    const cx = x + w / 2 + aim * (w / 2 - 8 * s);
    ctx.beginPath();
    ctx.moveTo(cx, y + h + 6 * s);
    ctx.lineTo(cx - 5 * s, y + h + 14 * s);
    ctx.lineTo(cx + 5 * s, y + h + 14 * s);
    ctx.closePath();
    ctx.fillStyle = '#F2C744';
    ctx.fill();
  }

  private drawBanner(ctx: Ctx2D, cam: Camera, banner: BannerSpec, opts: OverlayOptions): void {
    const age = opts.tick - banner.startTick;
    if (age < 0 || age > EFFECT_STYLE.bannerTicks) return;
    const s = opts.uiScale;
    const tone = BANNER_TONE[banner.kind] ?? BANNER_TONE.generic;
    const team = banner.team !== null ? opts.teams[banner.team] : null;
    const bg = team ? team.colors.primary : tone.bg;
    const fg = team ? readableOn(team.colors.primary) : tone.fg;
    const h = tone.height * s;
    const y = cam.heightCss * 0.24 - h / 2;

    const inT = clamp(age / EFFECT_STYLE.bannerInTicks, 0, 1);
    const outAge = age - (EFFECT_STYLE.bannerTicks - EFFECT_STYLE.bannerOutTicks);
    const outT = outAge > 0 ? clamp(outAge / EFFECT_STYLE.bannerOutTicks, 0, 1) : 0;
    const slide = (1 - easeOutCubic(inT)) * cam.widthCss * 0.12;

    ctx.save();
    ctx.globalAlpha = (1 - outT) * (0.35 + 0.65 * easeOutCubic(inT));
    ctx.translate(-slide, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, y, cam.widthCss, h);
    ctx.fillStyle = team ? team.colors.secondary : '#F2C744';
    ctx.fillRect(0, y + h - 4 * s, cam.widthCss, 4 * s);
    ctx.fillRect(0, y, cam.widthCss, 2 * s);

    const size = h * 0.52;
    ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    shadowText(ctx, banner.text.toUpperCase(), cam.widthCss / 2, y + h / 2, fg, 'rgba(0,0,0,0.45)', 2 * s);
    ctx.restore();
  }

  private drawReplayFrame(ctx: Ctx2D, cam: Camera, opts: OverlayOptions): void {
    const s = opts.uiScale;
    const bar = cam.heightCss * EFFECT_STYLE.letterboxFrac;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cam.widthCss, bar);
    ctx.fillRect(0, cam.heightCss - bar, cam.widthCss, bar);

    const size = Math.min(bar * 0.62, 26 * s);
    // The skip hint holds steady — a blinking "press a key" reads as a fault.
    ctx.font = `bold ${(size * EFFECT_STYLE.replayHintScale).toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(245,247,250,0.62)';
    ctx.fillText(EFFECT_STYLE.replaySkipHint, cam.widthCss - 24 * s, cam.heightCss - bar / 2);

    const blinkOn = opts.tick % TICK_HZ < TICK_HZ * 0.66;
    if (!blinkOn) return;
    ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'left';
    const cy = bar / 2;
    ctx.fillStyle = '#FF3B30';
    ctx.beginPath();
    ctx.arc(24 * s, cy, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F5F7FA';
    ctx.fillText('REPLAY', 24 * s + size * 0.6, cy);
  }
}
