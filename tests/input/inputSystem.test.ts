import { describe, expect, it } from 'vitest';
import { GameAction } from '../../src/sim/types';
import { InputContext } from '../../src/input/types';
import { InputSystem } from '../../src/input/InputSystem';
import { makeRig } from './fakes';

describe('edge detection', () => {
  it('reports pressed AND released in the same frame for a tap inside one window', () => {
    const { target, input } = makeRig();
    target.keydown('Space');
    target.keyup('Space');

    const f = input.sample(InputContext.PRE_SNAP_OFF);
    expect([...f.pressed]).toEqual([GameAction.Snap]);
    expect([...f.released]).toEqual([GameAction.Snap]);
    // `held` is the physical state at the end of the window: the key is up.
    expect(f.held.has(GameAction.Snap)).toBe(false);
    expect(input.heldTicks(GameAction.Snap)).toBe(0);

    const next = input.sample(InputContext.PRE_SNAP_OFF);
    expect(next.pressed.size).toBe(0);
    expect(next.released.size).toBe(0);
  });

  it('does not lose a second tap of the same key in one window', () => {
    const { target, input } = makeRig();
    target.keydown('KeyH');
    target.keyup('KeyH');
    target.keydown('KeyH');
    const f = input.sample(InputContext.PRE_SNAP_OFF);
    expect(f.pressed.has(GameAction.HardCount)).toBe(true);
    expect(f.released.has(GameAction.HardCount)).toBe(true);
    // Still down at the end of the window.
    expect(f.held.has(GameAction.HardCount)).toBe(true);
  });

  it('tracks held ticks across frames and keeps the duration on the release frame', () => {
    const { target, input } = makeRig();
    target.keydown('Digit1');

    const f1 = input.sample(InputContext.QB_PASSING);
    expect(f1.pressed.has(GameAction.Throw1)).toBe(true);
    expect(f1.held.has(GameAction.Throw1)).toBe(true);
    expect(input.heldTicks(GameAction.Throw1)).toBe(1);

    const f2 = input.sample(InputContext.QB_PASSING);
    expect(f2.pressed.size).toBe(0);
    expect(f2.held.has(GameAction.Throw1)).toBe(true);
    expect(input.heldTicks(GameAction.Throw1)).toBe(2);

    for (let i = 0; i < 10; i++) input.sample(InputContext.QB_PASSING);
    expect(input.heldTicks(GameAction.Throw1)).toBe(12); // bullet threshold

    target.keyup('Digit1');
    const rel = input.sample(InputContext.QB_PASSING);
    expect(rel.released.has(GameAction.Throw1)).toBe(true);
    expect(rel.held.has(GameAction.Throw1)).toBe(false);
    // Duration survives the release frame so the throw can be classified.
    expect(input.heldTicks(GameAction.Throw1)).toBe(12);

    input.sample(InputContext.QB_PASSING);
    expect(input.heldTicks(GameAction.Throw1)).toBe(0);
  });

  it('ref-counts two codes bound to one action', () => {
    const { target, input } = makeRig();
    target.keydown('KeyW');
    const f1 = input.sample(InputContext.MENU);
    expect(f1.pressed.has(GameAction.Up)).toBe(true);

    target.keydown('ArrowUp');
    const f2 = input.sample(InputContext.MENU);
    expect(f2.pressed.has(GameAction.Up)).toBe(false); // already active
    expect(f2.held.has(GameAction.Up)).toBe(true);

    target.keyup('KeyW');
    const f3 = input.sample(InputContext.MENU);
    expect(f3.released.has(GameAction.Up)).toBe(false); // ArrowUp still down
    expect(f3.held.has(GameAction.Up)).toBe(true);

    target.keyup('ArrowUp');
    const f4 = input.sample(InputContext.MENU);
    expect(f4.released.has(GameAction.Up)).toBe(true);
    expect(f4.held.has(GameAction.Up)).toBe(false);
  });
});

describe('context resolution', () => {
  it('falls through to GLOBAL for codes the context does not bind', () => {
    const { target, input } = makeRig();
    target.keydown('Enter');
    target.keydown('KeyW');
    const f = input.sample(InputContext.BALL_CARRIER);
    expect(f.pressed.has(GameAction.Confirm)).toBe(true);
    expect(f.pressed.has(GameAction.Up)).toBe(true);
  });

  it('prefers the context binding over GLOBAL', () => {
    const menu = makeRig();
    menu.target.keydown('Escape');
    expect(menu.input.sample(InputContext.MENU).pressed.has(GameAction.Back)).toBe(true);

    const live = makeRig();
    live.target.keydown('Escape');
    const f = live.input.sample(InputContext.DEFENSE);
    expect(f.pressed.has(GameAction.Pause)).toBe(true);
    expect(f.pressed.has(GameAction.Back)).toBe(false);
  });

  it('maps Tab to SwitchPlayer on defense but to nothing in a menu', () => {
    const def = makeRig();
    def.target.keydown('Tab');
    expect(def.input.sample(InputContext.DEFENSE).pressed.has(GameAction.SwitchPlayer)).toBe(true);

    const menu = makeRig();
    menu.target.keydown('Tab');
    const f = menu.input.sample(InputContext.MENU);
    expect(f.pressed.size).toBe(0);
    expect(f.held.size).toBe(0);
  });

  it('accepts WASD and the arrow keys interchangeably', () => {
    for (const [code, action] of [
      ['KeyW', GameAction.Up], ['ArrowUp', GameAction.Up],
      ['KeyS', GameAction.Down], ['ArrowDown', GameAction.Down],
      ['KeyA', GameAction.Left], ['ArrowLeft', GameAction.Left],
      ['KeyD', GameAction.Right], ['ArrowRight', GameAction.Right],
    ] as const) {
      const rig = makeRig();
      rig.target.keydown(code);
      expect(rig.input.sample(InputContext.QB_PASSING).held.has(action), code).toBe(true);
    }
  });

  it('clears edges when the context changes and re-reads held keys', () => {
    const { target, input } = makeRig();
    target.keydown('Space');
    const snap = input.sample(InputContext.PRE_SNAP_OFF);
    expect(snap.pressed.has(GameAction.Snap)).toBe(true);
    expect(input.heldTicks(GameAction.Snap)).toBe(1);

    // Ball is snapped: Space is still physically down but now means PumpFake.
    const passing = input.sample(InputContext.QB_PASSING);
    expect(passing.pressed.size).toBe(0); // no spurious pump fake
    expect(passing.released.size).toBe(0);
    expect(passing.held.has(GameAction.PumpFake)).toBe(true);
    expect(input.heldTicks(GameAction.PumpFake)).toBe(1);
    expect(input.heldTicks(GameAction.Snap)).toBe(0);

    // Releasing now produces exactly one released edge in the new context.
    target.keyup('Space');
    const up = input.sample(InputContext.QB_PASSING);
    expect([...up.released]).toEqual([GameAction.PumpFake]);
  });

  it('drops old-context edges queued in the window the context changed', () => {
    const { target, input } = makeRig();
    input.sample(InputContext.PRE_SNAP_OFF);
    target.keydown('KeyH'); // hard count, meaningless once the play is live
    const f = input.sample(InputContext.QB_PASSING);
    expect(f.pressed.size).toBe(0);
    expect(f.held.size).toBe(0);
    // Physical state is still tracked: the later keyup is not mistaken for a press.
    target.keyup('KeyH');
    expect(input.sample(InputContext.QB_PASSING).released.size).toBe(0);
  });

  it('drops an action that is unbound in the new context without firing a release', () => {
    const { target, input } = makeRig();
    target.keydown('Digit1');
    expect(input.sample(InputContext.QB_PASSING).held.has(GameAction.Throw1)).toBe(true);
    // QB crosses the LOS mid-hold.
    const carrier = input.sample(InputContext.BALL_CARRIER);
    expect(carrier.held.has(GameAction.Throw1)).toBe(false);
    expect(carrier.released.size).toBe(0);
    target.keyup('Digit1');
    expect(input.sample(InputContext.BALL_CARRIER).released.size).toBe(0);
  });
});

describe('remapping', () => {
  it('lets a user override beat the default binding', () => {
    const { target, input } = makeRig({
      [InputContext.BALL_CARRIER]: { KeyJ: GameAction.Spin, KeyZ: GameAction.Juke },
    });
    target.keydown('KeyJ');
    target.keydown('KeyZ');
    const f = input.sample(InputContext.BALL_CARRIER);
    expect(f.pressed.has(GameAction.Spin)).toBe(true);
    expect(f.pressed.has(GameAction.Juke)).toBe(true);
    expect(f.held.has(GameAction.Juke)).toBe(true);
  });

  it('applies overrides swapped in at runtime', () => {
    const { target, input } = makeRig();
    input.setOverrides({ GLOBAL: { KeyZ: GameAction.Confirm } });
    target.keydown('KeyZ');
    expect(input.sample(InputContext.MENU).pressed.has(GameAction.Confirm)).toBe(true);
  });

  it('pushes the captured-code set down to the keyboard', () => {
    const { target, keyboard, input } = makeRig();
    void input;
    target.keydown('Space'); // bound by default => default prevented
    expect(target.prevented).toEqual(['Space']);
    expect(keyboard.isDown('Space')).toBe(true);
  });
});

describe('move vector', () => {
  const cases: Array<[string[], { x: number; y: number }]> = [
    [['ArrowUp'], { x: 0, y: 1 }],
    [['ArrowDown'], { x: 0, y: -1 }],
    [['ArrowLeft'], { x: -1, y: 0 }],
    [['ArrowRight'], { x: 1, y: 0 }],
    [['ArrowUp', 'ArrowRight'], { x: Math.SQRT1_2, y: Math.SQRT1_2 }],
    [['KeyS', 'KeyA'], { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }],
    [['ArrowLeft', 'ArrowRight'], { x: 0, y: 0 }],
    [['ArrowUp', 'ArrowDown', 'ArrowLeft'], { x: -1, y: 0 }],
    [[], { x: 0, y: 0 }],
  ];

  for (const [codes, want] of cases) {
    it(`normalizes ${codes.join('+') || 'nothing'}`, () => {
      const { target, input } = makeRig();
      for (const c of codes) target.keydown(c);
      const move = input.sample(InputContext.BALL_CARRIER).move;
      expect(move.x).toBeCloseTo(want.x, 10);
      expect(move.y).toBeCloseTo(want.y, 10);
      const mag = Math.hypot(move.x, move.y);
      expect(mag).toBeLessThanOrEqual(1 + 1e-12);
      if (want.x !== 0 || want.y !== 0) expect(mag).toBeCloseTo(1, 10);
    });
  }

  it('is zero again once the keys come up', () => {
    const { target, input } = makeRig();
    target.keydown('KeyD');
    expect(input.sample(InputContext.BALL_CARRIER).move.x).toBe(1);
    target.keyup('KeyD');
    expect(input.sample(InputContext.BALL_CARRIER).move).toEqual({ x: 0, y: 0 });
  });
});

describe('focus loss and reset', () => {
  it('releases everything when the window blurs', () => {
    const { target, input } = makeRig();
    target.keydown('ShiftLeft');
    target.keydown('KeyW');
    const live = input.sample(InputContext.BALL_CARRIER);
    expect(live.held.has(GameAction.Sprint)).toBe(true);
    expect(live.held.has(GameAction.Up)).toBe(true);

    target.blur();
    const after = input.sample(InputContext.BALL_CARRIER);
    expect(after.held.size).toBe(0);
    expect(after.released.has(GameAction.Sprint)).toBe(true);
    expect(after.released.has(GameAction.Up)).toBe(true);
    expect(after.move).toEqual({ x: 0, y: 0 });

    const idle = input.sample(InputContext.BALL_CARRIER);
    expect(idle.released.size).toBe(0);
    expect(idle.held.size).toBe(0);
    expect(input.heldTicks(GameAction.Sprint)).toBe(0);
  });

  it('does not resurrect held actions after a blur when keys come back up', () => {
    const { target, input } = makeRig();
    target.keydown('ShiftLeft');
    input.sample(InputContext.DEFENSE);
    target.blur();
    input.sample(InputContext.DEFENSE);
    target.keyup('ShiftLeft'); // real keyup arrives after the synthetic release
    const f = input.sample(InputContext.DEFENSE);
    expect(f.released.size).toBe(0);
    expect(f.held.size).toBe(0);
  });

  it('reset() drops queued events and all held state', () => {
    const { target, input } = makeRig();
    target.keydown('ShiftLeft');
    input.sample(InputContext.DEFENSE);
    target.keydown('KeyW');
    input.reset();
    expect(input.frame.held.size).toBe(0);
    const f = input.sample(InputContext.DEFENSE);
    expect(f.held.size).toBe(0);
    expect(f.pressed.size).toBe(0);
    expect(input.context).toBe(InputContext.DEFENSE);
  });
});

describe('frame shape', () => {
  it('produces a fresh frame object per sample', () => {
    const { input } = makeRig();
    const a = input.sample(InputContext.MENU);
    const b = input.sample(InputContext.MENU);
    expect(a).not.toBe(b);
    expect(input.frame).toBe(b);
  });

  it('works with a bare queue stub (no keyboard)', () => {
    const queue = {
      events: [{ code: 'Space', down: true, tMs: 0 }],
      drain(): readonly { code: string; down: boolean; tMs: number }[] {
        const out = this.events;
        this.events = [];
        return out;
      },
    };
    const input = new InputSystem(queue);
    expect(input.sample(InputContext.KICK_METER).pressed.has(GameAction.MeterPress)).toBe(true);
  });
});
