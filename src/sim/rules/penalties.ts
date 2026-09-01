// Penalty enforcement spots and the accept/decline EV comparator.
// Both branches are projected as full PenaltyOutcomes so the UI can show them
// and the CPU can pick without re-running any of the play logic.

import type {
  GameState, PenaltyFlag, PenaltyKind, PenaltyOutcome, PendingPenaltyDecision, PlayState,
  SimPlayer, TeamSide,
} from '../types';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import { PENALTY } from '../../data/balance';
import { closingSpeed } from '../physics/collisions';
import { clampFieldY, yardsToGoal, type Dir } from '../transform';
import {
  describeState, enforceYards, freshToGo, isFirstDown, lineToGainY, otherTeam, teamAbbrevs,
} from './downs';
import { ext, type PlayOutcome } from './ext';

/** Yardage each penalty carries. DPI is a spot foul (handled separately). */
export const PENALTY_YARDS: Record<PenaltyKind, number> = {
  falseStart: 5,
  offside: 5,
  encroachment: 5,
  delayOfGame: 5,
  holding: 10,
  dpi: 0,
  opi: 10,
};

export const PENALTY_LABEL: Record<PenaltyKind, string> = {
  falseStart: 'False Start',
  offside: 'Offside',
  encroachment: 'Encroachment',
  delayOfGame: 'Delay of Game',
  holding: 'Offensive Holding',
  dpi: 'Defensive Pass Interference',
  opi: 'Offensive Pass Interference',
};

function describe(s: GameState, down: number, toGo: number, ballOnY: number, dir: Dir): string {
  const [home, away] = teamAbbrevs(s);
  return describeState(down, toGo, ballOnY, dir, home, away);
}

/** The result of letting the play stand (the "decline" branch). */
export function projectPlay(s: GameState, o: PlayOutcome): PenaltyOutcome {
  const e = ext(s);
  const poss = o.possessionAfter;
  const dir = s.attackDir[poss];
  const spot = clampFieldY(o.spotY);

  if (o.changeOfPossession || o.scoreKind !== null || o.touchdown || o.safety) {
    const toGo = freshToGo(spot, dir);
    return {
      down: 1, toGo, ballOnY: spot, possession: poss, firstDown: true,
      description: describe(s, 1, toGo, spot, dir),
    };
  }

  const lineY = e.prePlay.lineToGainY;
  if (isFirstDown(spot, lineY, dir)) {
    const toGo = freshToGo(spot, dir);
    return {
      down: 1, toGo, ballOnY: spot, possession: poss, firstDown: true,
      description: describe(s, 1, toGo, spot, dir),
    };
  }

  const nextDown = e.prePlay.down + 1;
  if (nextDown > 4) {
    const flipped = otherTeam(poss);
    const fdir = s.attackDir[flipped];
    const toGo = freshToGo(spot, fdir);
    return {
      down: 1, toGo, ballOnY: spot, possession: flipped, firstDown: true,
      description: describe(s, 1, toGo, spot, fdir),
    };
  }
  const toGo = Math.max(1, (lineY - spot) * dir);
  return {
    down: nextDown, toGo, ballOnY: spot, possession: poss, firstDown: false,
    description: describe(s, nextDown, toGo, spot, dir),
  };
}

/** The result of enforcing the flag (the "accept" branch). */
export function projectPenalty(s: GameState, flag: PenaltyFlag, o: PlayOutcome): PenaltyOutcome {
  const e = ext(s);
  const offense = e.playOffense;
  const dir = s.attackDir[offense];
  const prevSpot = e.prePlay.ballOnY;
  const lineY = e.prePlay.lineToGainY;
  const againstOffense = flag.team === offense;
  const yards = PENALTY_YARDS[flag.kind];

  // Defensive pass interference: spot foul plus an automatic first down.
  if (flag.kind === 'dpi') {
    const spot = clampFieldY(flag.spotY);
    const toGo = freshToGo(spot, dir);
    return {
      down: 1, toGo, ballOnY: spot, possession: offense, firstDown: true,
      description: describe(s, 1, toGo, spot, dir),
    };
  }

  const newSpot = clampFieldY(enforceYards(prevSpot, yards, dir, againstOffense));

  if (againstOffense) {
    const toGo = Math.max(1, (lineY - newSpot) * dir);
    const down = e.prePlay.down;
    return {
      down, toGo, ballOnY: newSpot, possession: offense, firstDown: false,
      description: describe(s, down, toGo, newSpot, dir),
    };
  }

  // Against the defense: replay the down unless the yardage reaches the sticks.
  if (isFirstDown(newSpot, lineY, dir)) {
    const toGo = freshToGo(newSpot, dir);
    return {
      down: 1, toGo, ballOnY: newSpot, possession: offense, firstDown: true,
      description: describe(s, 1, toGo, newSpot, dir),
    };
  }
  const toGo = Math.max(1, (lineY - newSpot) * dir);
  const down = e.prePlay.down;
  return {
    down, toGo, ballOnY: newSpot, possession: offense, firstDown: false,
    description: describe(s, down, toGo, newSpot, dir),
  };
}

/**
 * Crude expected-points valuation of a down-and-distance, signed for
 * `forTeam`. Good enough to make the CPU's accept/decline choices sensible.
 */
export function evaluate(s: GameState, outcome: PenaltyOutcome, forTeam: TeamSide): number {
  const dir = s.attackDir[outcome.possession];
  const toGoal = Math.max(0, Math.min(100, yardsToGoal(outcome.ballOnY, dir)));
  let v = 6.0 * (1 - toGoal / 100) - 0.5;
  v -= 0.35 * (outcome.down - 1);
  v -= 0.06 * outcome.toGo;
  if (outcome.firstDown) v += 0.4;
  return outcome.possession === forTeam ? v : -v;
}

export function buildDecision(
  s: GameState,
  flag: PenaltyFlag,
  o: PlayOutcome,
): PendingPenaltyDecision {
  return {
    flag,
    decidingTeam: otherTeam(flag.team),
    acceptOutcome: projectPenalty(s, flag, o),
    declineOutcome: projectPlay(s, o),
  };
}

export function chooseByEV(s: GameState, d: PendingPenaltyDecision): 'accept' | 'decline' {
  const a = evaluate(s, d.acceptOutcome, d.decidingTeam);
  const b = evaluate(s, d.declineOutcome, d.decidingTeam);
  return a > b ? 'accept' : 'decline';
}

/** Pre-snap fouls kill the play and are enforced without a choice. */
export function isDeadBallFoul(kind: PenaltyKind): boolean {
  return kind === 'falseStart' || kind === 'delayOfGame' || kind === 'encroachment';
}

// ---------------------------------------------------------------------------
// Pass interference (sim-design.md section 12)
// ---------------------------------------------------------------------------
//
// These four are shape constants, not balance knobs: they describe what
// "contact downfield before the ball got there" means. The two rates that ARE
// tunable live in balance.PENALTY (dpiClosingSpeedYdPerSec, opiOnPickContact).

/** Bodies this close are running into each other, not merely covering. */
const PI_CONTACT_RADIUS_YD = 1.1;
/** Design doc: the foul only exists more than a yard downfield. */
const PI_DOWNFIELD_YD = 1;
/**
 * The ball must still be this far from the receiver. Inside it, everyone is
 * playing the ball and contact is incidental — that is the catch contest's job.
 */
const PI_PRE_ARRIVAL_YD = 6;
/**
 * Chance a qualifying DPI collision actually draws the flag. The gate above is
 * doing most of the work; this softener keeps a user defender who leans on a
 * receiver from being flagged every single time. Measured over 10 headless
 * games: DPI+OPI ~0.6 a game out of ~5.3 flags total (design band 2-8).
 */
const DPI_ON_CONTACT = 0.3;
/**
 * A pick is contact with the man covering the INTENDED receiver; a collision
 * with some unrelated defender on the other side of the field is not OPI.
 */
const OPI_VICTIM_NEAR_TARGET_YD = 4;

function within(a: SimPlayer, b: SimPlayer, r: number): boolean {
  return Math.hypot(a.pos2.x - b.pos2.x, a.pos2.y - b.pos2.y) <= r;
}

function pushFlag(p: PlayState, flag: PenaltyFlag, tick: number, events: SimEvent[]): void {
  p.flags.push(flag);
  events.push({ type: 'FLAG', tick, flag });
}

/**
 * Adjudicate pass interference on the ball in flight. Called once per tick
 * while a pass is up; the FIRST qualifying contact is the only one considered
 * (`ext.piChecked`), so at most one roll is taken per pass.
 *
 * DPI: a defender who is NOT playing the ball (mind.cvPlayBall === 0) initiates
 * contact into the intended receiver more than a yard downfield, before the
 * ball is anywhere near — spot foul plus an automatic first down.
 * OPI: the mirror check on pick-style contact by an offensive player other than
 * the target — 10 yards from the previous spot.
 *
 * [SIMPLE-BY-CHOICE] only the intended receiver can be interfered with, and
 * contact is judged on closing speed rather than on who was playing through
 * whom. Face-guarding, uncatchable balls and offsetting fouls are out of scope.
 */
export function maybePassInterference(
  s: GameState,
  p: PlayState,
  rng: Rng,
  events: SimEvent[],
): void {
  if (!s.config.penaltiesEnabled || PENALTY.frequency <= 0) return;
  const e = ext(s);
  if (e.piChecked) return;
  if (p.flags.length > 0) return; // at most one flag per play
  if (p.ball.mode !== 'pass' || e.throwaway) return;

  const targetIdx = p.ball.targetIdx;
  if (targetIdx === null) return;
  const rec = p.players[targetIdx];
  if (rec === undefined || rec.anim === 'down') return;

  const offense = e.playOffense;
  const dir = s.attackDir[offense];
  if ((rec.pos2.y - p.lineOfScrimmageY) * dir <= PI_DOWNFIELD_YD) return;
  const ballAway = Math.hypot(p.ball.pos2.x - rec.pos2.x, p.ball.pos2.y - rec.pos2.y);
  if (ballAway < PI_PRE_ARRIVAL_YD) return;

  const speed = PENALTY.dpiClosingSpeedYdPerSec;

  // Defensive: a defender who has given up on the ball and gone through the man.
  for (let i = 0; i < p.players.length; i++) {
    const d = p.players[i];
    if (d === undefined || d.team === offense || d.anim === 'down') continue;
    if (d.mind['cvPlayBall'] !== 0 && d.mind['cvPlayBall'] !== undefined) continue;
    if (!within(d, rec, PI_CONTACT_RADIUS_YD)) continue;
    if (closingSpeed(d, rec) <= speed) continue;
    e.piChecked = true;
    if (!rng.chance(DPI_ON_CONTACT * PENALTY.frequency)) return;
    pushFlag(p, {
      kind: 'dpi', team: d.team, playerIdx: i, spotY: rec.pos2.y, preSnap: false,
    }, s.tick, events);
    return;
  }

  // Offensive: a rub/pick run into a defender by someone other than the target.
  for (let i = 0; i < p.players.length; i++) {
    const o = p.players[i];
    if (o === undefined || o.team !== offense || o.anim === 'down') continue;
    if (i === targetIdx || i === e.lastPasserIdx) continue;
    if ((o.pos2.y - p.lineOfScrimmageY) * dir <= PI_DOWNFIELD_YD) continue;
    for (let j = 0; j < p.players.length; j++) {
      const v = p.players[j];
      if (v === undefined || v.team === offense || v.anim === 'down') continue;
      if (!within(v, rec, OPI_VICTIM_NEAR_TARGET_YD)) continue;
      if (!within(o, v, PI_CONTACT_RADIUS_YD)) continue;
      if (closingSpeed(o, v) <= speed) continue;
      e.piChecked = true;
      if (!rng.chance(PENALTY.opiOnPickContact * PENALTY.frequency)) return;
      pushFlag(p, {
        kind: 'opi', team: o.team, playerIdx: i, spotY: o.pos2.y, preSnap: false,
      }, s.tick, events);
      return;
    }
  }
}

/** Line to gain implied by a state, for prePlay bookkeeping. */
export function currentLineToGain(s: GameState): number {
  return lineToGainY(s.ballOnY, s.toGo, s.attackDir[s.possession]);
}
