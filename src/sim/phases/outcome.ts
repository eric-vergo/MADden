// The live play mutates one PlayOutcome as things happen to it; PLAY_DEAD
// reads that single record instead of re-deriving what went on.

import type { GameState, OffPlayType, PlayState } from '../types';
import { ext, type PlayOutcome, type ResultPlayType } from '../rules/ext';

export function mapPlayType(t: OffPlayType): ResultPlayType {
  switch (t) {
    case 'run': return 'run';
    case 'pass': return 'pass';
    case 'playAction': return 'pass';
    case 'screen': return 'pass';
    case 'kickoff': return 'kickoff';
    case 'punt': return 'punt';
    case 'fieldGoal': return 'fieldGoal';
    case 'extraPoint': return 'extraPoint';
    case 'twoPoint': return 'twoPoint';
    case 'kneel': return 'kneel';
    case 'spike': return 'spike';
    default: return 'run';
  }
}

export function defaultOutcome(s: GameState, p: PlayState): PlayOutcome {
  const e = ext(s);
  return {
    playType: mapPlayType(p.offensePlay.type),
    deadReason: 'tackle',
    spotY: p.lineOfScrimmageY,
    spotX: e.ballOnX,
    yards: 0,
    carrierIdx: null,
    passerIdx: null,
    targetIdx: null,
    tacklerIdx: null,
    touchdown: false,
    turnover: null,
    possessionAfter: e.playOffense,
    changeOfPossession: false,
    safety: false,
    scoreKind: null,
    points: 0,
    nextKind: null,
    completed: false,
    fgDistance: 0,
  };
}

/** The outcome under construction for the live play (never null once snapped). */
export function outcomeOf(s: GameState): PlayOutcome | null {
  return ext(s).outcome;
}
