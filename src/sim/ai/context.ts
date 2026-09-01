// Per-tick derived AI context + shared queries. Built once per updateLiveAI
// call so the 22 brains never re-derive the same facts.
//
// MIND KEY REGISTRY (SimPlayer.mind — numbers only, see index.ts for the
// cross-stream contract). Keys are namespaced by brain:
//   ai*   shared bookkeeping (alignment memory, step marker, owned timers)
//   rt*   routes.ts        cv*  coverage.ts     bk*  blocking.ts
//   pu*   pursuit.ts       cr*  carrier.ts      qb*  qb.ts
//   st*   specialTeams.ts

import type {
  Ball, DefAssignment, GameState, OffAssignment, PlayState, SimPlayer, TeamSide, Vec2,
} from '../types';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import { DIFFICULTY, type DifficultyParams } from '../../data/balance';
import { dist } from '../vec';
import type { Dir } from './frame';
import { depthYd } from './frame';

export const OFFENSE_LO = 0;
export const OFFENSE_HI = 10;
export const DEFENSE_LO = 11;
export const DEFENSE_HI = 21;

export interface AiCtx {
  state: GameState;
  play: PlayState;
  players: SimPlayer[];
  ball: Ball;
  events: SimEvent[];
  rng: Rng;
  diff: DifficultyParams;
  /** Team that snapped the ball. */
  offense: TeamSide;
  defense: TeamSide;
  /**
   * Attack direction of the snapping offense. This is the PLAY FRAME: routes,
   * coverage, blocking, gaps and special-teams geometry are all authored
   * against it and must keep using it even after a turnover. For "the way this
   * ball carrier is running" use `carrierDir` / `attackDirOf` instead.
   */
  dir: Dir;
  /**
   * Attack direction of the team currently holding a live ball — flips with
   * `ballTeam` on an interception, fumble recovery or kick return.
   */
  carrierDir: Dir;
  los: number;
  /** Ticks since the snap (>= 0). */
  t: number;
  /** Index of the current ball carrier, or -1. */
  carrierIdx: number;
  /** Team currently in possession of a live ball (flips after a turnover). */
  ballTeam: TeamSide;
  /** Index of the offense's QB (assignment kind 'qb'), or -1. */
  qbIdx: number;
  ballInAir: boolean;
}

export function mindGet(p: SimPlayer, key: string, dflt = 0): number {
  const v = p.mind[key];
  return v === undefined ? dflt : v;
}

export function mindSet(p: SimPlayer, key: string, value: number): void {
  p.mind[key] = value;
}

export function makeCtx(
  state: GameState,
  rng: Rng,
  events: SimEvent[],
): AiCtx | null {
  const play = state.play;
  if (!play || play.snapTick < 0) return null;
  const offense = state.possession;
  const defense: TeamSide = offense === 0 ? 1 : 0;
  const dir: Dir = state.attackDir[offense];
  const players = play.players;
  const ball = play.ball;
  const carrierIdx = ball.carrierIdx !== null && ball.mode === 'held' ? ball.carrierIdx : -1;
  const carrier = carrierIdx >= 0 ? players[carrierIdx] : undefined;

  let qbIdx = -1;
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = players[i];
    if (p && p.assignment.kind === 'qb') { qbIdx = i; break; }
  }

  const ballTeam: TeamSide = carrier ? carrier.team : offense;

  return {
    state,
    play,
    players,
    ball,
    events,
    rng,
    diff: DIFFICULTY[state.config.difficulty],
    offense,
    defense,
    dir,
    carrierDir: state.attackDir[ballTeam],
    los: play.lineOfScrimmageY,
    t: state.tick - play.snapTick,
    carrierIdx,
    ballTeam,
    qbIdx,
    ballInAir: ball.mode === 'pass' || ball.mode === 'pitch' || ball.mode === 'kick' || ball.mode === 'punt',
  };
}

/**
 * The direction `team` attacks — the way ITS ball carrier runs. Never use
 * `ctx.dir` for that: it is the snapping offense's direction and stays that way
 * for the whole play, so a defender who intercepts would run backwards.
 */
export function attackDirOf(ctx: AiCtx, team: TeamSide): Dir {
  return ctx.state.attackDir[team];
}

/** A player who cannot act this tick (down, stumbling, mid-dive). */
export function isIncapacitated(p: SimPlayer): boolean {
  return p.stateTimer > 0 && (p.anim === 'down' || p.anim === 'stumbling' || p.anim === 'diving');
}

/** Nearest player on the opposite team; returns idx -1 when none. */
export function nearestOpponentTo(
  ctx: AiCtx,
  pos: Vec2,
  team: TeamSide,
  skipIdx = -1,
): { idx: number; d: number } {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < ctx.players.length; i++) {
    if (i === skipIdx) continue;
    const q = ctx.players[i];
    if (!q || q.team === team || isIncapacitated(q)) continue;
    const d = dist(pos, q.pos2);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, d: bestD };
}

const ELIGIBLE_KINDS = new Set(['route', 'passProScan', 'carry']);

/**
 * Offensive skill players who can catch, in fixed index order.
 * (Assignments mutate mid-play, so this reads the ORIGINAL play definition.)
 */
export function eligibleReceivers(ctx: AiCtx): number[] {
  const out: number[] = [];
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const declared = ctx.play.offensePlay.assignments[p.role];
    const kind = declared ? declared.kind : p.assignment.kind;
    if (ELIGIBLE_KINDS.has(kind)) out.push(i);
  }
  return out;
}

/** Index of the offensive player filling `role`, or -1. */
export function indexOfRole(ctx: AiCtx, role: string, lo: number, hi: number): number {
  for (let i = lo; i <= hi; i++) {
    const p = ctx.players[i];
    if (p && p.role === role) return i;
  }
  return -1;
}

/** Declared rushers/blitzers on defense, fixed index order. */
export function declaredRushers(ctx: AiCtx): number[] {
  const out: number[] = [];
  for (let i = DEFENSE_LO; i <= DEFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const declared = ctx.play.defensePlay.assignments[p.role];
    const kind = declared ? declared.kind : p.assignment.kind;
    if (kind === 'rush' || kind === 'blitz') out.push(i);
  }
  return out;
}

/** Coverage rating a defender applies to the ball, by his current job. */
export function coverageRating(p: SimPlayer): number {
  return p.assignment.kind === 'man' ? p.ratings.mcv : p.ratings.zcv;
}
