// Pure HUD text helpers. No canvas, no DOM — unit-tested directly.

import type { GameState, TeamSide } from '../sim/types';
import { GOAL_AWAY_Y, GOAL_HOME_Y, TICK_HZ } from '../sim/constants';

const MIDFIELD_Y = (GOAL_HOME_Y + GOAL_AWAY_Y) / 2;

/** Game clock as MM:SS (zero padded both sides, as the scoreboard shows it). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Play clock — whole seconds, no padding. */
export function formatPlayClock(seconds: number): string {
  return String(Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0)));
}

export function ordinal(n: number): string {
  const v = Math.trunc(n);
  const mod100 = ((v % 100) + 100) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (((v % 10) + 10) % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

export function quarterLabel(quarter: number): string {
  if (quarter <= 4) return `Q${Math.max(1, Math.trunc(quarter))}`;
  if (quarter === 5) return 'OT';
  return `${quarter - 4}OT`;
}

/** "2nd & 7", "1st & Goal", "3rd & inches". */
export function downAndDistanceText(down: number, toGo: number, goalToGo: boolean): string {
  const d = ordinal(Math.max(1, Math.trunc(down)));
  if (goalToGo) return `${d} & Goal`;
  if (toGo < 1) return `${d} & inches`;
  return `${d} & ${Math.round(toGo)}`;
}

/** Yards from the ball spot to the end zone the possessing team attacks. */
export function yardsToOpponentGoal(
  ballOnY: number,
  possession: TeamSide,
  attackDir: readonly [1 | -1, 1 | -1],
): number {
  return attackDir[possession] === 1 ? GOAL_AWAY_Y - ballOnY : ballOnY - GOAL_HOME_Y;
}

export function isGoalToGo(
  ballOnY: number,
  possession: TeamSide,
  attackDir: readonly [1 | -1, 1 | -1],
  toGo: number,
): boolean {
  return toGo >= yardsToOpponentGoal(ballOnY, possession, attackDir) - 1e-6;
}

/** 0..50 — the number painted on the field at that spot. */
export function yardLineNumber(ballOnY: number): number {
  const clamped = Math.min(Math.max(ballOnY, GOAL_HOME_Y), GOAL_AWAY_Y);
  const n = clamped <= MIDFIELD_Y ? clamped - GOAL_HOME_Y : GOAL_AWAY_Y - clamped;
  return Math.round(n);
}

/** Which team's half the spot sits in (null exactly at midfield). */
export function territoryTeam(
  ballOnY: number,
  attackDir: readonly [1 | -1, 1 | -1],
): TeamSide | null {
  if (Math.abs(ballOnY - MIDFIELD_Y) < 1e-6) return null;
  const lowDefender: TeamSide = attackDir[0] === 1 ? 0 : 1;
  const highDefender: TeamSide = lowDefender === 0 ? 1 : 0;
  return ballOnY < MIDFIELD_Y ? lowDefender : highDefender;
}

/** "HOM 34", "MID 50", "AWY GL". */
export function ballOnText(
  ballOnY: number,
  attackDir: readonly [1 | -1, 1 | -1],
  abbrevs: readonly [string, string],
): string {
  const side = territoryTeam(ballOnY, attackDir);
  if (side === null) return 'MID 50';
  const n = yardLineNumber(ballOnY);
  const abbrev = abbrevs[side] ?? '???';
  return n <= 0 ? `${abbrev} GL` : `${abbrev} ${n}`;
}

/** The HUD's left block: "2nd & 7 · BALL ON HOM 34". */
export function situationText(state: Readonly<GameState>): string {
  const abbrevs: [string, string] = [state.rosters[0].abbrev, state.rosters[1].abbrev];
  const goalToGo = isGoalToGo(state.ballOnY, state.possession, state.attackDir, state.toGo);
  const dd = downAndDistanceText(state.down, state.toGo, goalToGo);
  return `${dd} · BALL ON ${ballOnText(state.ballOnY, state.attackDir, abbrevs)}`;
}

/** "+7" / "-3" / "NO GAIN" for the post-play popup. */
export function yardageDeltaText(yards: number): string {
  const y = Math.round(yards);
  if (y === 0) return 'NO GAIN';
  return y > 0 ? `+${y}` : `${y}`;
}

/** Characters revealed by a typewriter running at `charsPerSec`. */
export function typewriterCount(
  startTick: number,
  nowTick: number,
  charsPerSec: number,
): number {
  const elapsed = Math.max(0, nowTick - startTick);
  return Math.floor((elapsed / TICK_HZ) * charsPerSec);
}

export function typewriterSlice(
  text: string,
  startTick: number,
  nowTick: number,
  charsPerSec = 40,
): string {
  return text.slice(0, Math.min(text.length, typewriterCount(startTick, nowTick, charsPerSec)));
}

/** "ASH 14 — MER 21" style compact score, used by the replay/summary overlays. */
export function scoreText(
  abbrevs: readonly [string, string],
  score: readonly [number, number],
): string {
  return `${abbrevs[0] ?? '???'} ${score[0]} — ${abbrevs[1] ?? '???'} ${score[1]}`;
}
