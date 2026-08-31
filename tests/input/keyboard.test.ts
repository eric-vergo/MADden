import { describe, expect, it } from 'vitest';
import { Keyboard } from '../../src/input/Keyboard';
import { FakeEventTarget } from './fakes';

function makeKeyboard(captured?: string[]): { target: FakeEventTarget; kb: Keyboard } {
  const target = new FakeEventTarget();
  const kb = new Keyboard(target, {
    now: () => target.tMs,
    captured: captured ?? ['Space', 'Tab', 'ArrowUp'],
  });
  return { target, kb };
}

describe('Keyboard queueing', () => {
  it('queues down and up transitions in arrival order with timestamps', () => {
    const { target, kb } = makeKeyboard();
    target.tMs = 100;
    target.keydown('KeyW');
    target.tMs = 180;
    target.keydown('Space');
    target.tMs = 250;
    target.keyup('KeyW');

    expect(kb.drain()).toEqual([
      { code: 'KeyW', down: true, tMs: 100 },
      { code: 'Space', down: true, tMs: 180 },
      { code: 'KeyW', down: false, tMs: 250 },
    ]);
    // Draining clears.
    expect(kb.drain()).toEqual([]);
  });

  it('uses the injected clock when the event carries no timeStamp', () => {
    const target = new FakeEventTarget();
    const kb = new Keyboard(target, { now: () => 42 });
    target.fire('keydown', { code: 'KeyJ', preventDefault: () => {} });
    expect(kb.drain()).toEqual([{ code: 'KeyJ', down: true, tMs: 42 }]);
  });

  it('drops OS auto-repeat and duplicate downs', () => {
    const { target, kb } = makeKeyboard();
    target.keydown('KeyL');
    target.keydown('KeyL', { repeat: true });
    target.keydown('KeyL'); // duplicate without the repeat flag
    expect(kb.drain()).toEqual([{ code: 'KeyL', down: true, tMs: 0 }]);
    expect(kb.isDown('KeyL')).toBe(true);
  });

  it('ignores a keyup for a key it never saw go down', () => {
    const { target, kb } = makeKeyboard();
    target.keyup('KeyK');
    expect(kb.drain()).toEqual([]);
  });

  it('ignores non-keyboard-shaped events', () => {
    const { target, kb } = makeKeyboard();
    target.fire('keydown', null);
    target.fire('keydown', { key: 'w' });
    expect(kb.drain()).toEqual([]);
  });

  it('caps the queue instead of growing without bound', () => {
    const { target, kb } = makeKeyboard();
    for (let i = 0; i < 400; i++) {
      target.keydown('KeyJ');
      target.keyup('KeyJ');
    }
    expect(kb.pending).toBeLessThanOrEqual(512);
    expect(kb.pending).toBeGreaterThan(0);
  });
});

describe('Keyboard preventDefault', () => {
  it('prevents defaults only for captured codes', () => {
    const { target } = makeKeyboard(['Space', 'Tab']);
    target.keydown('Space');
    target.keyup('Space');
    target.keydown('Tab');
    target.keydown('KeyW'); // not captured
    expect(target.prevented).toEqual(['Space', 'Space', 'Tab']);
  });

  it('honours a captured-code update', () => {
    const { target, kb } = makeKeyboard([]);
    target.keydown('Space');
    expect(target.prevented).toEqual([]);
    kb.setCapturedCodes(['Space']);
    target.keyup('Space');
    expect(target.prevented).toEqual(['Space']);
  });

  it('never prevents defaults while inactive', () => {
    const { target, kb } = makeKeyboard(['Space']);
    kb.setActive(false);
    target.keydown('Space');
    expect(target.prevented).toEqual([]);
    expect(kb.drain()).toEqual([]);
  });
});

describe('Keyboard release-all', () => {
  it('releases every held key on blur, in sorted order', () => {
    const { target, kb } = makeKeyboard();
    target.keydown('ShiftLeft');
    target.keydown('ArrowUp');
    target.keydown('KeyD');
    kb.drain();

    target.tMs = 900;
    target.blur();
    expect(kb.drain()).toEqual([
      { code: 'ArrowUp', down: false, tMs: 900 },
      { code: 'KeyD', down: false, tMs: 900 },
      { code: 'ShiftLeft', down: false, tMs: 900 },
    ]);
    expect(kb.isDown('ArrowUp')).toBe(false);
  });

  it('is a no-op on blur with nothing held', () => {
    const { target, kb } = makeKeyboard();
    target.blur();
    expect(kb.drain()).toEqual([]);
  });

  it('releases everything when capture is switched off', () => {
    const { target, kb } = makeKeyboard();
    target.keydown('ShiftLeft');
    kb.drain();
    kb.setActive(false);
    expect(kb.drain()).toEqual([{ code: 'ShiftLeft', down: false, tMs: 0 }]);
    expect(kb.active).toBe(false);
    // Re-arming does not resurrect the old key state.
    kb.setActive(true);
    target.keyup('ShiftLeft');
    expect(kb.drain()).toEqual([]);
  });

  it('does not double-release a key already up', () => {
    const { target, kb } = makeKeyboard();
    target.keydown('Space');
    target.keyup('Space');
    kb.drain();
    target.blur();
    expect(kb.drain()).toEqual([]);
  });
});

describe('Keyboard lifecycle', () => {
  it('subscribes to keydown, keyup and blur and unsubscribes on dispose', () => {
    const { target, kb } = makeKeyboard();
    expect(target.listenerCount('keydown')).toBe(1);
    expect(target.listenerCount('keyup')).toBe(1);
    expect(target.listenerCount('blur')).toBe(1);

    kb.dispose();
    expect(target.listenerCount('keydown')).toBe(0);
    expect(target.listenerCount('keyup')).toBe(0);
    expect(target.listenerCount('blur')).toBe(0);

    target.keydown('Space');
    expect(kb.drain()).toEqual([]);
    kb.dispose(); // idempotent
  });
});
