// ★ FROZEN CONTRACT — SimEvent (sim → presentation/stats/replay/audio) and
// SimCommand (UI → sim discrete choices). Append-only after Phase 0.

import type {
  DeadReason, GamePhase, InputFrame, PenaltyFlag, PenaltyKind, TeamSide,
} from './types';
import { EMPTY_INPUT_FRAME } from './types';

// ---------------------------------------------------------------------------
// Events — emitted by GameSim.tick(). Every subscriber (stats, HUD, ticker,
// replay trigger, AudioDirector) reads this one stream.
// ---------------------------------------------------------------------------

export type BigPlayReason =
  | 'touchdown' | 'turnover' | 'sack' | 'longGain' | 'returnTd' | 'gameWinner';

export type SimEvent =
  | { type: 'PHASE_CHANGE'; tick: number; from: GamePhase; to: GamePhase }
  | { type: 'COIN_TOSS_RESULT'; tick: number; winner: TeamSide; receiving: TeamSide; overtime: boolean }
  | { type: 'PLAYS_SELECTED'; tick: number; offensePlayId: string; defensePlayId: string }
  | { type: 'SNAP'; tick: number }
  | { type: 'HANDOFF'; tick: number; carrierIdx: number }
  | { type: 'PITCH'; tick: number; carrierIdx: number }
  | { type: 'PASS_THROWN'; tick: number; passerIdx: number; targetIdx: number; bullet: boolean; airYds: number }
  | { type: 'PASS_TIPPED'; tick: number; byIdx: number }
  | { type: 'CATCH'; tick: number; receiverIdx: number; contested: boolean }
  | { type: 'DROP'; tick: number; receiverIdx: number }
  | { type: 'INCOMPLETE'; tick: number; targetIdx: number | null; throwaway: boolean }
  | { type: 'INTERCEPTION'; tick: number; defenderIdx: number }
  | { type: 'SACK'; tick: number; tacklerIdx: number; qbIdx: number; yards: number }
  | { type: 'TACKLE_ATTEMPT'; tick: number; tacklerIdx: number; carrierIdx: number }
  | { type: 'TACKLE'; tick: number; tacklerIdx: number; carrierIdx: number; bigHit: boolean; assistIdx: number | null }
  | { type: 'TACKLE_BROKEN'; tick: number; tacklerIdx: number; carrierIdx: number; move: string | null }
  | { type: 'FUMBLE'; tick: number; carrierIdx: number; forcedByIdx: number | null }
  | { type: 'FUMBLE_RECOVERED'; tick: number; recovererIdx: number; team: TeamSide }
  | { type: 'OUT_OF_BOUNDS'; tick: number; carrierIdx: number | null }
  | { type: 'FIRST_DOWN'; tick: number; team: TeamSide }
  | { type: 'TURNOVER_ON_DOWNS'; tick: number; team: TeamSide }
  | { type: 'TOUCHDOWN'; tick: number; team: TeamSide; scorerIdx: number | null }
  | { type: 'SAFETY'; tick: number; scoringTeam: TeamSide }
  | { type: 'KICK_LAUNCHED'; tick: number; style: 'kickoff' | 'punt' | 'placekick'; kickerIdx: number; power01: number; accuracy01: number }
  | { type: 'FIELD_GOAL_RESULT'; tick: number; team: TeamSide; good: boolean; distanceYds: number; missSide: 'left' | 'right' | 'short' | null }
  | { type: 'XP_RESULT'; tick: number; team: TeamSide; good: boolean }
  | { type: 'TWO_POINT_RESULT'; tick: number; team: TeamSide; good: boolean }
  | { type: 'KICK_BLOCKED'; tick: number; blockerIdx: number }
  | { type: 'TOUCHBACK'; tick: number; team: TeamSide }
  | { type: 'FAIR_CATCH'; tick: number; returnerIdx: number }
  | { type: 'PUNT_DOWNED'; tick: number; atY: number }
  | { type: 'FLAG'; tick: number; flag: PenaltyFlag }
  | { type: 'PENALTY_ENFORCED'; tick: number; kind: PenaltyKind; team: TeamSide; yards: number }
  | { type: 'PENALTY_DECLINED'; tick: number; kind: PenaltyKind }
  | { type: 'WHISTLE'; tick: number; reason: DeadReason }
  | {
      // Per-play summary — the ticker, stats, and play log build from this.
      type: 'PLAY_RESULT';
      tick: number;
      offense: TeamSide;
      playType: 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike'
        | 'punt' | 'fieldGoal' | 'extraPoint' | 'twoPoint' | 'kickoff' | 'penaltyOnly';
      yards: number;
      carrierIdx: number | null;
      passerIdx: number | null;
      targetIdx: number | null;
      tacklerIdx: number | null;
      touchdown: boolean;
      turnover: 'int' | 'fumble' | 'downs' | null;
      deadReason: DeadReason;
    }
  | { type: 'BIG_PLAY'; tick: number; reason: BigPlayReason }
  | { type: 'TIMEOUT'; tick: number; team: TeamSide; remaining: number }
  | { type: 'TWO_MINUTE_WARNING'; tick: number; half: 1 | 2 }
  | { type: 'PLAY_CLOCK_WARNING'; tick: number; secLeft: number }
  | { type: 'QUARTER_END'; tick: number; quarter: number }
  | { type: 'HALFTIME'; tick: number }
  | { type: 'OVERTIME_START'; tick: number }
  | { type: 'GAME_OVER'; tick: number; finalScore: [number, number] }
  | { type: 'CONTROL_CHANGED'; tick: number; controlledIdx: number };

export type SimEventType = SimEvent['type'];

// ---------------------------------------------------------------------------
// Commands — discrete choices delivered to the sim inside TickInput.
// ---------------------------------------------------------------------------

export type SimCommand =
  | { type: 'COIN_TOSS_CHOICE'; team: TeamSide; choice: 'receive' | 'kick' }
  | { type: 'SELECT_PLAY'; team: TeamSide; side: 'offense' | 'defense'; playId: string }
  | { type: 'TIMEOUT'; team: TeamSide }
  | { type: 'ACCEPT_PENALTY' }
  | { type: 'DECLINE_PENALTY' }
  | { type: 'CHOOSE_PAT'; choice: 'xp' | 'two' }
  | { type: 'CONTINUE' } // advance through QUARTER_BREAK / HALFTIME / GAME_OVER confirm
  | { type: 'SWITCH_CONTROLLED'; playerIdx: number }
  | { type: 'RETURN_DECISION'; choice: 'return' | 'kneel' }; // kick in the end zone

export interface TickInput {
  frame: InputFrame;
  commands: SimCommand[];
}

export function emptyTickInput(): TickInput {
  return { frame: EMPTY_INPUT_FRAME, commands: [] };
}
