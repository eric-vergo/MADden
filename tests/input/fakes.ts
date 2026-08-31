// Test doubles for the input layer: an injectable EventTarget stand-in and a
// deterministic clock. No DOM required.

import { Keyboard, type KeyboardOptions } from '../../src/input/Keyboard';
import { InputSystem } from '../../src/input/InputSystem';
import type { BindingOverrides } from '../../src/input/types';

export class FakeEventTarget {
  private readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
  /** Codes whose preventDefault() was called, in order. */
  readonly prevented: string[] = [];
  /** Milliseconds handed to key events; advance it explicitly. */
  tMs = 0;

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type);
    if (list) list.push(listener);
    else this.listeners.set(type, [listener]);
  }

  removeEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(listener);
    if (i >= 0) list.splice(i, 1);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  fire(type: string, ev: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(ev);
  }

  keydown(code: string, opts?: { repeat?: boolean; tMs?: number }): void {
    this.fire('keydown', {
      code,
      repeat: opts?.repeat ?? false,
      timeStamp: opts?.tMs ?? this.tMs,
      preventDefault: () => this.prevented.push(code),
    });
  }

  keyup(code: string, opts?: { tMs?: number }): void {
    this.fire('keyup', {
      code,
      timeStamp: opts?.tMs ?? this.tMs,
      preventDefault: () => this.prevented.push(code),
    });
  }

  blur(): void {
    this.fire('blur', {});
  }
}

export interface Rig {
  target: FakeEventTarget;
  keyboard: Keyboard;
  input: InputSystem;
}

export function makeRig(overrides?: BindingOverrides, opts?: KeyboardOptions): Rig {
  const target = new FakeEventTarget();
  const keyboard = new Keyboard(target, { now: () => target.tMs, ...opts });
  const input = new InputSystem(keyboard, overrides);
  return { target, keyboard, input };
}
