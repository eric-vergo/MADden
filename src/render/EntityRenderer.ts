// Procedural players and ball — no art assets. Every player is a shadow, a
// torso disc in the jersey color, a helmet disc pushed toward the facing
// direction, a jersey number, and a two-frame leg shuffle whose phase comes
// from speed + tick (so it is frame-rate independent and replay-stable).

import type { PlayerAnimState, TeamSide } from '../sim/types';
import type { Camera } from './Camera';
import type { Ctx2D } from './ctx';
import { UI_FONT } from './ctx';
import { clamp, fillCircle, fillEllipse, rgba, roundRectPath, shade } from './shapes';
import type { ReceiverKey, TeamVisual } from './types';

// TODO(balance): entity proportions (world yards) pending consolidation.
export const ENTITY_STYLE = {
  bodyRadiusYd: 0.5,
  helmetRadiusYd: 0.3,
  helmetOffsetYd: 0.24,
  shadowRxYd: 0.62,
  shadowRyYd: 0.3,
  shadowAlpha: 0.32,
  shadowOffsetYd: 0.16,
  legLenYd: 0.4,
  legWidthYd: 0.19,
  legSpreadYd: 0.24,
  numberHeightYd: 0.55,
  ringRadiusYd: 0.86,
  ringWidthYd: 0.11,
  ballRxYd: 0.33,
  ballRyYd: 0.2,
  ballZScalePerYd: 0.075,
  ballShadowPerZYd: 0.28,
  keyBoxYd: 0.95,
  keyOffsetYd: 1.55,
  /** Leg cadence in radians per tick: base + perSpeed * (yd/s). */
  cadenceBase: 0.14,
  cadencePerSpeed: 0.075,
  /** Below this speed the player stands still. */
  idleSpeedYdPerSec: 0.4,
  minNumberPx: 6,
} as const;

const BALL_BROWN = '#7A4A21';
const BALL_LACE = '#F2EFE6';

/** One interpolated player, ready to draw. Built by Renderer from snapshots. */
export interface DrawPlayer {
  idx: number;
  x: number;
  y: number;
  facing: number;
  anim: PlayerAnimState;
  hasBall: boolean;
  team: TeamSide;
  jersey: number;
  controlled: boolean;
  /** yd/s, derived from the snapshot pair — drives the leg shuffle. */
  speed: number;
}

export interface DrawBall {
  x: number;
  y: number;
  z: number;
  /** Radians, from the interpolated travel direction. */
  heading: number;
  inFlight: boolean;
}

export interface EntityDrawOptions {
  visuals: readonly [TeamVisual, TeamVisual];
  tick: number;
  keys: readonly ReceiverKey[];
  showKeys: boolean;
}

export class EntityRenderer {
  private readonly order: number[] = [];

  /** Painter's order: further up the screen drawn first. */
  drawPlayers(
    ctx: Ctx2D,
    cam: Camera,
    players: readonly DrawPlayer[],
    opts: EntityDrawOptions,
  ): void {
    this.order.length = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p) continue;
      if (!cam.isVisible(p.x, p.y, 3)) continue;
      this.order.push(i);
    }
    const sign = cam.flipped ? -1 : 1;
    this.order.sort((a, b) => {
      const pa = players[a];
      const pb = players[b];
      if (!pa || !pb) return a - b;
      const ya = -pa.y * sign;
      const yb = -pb.y * sign;
      return ya === yb ? a - b : ya - yb;
    });

    for (const i of this.order) {
      const p = players[i];
      if (!p) continue;
      this.drawShadow(ctx, cam, p);
    }
    for (const i of this.order) {
      const p = players[i];
      if (!p) continue;
      const visual = opts.visuals[p.team] ?? opts.visuals[0];
      if (p.controlled) this.drawControlRing(ctx, cam, p, opts.tick, visual);
      this.drawPlayer(ctx, cam, p, visual, opts.tick);
    }
    if (opts.showKeys && opts.keys.length > 0) {
      this.drawReceiverKeys(ctx, cam, players, opts);
    }
  }

  private drawShadow(ctx: Ctx2D, cam: Camera, p: DrawPlayer): void {
    const sx = cam.toScreenX(p.x);
    const sy = cam.toScreenY(p.y) + cam.toPx(ENTITY_STYLE.shadowOffsetYd);
    fillEllipse(
      ctx,
      sx,
      sy,
      cam.toPx(ENTITY_STYLE.shadowRxYd),
      cam.toPx(ENTITY_STYLE.shadowRyYd),
      0,
      rgba('#000000', ENTITY_STYLE.shadowAlpha),
    );
  }

  private drawControlRing(
    ctx: Ctx2D,
    cam: Camera,
    p: DrawPlayer,
    tick: number,
    visual: TeamVisual,
  ): void {
    const pulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(tick * 0.16));
    const r = cam.toPx(ENTITY_STYLE.ringRadiusYd);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.lineWidth = Math.max(1.5, cam.toPx(ENTITY_STYLE.ringWidthYd));
    ctx.strokeStyle = visual.accent;
    ctx.beginPath();
    ctx.ellipse(cam.toScreenX(p.x), cam.toScreenY(p.y) + r * 0.18, r, r * 0.52, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayer(
    ctx: Ctx2D,
    cam: Camera,
    p: DrawPlayer,
    visual: TeamVisual,
    tick: number,
  ): void {
    const sx = cam.toScreenX(p.x);
    const sy = cam.toScreenY(p.y);
    // Screen-space facing: the camera flip rotates the world by pi.
    const facing = cam.flipped ? p.facing + Math.PI : p.facing;
    const fx = Math.cos(facing);
    const fy = -Math.sin(facing);
    const body = cam.toPx(ENTITY_STYLE.bodyRadiusYd);
    const prone = p.anim === 'down' || p.anim === 'diving' || p.anim === 'dragged';

    // Legs: strict two-frame shuffle, phase from speed + tick.
    if (!prone && p.speed > ENTITY_STYLE.idleSpeedYdPerSec) {
      const cadence = ENTITY_STYLE.cadenceBase + ENTITY_STYLE.cadencePerSpeed * Math.min(p.speed, 11);
      const frame = Math.sin(tick * cadence + p.jersey * 0.7) >= 0 ? 1 : -1;
      const lead = cam.toPx(ENTITY_STYLE.legLenYd) * frame;
      const spread = cam.toPx(ENTITY_STYLE.legSpreadYd);
      const px = -fy;
      const py = fx;
      ctx.strokeStyle = visual.outline;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, cam.toPx(ENTITY_STYLE.legWidthYd));
      ctx.beginPath();
      ctx.moveTo(sx + px * spread * 0.5, sy + py * spread * 0.5);
      ctx.lineTo(sx + px * spread * 0.5 + fx * lead, sy + py * spread * 0.5 + fy * lead);
      ctx.moveTo(sx - px * spread * 0.5, sy - py * spread * 0.5);
      ctx.lineTo(sx - px * spread * 0.5 - fx * lead, sy - py * spread * 0.5 - fy * lead);
      ctx.stroke();
    }

    // Torso: an upright disc, or a body-length ellipse along facing when prone.
    if (prone) {
      fillEllipse(ctx, sx, sy, body * 1.35, body * 0.72, -facing, visual.jersey);
      ctx.lineWidth = Math.max(1, body * 0.16);
      ctx.strokeStyle = visual.outline;
      ctx.beginPath();
      ctx.ellipse(sx, sy, body * 1.35, body * 0.72, -facing, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      fillCircle(ctx, sx, sy, body, visual.jersey);
      ctx.lineWidth = Math.max(1, body * 0.18);
      ctx.strokeStyle = visual.outline;
      ctx.beginPath();
      ctx.arc(sx, sy, body, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Jersey number on the torso.
    const numberPx = cam.toPx(ENTITY_STYLE.numberHeightYd);
    if (!prone && numberPx >= ENTITY_STYLE.minNumberPx) {
      ctx.font = `bold ${numberPx.toFixed(1)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = visual.numberColor;
      ctx.fillText(String(p.jersey), sx, sy + numberPx * 0.04);
    }

    // Helmet, offset toward facing.
    const helm = cam.toPx(ENTITY_STYLE.helmetRadiusYd);
    const off = cam.toPx(ENTITY_STYLE.helmetOffsetYd) + (prone ? body * 0.9 : 0);
    const hx = sx + fx * off;
    const hy = sy + fy * off;
    fillCircle(ctx, hx, hy, helm, visual.helmet);
    ctx.lineWidth = Math.max(1, helm * 0.28);
    ctx.strokeStyle = visual.outline;
    ctx.beginPath();
    ctx.arc(hx, hy, helm, 0, Math.PI * 2);
    ctx.stroke();
    // Face mask stripe.
    ctx.strokeStyle = rgba(visual.accent, 0.9);
    ctx.lineWidth = Math.max(1, helm * 0.22);
    ctx.beginPath();
    ctx.moveTo(hx + fx * helm * 0.35, hy + fy * helm * 0.35);
    ctx.lineTo(hx + fx * helm * 1.05, hy + fy * helm * 1.05);
    ctx.stroke();

    if (p.hasBall) {
      const bx = sx - fx * body * 0.75 - fy * body * 0.55;
      const by = sy - fy * body * 0.75 + fx * body * 0.55;
      fillEllipse(ctx, bx, by, body * 0.42, body * 0.26, -facing, BALL_BROWN);
    }
  }

  private drawReceiverKeys(
    ctx: Ctx2D,
    cam: Camera,
    players: readonly DrawPlayer[],
    opts: EntityDrawOptions,
  ): void {
    const box = cam.toPx(ENTITY_STYLE.keyBoxYd);
    const size = Math.max(9, box * 0.72);
    for (const key of opts.keys) {
      const p = players[key.idx];
      if (!p) continue;
      if (!cam.isVisible(p.x, p.y, 3)) continue;
      const visual = opts.visuals[p.team] ?? opts.visuals[0];
      const sx = cam.toScreenX(p.x);
      const sy = cam.toScreenY(p.y) - cam.toPx(ENTITY_STYLE.keyOffsetYd);
      roundRectPath(ctx, sx - box / 2, sy - box / 2, box, box, box * 0.28);
      ctx.fillStyle = rgba('#0B0E13', 0.82);
      ctx.fill();
      ctx.lineWidth = Math.max(1, box * 0.09);
      ctx.strokeStyle = visual.accent;
      ctx.stroke();
      ctx.font = `bold ${size.toFixed(1)}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#F5F7FA';
      ctx.fillText(String(key.key), sx, sy + size * 0.05);
    }
  }

  /** Ball with a height-scaled body and an offset ground shadow. */
  drawBall(ctx: Ctx2D, cam: Camera, ball: DrawBall): void {
    const z = Math.max(0, ball.z);
    const groundY = cam.toScreenY(ball.y);
    const gx = cam.toScreenX(ball.x);
    if (!cam.isVisible(ball.x, ball.y, 6)) return;

    if (ball.inFlight || z > 0.05) {
      fillEllipse(
        ctx,
        gx,
        groundY,
        cam.toPx(ENTITY_STYLE.ballRxYd) * 0.85,
        cam.toPx(ENTITY_STYLE.ballRyYd) * 0.85,
        0,
        rgba('#000000', clamp(0.34 - z * 0.02, 0.08, 0.34)),
      );
    }

    const lift = cam.toPx(z * ENTITY_STYLE.ballShadowPerZYd);
    const scale = 1 + z * ENTITY_STYLE.ballZScalePerYd;
    const bx = gx;
    const by = groundY - lift;
    const rot = cam.flipped ? -(ball.heading + Math.PI) : -ball.heading;
    const rx = cam.toPx(ENTITY_STYLE.ballRxYd) * scale;
    const ry = cam.toPx(ENTITY_STYLE.ballRyYd) * scale;

    fillEllipse(ctx, bx, by, rx, ry, rot, BALL_BROWN);
    ctx.lineWidth = Math.max(1, rx * 0.12);
    ctx.strokeStyle = shade(BALL_BROWN, -0.4);
    ctx.beginPath();
    ctx.ellipse(bx, by, rx, ry, rot, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = BALL_LACE;
    ctx.lineWidth = Math.max(1, rx * 0.14);
    ctx.beginPath();
    ctx.moveTo(bx - Math.cos(rot) * rx * 0.45, by - Math.sin(rot) * rx * 0.45);
    ctx.lineTo(bx + Math.cos(rot) * rx * 0.45, by + Math.sin(rot) * rx * 0.45);
    ctx.stroke();
  }
}
