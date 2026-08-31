// Bottom-anchored canvas HUD: scoreboard strip, down-and-distance, play clock,
// ticker line, coverage hint. Pure drawing over GameState + RendererExtras —
// it never mutates either.

import { GamePhase, type GameState, type TeamSide } from '../sim/types';
import { TIMEOUTS_PER_HALF } from '../sim/constants';
import type { Camera } from './Camera';
import type { Ctx2D, Ctx2DImage } from './ctx';
import { UI_FONT } from './ctx';
import {
  approxTextWidth, clamp, fillEllipse, rgba, roundRectPath, shadowText,
} from './shapes';
import {
  ballOnText, downAndDistanceText, formatClock, formatPlayClock, isGoalToGo, quarterLabel,
  typewriterSlice,
} from './format';
import { LogoCache } from './logo';
import type { RendererExtras } from './types';

// TODO(balance): HUD metrics (CSS px at uiScale 1) pending consolidation.
export const HUD_STYLE = {
  stripWidthFrac: 0.55,
  stripMinWidth: 520,
  stripMaxWidth: 940,
  stripHeight: 44,
  stripBottomMargin: 14,
  logoSize: 26,
  dotRadius: 3.2,
  dotSpacing: 9.5,
  tickerHeight: 24,
  tickerCharsPerSec: 40,
  playClockPulseSec: 5,
  bg: 'rgba(9,12,17,0.86)',
  border: 'rgba(240,244,248,0.28)',
  text: '#EFF3F7',
  dim: '#9FB0C0',
  alert: '#FF453A',
  hint: '#F2C744',
} as const;

export function uiScale(cam: Camera): number {
  return clamp(cam.heightCss / 720, 0.8, 1.5);
}

interface StripLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
}

export class HudRenderer {
  readonly logos = new LogoCache();

  layout(cam: Camera): StripLayout {
    const s = uiScale(cam);
    const w = clamp(
      cam.widthCss * HUD_STYLE.stripWidthFrac,
      Math.min(HUD_STYLE.stripMinWidth * s, cam.widthCss - 24),
      HUD_STYLE.stripMaxWidth * s,
    );
    const h = HUD_STYLE.stripHeight * s;
    return {
      x: (cam.widthCss - w) / 2,
      y: cam.heightCss - HUD_STYLE.stripBottomMargin * s - h,
      w,
      h,
      s,
    };
  }

  draw(
    ctx: Ctx2DImage,
    cam: Camera,
    state: Readonly<GameState>,
    extras: RendererExtras,
    tick: number,
  ): void {
    const box = this.layout(cam);
    this.drawCoverageHint(ctx, box, extras);
    this.drawTicker(ctx, box, extras, tick);
    this.drawSituation(ctx, box, state, extras);
    this.drawPlayClock(ctx, box, state, tick);
    this.drawScoreboard(ctx, cam, box, state, extras);
  }

  // -------------------------------------------------------------------------

  private drawScoreboard(
    ctx: Ctx2DImage,
    cam: Camera,
    box: StripLayout,
    state: Readonly<GameState>,
    extras: RendererExtras,
  ): void {
    const { x, y, w, h, s } = box;
    roundRectPath(ctx, x, y, w, h, 7 * s);
    ctx.fillStyle = HUD_STYLE.bg;
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = HUD_STYLE.border;
    ctx.stroke();

    const cy = y + h / 2;
    // Design order: away on the left, home on the right.
    this.drawTeamBlock(ctx, cam, box, 1, x + 12 * s, cy, 'left', state, extras);
    this.drawTeamBlock(ctx, cam, box, 0, x + w - 12 * s, cy, 'right', state, extras);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${(11 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.fillStyle = HUD_STYLE.dim;
    ctx.fillText(quarterLabel(state.quarter), x + w / 2, cy - 10 * s);
    ctx.font = `bold ${(20 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.fillStyle = HUD_STYLE.text;
    ctx.fillText(formatClock(state.clockSec), x + w / 2, cy + 9 * s);

    // Divider ticks either side of the clock.
    ctx.strokeStyle = 'rgba(240,244,248,0.18)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 46 * s, y + 8 * s);
    ctx.lineTo(x + w / 2 - 46 * s, y + h - 8 * s);
    ctx.moveTo(x + w / 2 + 46 * s, y + 8 * s);
    ctx.lineTo(x + w / 2 + 46 * s, y + h - 8 * s);
    ctx.stroke();
  }

  private drawTeamBlock(
    ctx: Ctx2DImage,
    cam: Camera,
    box: StripLayout,
    team: TeamSide,
    edgeX: number,
    cy: number,
    side: 'left' | 'right',
    state: Readonly<GameState>,
    extras: RendererExtras,
  ): void {
    const s = box.s;
    const dir = side === 'left' ? 1 : -1;
    const pres = extras.teams[team];
    const logoSize = HUD_STYLE.logoSize * s;

    const logoX = edgeX + dir * (logoSize / 2);
    if (pres.logo) {
      this.logos.draw(ctx, pres.logo, logoSize, logoX, cy, cam.dpr, {
        letter: pres.city.slice(0, 1),
      });
    } else {
      fillEllipse(ctx, logoX, cy, logoSize / 2, logoSize / 2, 0, pres.colors.primary);
    }

    ctx.textAlign = side;
    ctx.textBaseline = 'middle';
    const abbrevX = edgeX + dir * (logoSize + 10 * s);
    ctx.font = `bold ${(17 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.fillStyle = HUD_STYLE.text;
    ctx.fillText(pres.abbrev, abbrevX, cy - 6 * s);

    const scoreX = edgeX + dir * (logoSize + 74 * s);
    ctx.textAlign = side === 'left' ? 'right' : 'left';
    ctx.font = `bold ${(23 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.fillStyle = HUD_STYLE.text;
    ctx.fillText(String(state.score[team]), scoreX, cy - 4 * s);

    // Timeout pips under the abbreviation.
    const left = state.timeouts[team];
    for (let i = 0; i < TIMEOUTS_PER_HALF; i++) {
      const dx = abbrevX + dir * (i * HUD_STYLE.dotSpacing * s + HUD_STYLE.dotRadius * s);
      const filled = i < left;
      ctx.beginPath();
      ctx.arc(dx, cy + 12 * s, HUD_STYLE.dotRadius * s, 0, Math.PI * 2);
      ctx.fillStyle = filled ? pres.colors.secondary : 'rgba(240,244,248,0.22)';
      ctx.fill();
    }

    if (state.possession === team) {
      const px = abbrevX + dir * 4 * s;
      fillEllipse(ctx, px, cy - 20 * s, 7 * s, 4.2 * s, 0, '#7A4A21');
    }
  }

  private drawSituation(
    ctx: Ctx2D,
    box: StripLayout,
    state: Readonly<GameState>,
    extras: RendererExtras,
  ): void {
    if (state.phase === GamePhase.GAME_OVER) return;
    const s = box.s;
    const abbrevs: [string, string] = [extras.teams[0].abbrev, extras.teams[1].abbrev];
    const goalToGo = isGoalToGo(state.ballOnY, state.possession, state.attackDir, state.toGo);
    const text = `${downAndDistanceText(state.down, state.toGo, goalToGo)}  ·  BALL ON ${ballOnText(
      state.ballOnY,
      state.attackDir,
      abbrevs,
    )}`;
    ctx.font = `bold ${(16 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    shadowText(ctx, text, box.x, box.y - 12 * s, HUD_STYLE.text, 'rgba(0,0,0,0.8)', 2);
  }

  private drawPlayClock(
    ctx: Ctx2D,
    box: StripLayout,
    state: Readonly<GameState>,
    tick: number,
  ): void {
    if (state.phase !== GamePhase.PLAY_CALL && state.phase !== GamePhase.PRE_SNAP) return;
    const s = box.s;
    const sec = state.playClockSec;
    const urgent = sec <= HUD_STYLE.playClockPulseSec;
    const pulse = urgent ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tick * 0.32)) : 1;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${(20 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    shadowText(
      ctx,
      `:${formatPlayClock(sec).padStart(2, '0')}`,
      box.x + box.w,
      box.y - 12 * s,
      urgent ? HUD_STYLE.alert : HUD_STYLE.text,
      'rgba(0,0,0,0.8)',
      2,
    );
    ctx.restore();
  }

  private drawTicker(
    ctx: Ctx2D,
    box: StripLayout,
    extras: RendererExtras,
    tick: number,
  ): void {
    const line = extras.ticker;
    if (!line || line.text.length === 0) return;
    const s = box.s;
    const h = HUD_STYLE.tickerHeight * s;
    const y = box.y - 54 * s;
    const shown = typewriterSlice(line.text, line.startTick, tick, HUD_STYLE.tickerCharsPerSec);
    if (shown.length === 0) return;
    const size = 13 * s;
    const w = Math.min(box.w, approxTextWidth(line.text, size) + 24 * s);

    roundRectPath(ctx, box.x, y, w, h, 4 * s);
    ctx.fillStyle = 'rgba(9,12,17,0.72)';
    ctx.fill();
    ctx.fillStyle = HUD_STYLE.hint;
    ctx.fillRect(box.x, y, 3 * s, h);

    ctx.font = `${size.toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = HUD_STYLE.text;
    ctx.fillText(shown, box.x + 12 * s, y + h / 2);

    // Caret while the line is still revealing.
    if (shown.length < line.text.length && tick % 20 < 12) {
      const caretX = box.x + 12 * s + approxTextWidth(shown, size) + 2 * s;
      ctx.fillStyle = rgba(HUD_STYLE.hint, 0.9);
      ctx.fillRect(caretX, y + h * 0.28, 2 * s, h * 0.44);
    }
  }

  private drawCoverageHint(ctx: Ctx2D, box: StripLayout, extras: RendererExtras): void {
    const hint = extras.coverageHint;
    if (!hint) return;
    const s = box.s;
    ctx.font = `italic bold ${(14 * s).toFixed(1)}px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    shadowText(ctx, hint, box.x, box.y - 64 * s, HUD_STYLE.hint, 'rgba(0,0,0,0.8)', 2);
  }
}
