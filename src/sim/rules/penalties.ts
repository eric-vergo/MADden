// Penalty enforcement spots and the accept/decline EV comparator.
// Both branches are projected as full PenaltyOutcomes so the UI can show them
// and the CPU can pick without re-running any of the play logic.

import type {
  GameState, PenaltyFlag, PenaltyKind, PenaltyOutcome, PendingPenaltyDecision, TeamSide,
} from '../types';
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

/** Line to gain implied by a state, for prePlay bookkeeping. */
export function currentLineToGain(s: GameState): number {
  return lineToGainY(s.ballOnY, s.toGo, s.attackDir[s.possession]);
}
