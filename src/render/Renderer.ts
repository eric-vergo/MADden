// Frame orchestration: field -> entities -> effects -> HUD, with positions
// interpolated between the two most recent sim ticks and every discrete value
// read from `curr` / GameState.

import { TICK_HZ } from '../sim/constants';
import type { BallMode, GameState, KickMeterState, TickSnapshot } from '../sim/types';
import { Camera } from './Camera';
import type { Ctx2DImage } from './ctx';
import { EffectsRenderer } from './EffectsRenderer';
import { EntityRenderer, type DrawBall, type DrawPlayer } from './EntityRenderer';
import { FieldRenderer, fieldThemeFromTeams } from './FieldRenderer';
import { HudRenderer, uiScale } from './HudRenderer';
import { clamp } from './shapes';
import type { RendererExtras } from './types';

const IN_FLIGHT: ReadonlySet<BallMode> = new Set<BallMode>(['pass', 'kick', 'punt', 'pitch']);

/** Shortest-arc angle interpolation (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

/** Roles the sim hands the user when it wants them to work the kick meter. */
const KICKER_ROLES: ReadonlySet<string> = new Set(['K', 'P']);

/**
 * The kick meter the viewer should see, or null.
 *
 * `kickMeter.active` is armed for EVERY kick (preSnap arms it before it knows
 * or cares who is watching), but the sim only lets a human drive it when the
 * controlled player is the kicker — `kick.auto = play.controlledIdx !== kickerIdx`,
 * and chooseControlled hands the user the K/P exactly when their team kicks.
 * The meter is an input affordance, so showing it for anyone else puts a POWER
 * bar and an aim arrow on screen that nothing the viewer does can move.
 */
export function userKickMeter(
  meter: KickMeterState | null,
  state: Readonly<GameState>,
): KickMeterState | null {
  if (meter === null || !meter.active) return null;
  const play = state.play;
  if (play === null) return null;
  const controlled = play.players[play.controlledIdx];
  if (controlled === undefined) return null;
  return KICKER_ROLES.has(controlled.role) ? meter : null;
}

export class Renderer {
  readonly camera: Camera;
  readonly field = new FieldRenderer();
  readonly entities = new EntityRenderer();
  readonly effects = new EffectsRenderer();
  readonly hud = new HudRenderer();

  private canvas: HTMLCanvasElement | null = null;
  private ctx: Ctx2DImage | null = null;
  private readonly players: DrawPlayer[] = [];
  private lastBallHeading = Math.PI / 2;
  private lastDrawnTick = -1;

  constructor(canvas?: HTMLCanvasElement | null) {
    this.camera = new Camera();
    if (canvas) this.attach(canvas);
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    this.ctx = ctx;
  }

  /** Viewport change: resizes the backing store and re-applies the DPR transform. */
  resize(widthCss: number, heightCss: number, rawDpr: number): void {
    this.camera.resize(widthCss, heightCss, rawDpr);
    const canvas = this.canvas;
    if (canvas) {
      canvas.width = this.camera.backingWidth();
      canvas.height = this.camera.backingHeight();
      canvas.style.width = `${Math.round(this.camera.widthCss)}px`;
      canvas.style.height = `${Math.round(this.camera.heightCss)}px`;
    }
    if (this.ctx) this.camera.applyTransform(this.ctx);
  }

  /** Cut the camera (new drive, post-replay) instead of springing to it. */
  snapCamera(worldY: number): void {
    this.camera.snapTo(worldY);
  }

  draw(
    prev: TickSnapshot,
    curr: TickSnapshot,
    alpha: number,
    state: Readonly<GameState>,
    extras: RendererExtras,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cam = this.camera;
    const tick = curr.tick;
    const a = clamp(alpha, 0, 1);

    cam.setOrientation(extras.viewAttackDir);
    cam.setTarget(extras.cameraTargetY ?? this.autoCameraTarget(curr, state));
    if (this.lastDrawnTick < 0) cam.snapTo(cam.targetY);
    cam.update(extras.frameDtSec);
    cam.applyTransform(ctx);

    const theme = fieldThemeFromTeams(extras.teams, state.attackDir);
    this.field.ensure(cam, theme);
    this.field.blit(ctx, cam);
    this.field.drawSituationLines(ctx, cam, curr.lineOfScrimmageY, curr.firstDownY);

    this.buildPlayers(prev, curr, a);
    this.entities.drawPlayers(ctx, cam, this.players, {
      visuals: [extras.teams[0].visual, extras.teams[1].visual],
      tick,
      keys: extras.receiverKeys,
      showKeys: extras.showReceiverKeys,
    });

    const ball = this.buildBall(prev, curr, a);
    if (ball) this.entities.drawBall(ctx, cam, ball);

    this.effects.prune(tick);
    this.effects.drawWorld(ctx, cam, tick, extras.passLanding);
    this.effects.drawOverlay(ctx, cam, {
      tick,
      uiScale: uiScale(cam),
      teams: extras.teams,
      kickMeter: userKickMeter(curr.kickMeter, state),
      yardagePopup: extras.yardagePopup,
      banner: extras.banner,
      replay: extras.replay,
    });

    if (extras.showHud) this.hud.draw(ctx, cam, state, extras, tick);
    this.lastDrawnTick = tick;
  }

  private autoCameraTarget(curr: TickSnapshot, state: Readonly<GameState>): number {
    if (curr.ball) return curr.ball.y;
    for (const p of curr.players) {
      if (p.hasBall) return p.y;
    }
    if (curr.lineOfScrimmageY !== null) return curr.lineOfScrimmageY;
    return state.ballOnY;
  }

  private buildPlayers(prev: TickSnapshot, curr: TickSnapshot, alpha: number): void {
    this.players.length = 0;
    const canLerp = prev !== curr
      && prev.players.length === curr.players.length
      && curr.tick > prev.tick;
    const tickSpan = Math.max(1, curr.tick - prev.tick);

    for (let i = 0; i < curr.players.length; i++) {
      const c = curr.players[i];
      if (!c) continue;
      const p = canLerp ? prev.players[i] : undefined;
      const x = p ? p.x + (c.x - p.x) * alpha : c.x;
      const y = p ? p.y + (c.y - p.y) * alpha : c.y;
      const facing = p ? lerpAngle(p.facing, c.facing, alpha) : c.facing;
      const speed = p ? (Math.hypot(c.x - p.x, c.y - p.y) / tickSpan) * TICK_HZ : 0;
      this.players.push({
        idx: i,
        x,
        y,
        facing,
        anim: c.anim,
        hasBall: c.hasBall,
        team: c.team,
        jersey: c.jersey,
        controlled: c.controlled,
        speed,
      });
    }
  }

  private buildBall(prev: TickSnapshot, curr: TickSnapshot, alpha: number): DrawBall | null {
    const c = curr.ball;
    if (!c) return null;
    const p = prev !== curr && curr.tick > prev.tick ? prev.ball : null;
    const x = p ? p.x + (c.x - p.x) * alpha : c.x;
    const y = p ? p.y + (c.y - p.y) * alpha : c.y;
    const z = p ? p.z + (c.z - p.z) * alpha : c.z;
    if (p) {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (Math.hypot(dx, dy) > 1e-3) this.lastBallHeading = Math.atan2(dy, dx);
    }
    return { x, y, z, heading: this.lastBallHeading, inFlight: IN_FLIGHT.has(c.mode) };
  }
}
