import { describe, expect, it } from 'vitest';
import { GameAction } from '../../src/sim/types';
import { InputContext, type BindingOverrides } from '../../src/input/types';
import {
  ACTION_LABELS, ALL_ACTIONS, BINDING_SCOPES, DEFAULT_BINDINGS,
  allBoundCodes, codesForAction, keyLabel, keyReference, merge, resolve,
} from '../../src/input/Bindings';

describe('DEFAULT_BINDINGS coverage', () => {
  it('has a map for GLOBAL and every InputContext', () => {
    const scopes = new Set<string>(BINDING_SCOPES);
    expect(scopes.has('GLOBAL')).toBe(true);
    for (const ctx of Object.values(InputContext)) {
      expect(scopes.has(ctx), `scope list missing ${ctx}`).toBe(true);
      expect(DEFAULT_BINDINGS[ctx], `bindings missing ${ctx}`).toBeDefined();
    }
    expect(BINDING_SCOPES.length).toBe(Object.values(InputContext).length + 1);
  });

  it('binds arrows AND WASD to the same directions globally', () => {
    const g = DEFAULT_BINDINGS.GLOBAL;
    expect(g.ArrowUp).toBe(GameAction.Up);
    expect(g.KeyW).toBe(GameAction.Up);
    expect(g.ArrowDown).toBe(GameAction.Down);
    expect(g.KeyS).toBe(GameAction.Down);
    expect(g.ArrowLeft).toBe(GameAction.Left);
    expect(g.KeyA).toBe(GameAction.Left);
    expect(g.ArrowRight).toBe(GameAction.Right);
    expect(g.KeyD).toBe(GameAction.Right);
    expect(g.Enter).toBe(GameAction.Confirm);
    expect(g.Escape).toBe(GameAction.Back);
  });

  it('covers the design-doc table per context', () => {
    const b = DEFAULT_BINDINGS;
    expect(b[InputContext.PLAY_CALL].KeyQ).toBe(GameAction.PageLeft);
    expect(b[InputContext.PLAY_CALL].KeyE).toBe(GameAction.PageRight);
    expect(b[InputContext.PLAY_CALL].KeyT).toBe(GameAction.Timeout);

    expect(b[InputContext.PRE_SNAP_OFF].Space).toBe(GameAction.Snap);
    expect(b[InputContext.PRE_SNAP_OFF].KeyH).toBe(GameAction.HardCount);
    expect(b[InputContext.PRE_SNAP_OFF].KeyT).toBe(GameAction.Timeout);

    expect(b[InputContext.PRE_SNAP_DEF].Tab).toBe(GameAction.SwitchPlayer);
    expect(b[InputContext.PRE_SNAP_DEF].Space).toBe(GameAction.Snap);

    expect(b[InputContext.QB_PASSING].Digit1).toBe(GameAction.Throw1);
    expect(b[InputContext.QB_PASSING].Digit5).toBe(GameAction.Throw5);
    expect(b[InputContext.QB_PASSING].Space).toBe(GameAction.PumpFake);
    expect(b[InputContext.QB_PASSING].KeyX).toBe(GameAction.ThrowAway);

    expect(b[InputContext.BALL_CARRIER].ShiftLeft).toBe(GameAction.Sprint);
    expect(b[InputContext.BALL_CARRIER].Space).toBe(GameAction.Dive);
    expect(b[InputContext.BALL_CARRIER].KeyJ).toBe(GameAction.Juke);
    expect(b[InputContext.BALL_CARRIER].KeyK).toBe(GameAction.Spin);
    expect(b[InputContext.BALL_CARRIER].KeyL).toBe(GameAction.StiffArm);

    expect(b[InputContext.DEFENSE].ShiftLeft).toBe(GameAction.Sprint);
    expect(b[InputContext.DEFENSE].Space).toBe(GameAction.Dive);
    expect(b[InputContext.DEFENSE].Tab).toBe(GameAction.SwitchPlayer);

    expect(b[InputContext.KICK_METER].Space).toBe(GameAction.MeterPress);
    expect(b[InputContext.RETURN_WAIT].KeyF).toBe(GameAction.FairCatch);
  });

  it('leaves Tab unbound in MENU but bound on defense', () => {
    const b = merge();
    expect(resolve(b, InputContext.MENU, 'Tab')).toBeUndefined();
    expect(resolve(b, InputContext.DEFENSE, 'Tab')).toBe(GameAction.SwitchPlayer);
    expect(resolve(b, InputContext.PRE_SNAP_DEF, 'Tab')).toBe(GameAction.SwitchPlayer);
  });
});

describe('resolve fall-through', () => {
  const b = merge();

  it('falls through to GLOBAL for codes the context does not list', () => {
    expect(resolve(b, InputContext.BALL_CARRIER, 'Enter')).toBe(GameAction.Confirm);
    expect(resolve(b, InputContext.QB_PASSING, 'KeyW')).toBe(GameAction.Up);
    expect(resolve(b, InputContext.KICK_METER, 'ArrowLeft')).toBe(GameAction.Left);
  });

  it('lets the context map shadow GLOBAL', () => {
    expect(resolve(b, InputContext.MENU, 'Escape')).toBe(GameAction.Back);
    expect(resolve(b, InputContext.DEFENSE, 'Escape')).toBe(GameAction.Pause);
  });

  it('returns undefined for unbound codes', () => {
    expect(resolve(b, InputContext.MENU, 'KeyZ')).toBeUndefined();
  });
});

describe('merge(overrides)', () => {
  it('equals the defaults when there are no overrides', () => {
    expect(merge()).toEqual(DEFAULT_BINDINGS);
    expect(merge({})).toEqual(DEFAULT_BINDINGS);
  });

  it('copies rather than aliases the defaults', () => {
    const b = merge();
    b[InputContext.DEFENSE].KeyZ = GameAction.Dive;
    expect(DEFAULT_BINDINGS[InputContext.DEFENSE].KeyZ).toBeUndefined();
  });

  it('lets an override win over the default in that context', () => {
    const overrides: BindingOverrides = {
      [InputContext.BALL_CARRIER]: { KeyJ: GameAction.Spin, KeyZ: GameAction.Juke },
    };
    const b = merge(overrides);
    expect(resolve(b, InputContext.BALL_CARRIER, 'KeyJ')).toBe(GameAction.Spin);
    expect(resolve(b, InputContext.BALL_CARRIER, 'KeyZ')).toBe(GameAction.Juke);
    // Other contexts are untouched.
    expect(resolve(b, InputContext.DEFENSE, 'KeyZ')).toBeUndefined();
  });

  it('can override GLOBAL', () => {
    const b = merge({ GLOBAL: { KeyW: GameAction.Down } });
    expect(resolve(b, InputContext.MENU, 'KeyW')).toBe(GameAction.Down);
  });

  it('unbinds a code when the override value is undefined', () => {
    const b = merge({ [InputContext.DEFENSE]: { Escape: undefined } });
    // Removed from the context map, so GLOBAL's Escape shows through again.
    expect(b[InputContext.DEFENSE].Escape).toBeUndefined();
    expect(resolve(b, InputContext.DEFENSE, 'Escape')).toBe(GameAction.Back);
  });
});

describe('reverse lookup', () => {
  const b = merge();

  it('lists every code for an action, sorted, including GLOBAL fall-through', () => {
    expect(codesForAction(b, InputContext.MENU, GameAction.Up)).toEqual(['ArrowUp', 'KeyW']);
    expect(codesForAction(b, InputContext.BALL_CARRIER, GameAction.Sprint))
      .toEqual(['ShiftLeft', 'ShiftRight']);
    expect(codesForAction(b, InputContext.MENU, GameAction.Confirm))
      .toEqual(['Enter', 'NumpadEnter']);
  });

  it('excludes GLOBAL codes shadowed by the context', () => {
    expect(codesForAction(b, InputContext.DEFENSE, GameAction.Back)).toEqual([]);
    expect(codesForAction(b, InputContext.DEFENSE, GameAction.Pause)).toEqual(['Escape']);
    expect(codesForAction(b, InputContext.MENU, GameAction.Back)).toEqual(['Escape']);
  });

  it('builds a key-reference table in stable action order', () => {
    const ref = keyReference(b, InputContext.QB_PASSING);
    const actions = ref.map((e) => e.action);
    expect(actions).toEqual([...actions].sort());
    const throw1 = ref.find((e) => e.action === GameAction.Throw1);
    expect(throw1?.codes).toEqual(['Digit1']);
    expect(throw1?.keys).toEqual(['1']);
    expect(throw1?.label).toBe(ACTION_LABELS[GameAction.Throw1]);
    // Nothing unbound sneaks in.
    expect(ref.every((e) => e.codes.length > 0)).toBe(true);
    expect(ref.some((e) => e.action === GameAction.Juke)).toBe(false);
  });

  it('names every action', () => {
    for (const a of ALL_ACTIONS) expect(ACTION_LABELS[a].length).toBeGreaterThan(0);
    expect(ALL_ACTIONS).toEqual([...ALL_ACTIONS].sort());
  });

  it('collects all bound codes sorted and de-duplicated', () => {
    const codes = allBoundCodes(b);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of ['Space', 'Tab', 'ArrowUp', 'KeyW', 'Digit3', 'Escape', 'ShiftLeft']) {
      expect(codes, `missing ${c}`).toContain(c);
    }
  });

  it('labels keys for display', () => {
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('ShiftRight')).toBe('Shift');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('F13')).toBe('F13');
  });
});
