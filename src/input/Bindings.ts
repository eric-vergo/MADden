// Default binding table, user-override merging, and reverse lookup for the
// key-reference screen.
//
// Keys are KeyboardEvent.code values (physical, layout independent) so WASD
// stays WASD on AZERTY. Resolution is per-context with fall-through to GLOBAL:
// a context map entry always wins; a code the context does not list is looked
// up in GLOBAL. Unbinding a code inside a context therefore re-exposes the
// GLOBAL binding (to kill a binding everywhere, override GLOBAL).

import { GameAction } from '../sim/types';
import { InputContext, type BindingMap, type BindingOverrides, type Bindings } from './types';

/** Every binding scope, in a fixed order (determinism: never iterate raw keys). */
export const BINDING_SCOPES: readonly (InputContext | 'GLOBAL')[] = [
  'GLOBAL',
  InputContext.MENU,
  InputContext.PLAY_CALL,
  InputContext.PRE_SNAP_OFF,
  InputContext.PRE_SNAP_DEF,
  InputContext.QB_PASSING,
  InputContext.BALL_CARRIER,
  InputContext.DEFENSE,
  InputContext.KICK_METER,
  InputContext.RETURN_WAIT,
  InputContext.REPLAY,
  InputContext.PAUSED,
];

/** All GameActions in a stable (alphabetical) order — used for frame assembly. */
export const ALL_ACTIONS: readonly GameAction[] = Object.values(GameAction).sort();

export const DEFAULT_BINDINGS: Bindings = {
  // Movement + confirm/back are global so every screen inherits them.
  GLOBAL: {
    ArrowUp: GameAction.Up,
    KeyW: GameAction.Up,
    ArrowDown: GameAction.Down,
    KeyS: GameAction.Down,
    ArrowLeft: GameAction.Left,
    KeyA: GameAction.Left,
    ArrowRight: GameAction.Right,
    KeyD: GameAction.Right,
    Enter: GameAction.Confirm,
    NumpadEnter: GameAction.Confirm,
    Escape: GameAction.Back,
  },

  [InputContext.MENU]: {},

  // Arrows move the cursor (GLOBAL), Q/E page through the play book.
  // Escape stays Back so nested play-book menus can pop a level.
  [InputContext.PLAY_CALL]: {
    KeyQ: GameAction.PageLeft,
    KeyE: GameAction.PageRight,
    KeyT: GameAction.Timeout,
  },

  [InputContext.PRE_SNAP_OFF]: {
    Space: GameAction.Snap,
    KeyH: GameAction.HardCount,
    KeyT: GameAction.Timeout,
    Escape: GameAction.Pause,
  },

  // Tab cycles defenders; Space (Snap) is read here as "grab the defender
  // nearest the LOS" — the frozen GameAction enum has no dedicated member.
  [InputContext.PRE_SNAP_DEF]: {
    Tab: GameAction.SwitchPlayer,
    Space: GameAction.Snap,
    KeyT: GameAction.Timeout,
    Escape: GameAction.Pause,
  },

  // 1-5 throw (tap = lob, hold >= PASS.bulletHoldTicks = bullet).
  [InputContext.QB_PASSING]: {
    Digit1: GameAction.Throw1,
    Digit2: GameAction.Throw2,
    Digit3: GameAction.Throw3,
    Digit4: GameAction.Throw4,
    Digit5: GameAction.Throw5,
    Space: GameAction.PumpFake,
    KeyX: GameAction.ThrowAway,
    Escape: GameAction.Pause,
  },

  [InputContext.BALL_CARRIER]: {
    ShiftLeft: GameAction.Sprint,
    ShiftRight: GameAction.Sprint,
    Space: GameAction.Dive,
    KeyJ: GameAction.Juke,
    KeyK: GameAction.Spin,
    KeyL: GameAction.StiffArm,
    Escape: GameAction.Pause,
  },

  [InputContext.DEFENSE]: {
    ShiftLeft: GameAction.Sprint,
    ShiftRight: GameAction.Sprint,
    Space: GameAction.Dive,
    Tab: GameAction.SwitchPlayer,
    Escape: GameAction.Pause,
  },

  // Left/Right aim comes from GLOBAL; Space is the 3-press meter.
  [InputContext.KICK_METER]: {
    Space: GameAction.MeterPress,
    Escape: GameAction.Pause,
  },

  [InputContext.RETURN_WAIT]: {
    KeyF: GameAction.FairCatch,
    ShiftLeft: GameAction.Sprint,
    ShiftRight: GameAction.Sprint,
    Escape: GameAction.Pause,
  },

  // Esc/Enter skip a replay — both inherited from GLOBAL.
  [InputContext.REPLAY]: {},

  [InputContext.PAUSED]: {},
};

/**
 * Effective bindings = defaults with per-scope overrides applied.
 * An override value of `undefined` removes that code from the scope.
 * The result is a fresh deep-ish copy; mutating it never touches the defaults.
 */
export function merge(overrides?: BindingOverrides): Bindings {
  const out = {} as Bindings;
  for (const scope of BINDING_SCOPES) {
    const map: BindingMap = { ...DEFAULT_BINDINGS[scope] };
    const over = overrides?.[scope];
    if (over) {
      for (const code of Object.keys(over).sort()) {
        const action = over[code];
        if (action === undefined) delete map[code];
        else map[code] = action;
      }
    }
    out[scope] = map;
  }
  return out;
}

/** Context map first, then GLOBAL. Returns undefined for unbound codes. */
export function resolve(
  bindings: Bindings,
  context: InputContext,
  code: string,
): GameAction | undefined {
  const inContext = bindings[context][code];
  if (inContext !== undefined) return inContext;
  return bindings.GLOBAL[code];
}

/** Every code bound in any scope, sorted and de-duplicated. */
export function allBoundCodes(bindings: Bindings): string[] {
  const codes = new Set<string>();
  for (const scope of BINDING_SCOPES) {
    for (const code of Object.keys(bindings[scope])) {
      if (bindings[scope][code] !== undefined) codes.add(code);
    }
  }
  return [...codes].sort();
}

/** Reverse lookup: which codes fire `action` in `context` (sorted). */
export function codesForAction(
  bindings: Bindings,
  context: InputContext,
  action: GameAction,
): string[] {
  const ctxMap = bindings[context];
  const codes = new Set<string>();
  for (const code of Object.keys(ctxMap)) {
    if (ctxMap[code] === action) codes.add(code);
  }
  const global = bindings.GLOBAL;
  for (const code of Object.keys(global)) {
    // A code listed in the context map is shadowed and never falls through.
    if (ctxMap[code] === undefined && global[code] === action) codes.add(code);
  }
  return [...codes].sort();
}

export interface KeyReferenceEntry {
  action: GameAction;
  label: string;
  codes: string[];
  keys: string[]; // display labels, parallel to codes
}

/** Everything the key-reference screen needs for one context, in stable order. */
export function keyReference(bindings: Bindings, context: InputContext): KeyReferenceEntry[] {
  const out: KeyReferenceEntry[] = [];
  for (const action of ALL_ACTIONS) {
    const codes = codesForAction(bindings, context, action);
    if (codes.length === 0) continue;
    out.push({ action, label: ACTION_LABELS[action], codes, keys: codes.map(keyLabel) });
  }
  return out;
}

const KEY_LABELS: Partial<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  Backspace: 'Bksp',
};

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  const named = KEY_LABELS[code];
  if (named !== undefined) return named;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length === 7) return `Num ${code.slice(6)}`;
  return code;
}

export const ACTION_LABELS: Record<GameAction, string> = {
  [GameAction.Up]: 'Up',
  [GameAction.Down]: 'Down',
  [GameAction.Left]: 'Left',
  [GameAction.Right]: 'Right',
  [GameAction.Confirm]: 'Confirm',
  [GameAction.Back]: 'Back',
  [GameAction.Pause]: 'Pause',
  [GameAction.Snap]: 'Snap',
  [GameAction.Sprint]: 'Sprint',
  [GameAction.Dive]: 'Dive',
  [GameAction.Spin]: 'Spin',
  [GameAction.Juke]: 'Juke',
  [GameAction.StiffArm]: 'Stiff arm',
  [GameAction.Throw1]: 'Throw to 1',
  [GameAction.Throw2]: 'Throw to 2',
  [GameAction.Throw3]: 'Throw to 3',
  [GameAction.Throw4]: 'Throw to 4',
  [GameAction.Throw5]: 'Throw to 5',
  [GameAction.ThrowAway]: 'Throw away',
  [GameAction.PumpFake]: 'Pump fake',
  [GameAction.SwitchPlayer]: 'Switch player',
  [GameAction.Timeout]: 'Timeout',
  [GameAction.MeterPress]: 'Kick meter',
  [GameAction.HardCount]: 'Hard count',
  [GameAction.FairCatch]: 'Fair catch',
  [GameAction.PageLeft]: 'Previous page',
  [GameAction.PageRight]: 'Next page',
};
