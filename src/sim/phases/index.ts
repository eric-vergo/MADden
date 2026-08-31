// Phase handler registry. Each GamePhase has one handler module; handlers
// mutate GameState (including state.phase for transitions) and append events.
// Phase 0 ships stubs; workstream S1 replaces them with real logic, one file
// per phase to keep parallel agents conflict-free.

import { GamePhase, type GameState } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';

export type PhaseHandler = (
  state: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
) => void;

function stub(_state: GameState, _input: TickInput, _rng: RngSet, _events: SimEvent[]): void {
  // Phase 0 placeholder — replaced by real handlers in workstream S1.
}

export const PHASE_HANDLERS: Record<GamePhase, PhaseHandler> = {
  [GamePhase.COIN_TOSS]: stub,
  [GamePhase.PLAY_CALL]: stub,
  [GamePhase.PRE_SNAP]: stub,
  [GamePhase.PLAY_LIVE]: stub,
  [GamePhase.PLAY_DEAD]: stub,
  [GamePhase.PENALTY_DECISION]: stub,
  [GamePhase.POINT_AFTER_CHOICE]: stub,
  [GamePhase.QUARTER_BREAK]: stub,
  [GamePhase.HALFTIME]: stub,
  [GamePhase.OVERTIME_TOSS]: stub,
  [GamePhase.GAME_OVER]: stub,
};
