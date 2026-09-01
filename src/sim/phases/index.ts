// Phase handler registry. Each GamePhase has one handler module; handlers
// mutate GameState (including state.phase for transitions) and append events.

import { GamePhase, type GameState } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { coinTossPhase } from './coinToss';
import { playCallPhase } from './playCall';
import { preSnapPhase } from './preSnap';
import { playLivePhase } from './playLive';
import { playDeadPhase } from './playDead';
import {
  gameOverPhase, halftimePhase, overtimeTossPhase, penaltyDecisionPhase,
  pointAfterPhase, quarterBreakPhase,
} from './breaks';

export type PhaseHandler = (
  state: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
) => void;

export const PHASE_HANDLERS: Record<GamePhase, PhaseHandler> = {
  [GamePhase.COIN_TOSS]: coinTossPhase,
  [GamePhase.PLAY_CALL]: playCallPhase,
  [GamePhase.PRE_SNAP]: preSnapPhase,
  [GamePhase.PLAY_LIVE]: playLivePhase,
  [GamePhase.PLAY_DEAD]: playDeadPhase,
  [GamePhase.PENALTY_DECISION]: penaltyDecisionPhase,
  [GamePhase.POINT_AFTER_CHOICE]: pointAfterPhase,
  [GamePhase.QUARTER_BREAK]: quarterBreakPhase,
  [GamePhase.HALFTIME]: halftimePhase,
  [GamePhase.OVERTIME_TOSS]: overtimeTossPhase,
  [GamePhase.GAME_OVER]: gameOverPhase,
};
