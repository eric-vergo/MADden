// ★ FROZEN CONTRACT — input-layer types. GameAction and InputFrame live in
// sim/types.ts (the sim consumes them and must stay pure); this file adds the
// DOM-side concepts: contexts and binding maps.

import type { GameAction } from '../sim/types';
export type { GameAction, InputFrame } from '../sim/types';
export { EMPTY_INPUT_FRAME } from '../sim/types';

export enum InputContext {
  MENU = 'MENU',
  PLAY_CALL = 'PLAY_CALL',
  PRE_SNAP_OFF = 'PRE_SNAP_OFF',
  PRE_SNAP_DEF = 'PRE_SNAP_DEF',
  QB_PASSING = 'QB_PASSING',
  BALL_CARRIER = 'BALL_CARRIER',
  DEFENSE = 'DEFENSE',
  KICK_METER = 'KICK_METER',
  RETURN_WAIT = 'RETURN_WAIT', // waiting on a kick in the air (fair catch etc.)
  REPLAY = 'REPLAY',
  PAUSED = 'PAUSED',
}

/** KeyboardEvent.code → action, per context (falls through to GLOBAL). */
export type BindingMap = Partial<Record<string, GameAction>>;
export type Bindings = Record<InputContext | 'GLOBAL', BindingMap>;

/** User remap overrides persisted in settings. */
export type BindingOverrides = Partial<Record<InputContext | 'GLOBAL', BindingMap>>;
