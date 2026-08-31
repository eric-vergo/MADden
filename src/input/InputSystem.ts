// Per-tick sampling: drains the key queue, resolves codes to GameActions in
// the active context, and produces the InputFrame the sim consumes.
//
// Edge semantics
// - `pressed` / `released` are lossless: a key tapped and released between two
//   samples reports both edges in the same frame.
// - `held` is the physical state at the END of the window, so that same tap is
//   NOT held (consumers detect taps via `pressed`).
// - Two codes bound to one action (arrows + WASD) are ref-counted: one pressed
//   edge on the first down, one released edge when the last one comes up.
// - heldTicks(action) counts samples the action has been held, and survives one
//   extra frame at release so a release handler can tell a tap (0) from a hold
//   (>= PASS.bulletHoldTicks) — the bullet-pass check.

import { GameAction, EMPTY_INPUT_FRAME, type InputFrame, type Vec2 } from '../sim/types';
import { norm } from '../sim/vec';
import type { BindingOverrides, Bindings, InputContext } from './types';
import { ALL_ACTIONS, allBoundCodes, merge, resolve } from './Bindings';
import type { KeyEvent } from './Keyboard';

/** What InputSystem needs from a Keyboard (tests pass a stub queue). */
export interface KeyQueue {
  drain(): readonly KeyEvent[];
  setCapturedCodes?(codes: readonly string[]): void;
}

export class InputSystem {
  private readonly source: KeyQueue;
  private effective: Bindings;
  private readonly downCodes = new Set<string>();
  /** Number of currently-down codes mapped to each action. */
  private readonly counts = new Map<GameAction, number>();
  private readonly ticks = new Map<GameAction, number>();
  private lastContext: InputContext | null = null;
  private lastFrame: InputFrame = EMPTY_INPUT_FRAME;

  constructor(source: KeyQueue, overrides?: BindingOverrides) {
    this.source = source;
    this.effective = merge(overrides);
    this.source.setCapturedCodes?.(allBoundCodes(this.effective));
  }

  get bindings(): Bindings {
    return this.effective;
  }

  get context(): InputContext | null {
    return this.lastContext;
  }

  /** Last frame produced by sample() — for renderers/HUD, never re-sampled. */
  get frame(): InputFrame {
    return this.lastFrame;
  }

  /** Apply remapped bindings (from settings). Held state is left untouched. */
  setOverrides(overrides?: BindingOverrides): void {
    this.effective = merge(overrides);
    this.source.setCapturedCodes?.(allBoundCodes(this.effective));
  }

  /** Ticks the action has been held; valid on the release frame too. */
  heldTicks(action: GameAction): number {
    return this.ticks.get(action) ?? 0;
  }

  /** Drop all key state and pending events (pause, session teardown, blur). */
  reset(): void {
    this.source.drain();
    this.downCodes.clear();
    this.counts.clear();
    this.ticks.clear();
    this.lastContext = null;
    this.lastFrame = EMPTY_INPUT_FRAME;
  }

  sample(context: InputContext): InputFrame {
    const events = this.source.drain();
    // A context change re-reads the physical keys under the new map; edges from
    // the old context are dropped so a carried-over hold can never fire an
    // action (e.g. Space held through PRE_SNAP_OFF -> QB_PASSING pump fake).
    const switched = this.lastContext !== null && this.lastContext !== context;
    const pressed = new Set<GameAction>();
    const released = new Set<GameAction>();

    for (const ev of events) {
      if (ev.down) {
        if (this.downCodes.has(ev.code)) continue;
        this.downCodes.add(ev.code);
        if (switched) continue;
        const action = resolve(this.effective, context, ev.code);
        if (action === undefined) continue;
        const n = this.counts.get(action) ?? 0;
        this.counts.set(action, n + 1);
        if (n === 0) pressed.add(action);
      } else {
        if (!this.downCodes.delete(ev.code)) continue;
        if (switched) continue;
        const action = resolve(this.effective, context, ev.code);
        if (action === undefined) continue;
        const n = this.counts.get(action) ?? 0;
        if (n === 0) continue;
        this.counts.set(action, n - 1);
        if (n === 1) released.add(action);
      }
    }

    if (switched) {
      this.counts.clear();
      this.ticks.clear();
      for (const code of [...this.downCodes].sort()) {
        const action = resolve(this.effective, context, code);
        if (action === undefined) continue;
        this.counts.set(action, (this.counts.get(action) ?? 0) + 1);
      }
    }

    const held = new Set<GameAction>();
    for (const action of ALL_ACTIONS) {
      if ((this.counts.get(action) ?? 0) > 0) {
        held.add(action);
        this.ticks.set(action, (this.ticks.get(action) ?? 0) + 1);
      } else if (!released.has(action)) {
        this.ticks.set(action, 0);
      }
      // Released this frame: keep the accumulated duration one more frame.
    }

    this.lastContext = context;
    this.lastFrame = { held, pressed, released, move: moveVector(held) };
    return this.lastFrame;
  }
}

/**
 * Directional actions -> unit vector. +y is "up" (upfield in the camera's
 * orientation); callers rotate by the offense's attack direction.
 * Opposite directions cancel; diagonals are normalized to length 1.
 */
function moveVector(held: ReadonlySet<GameAction>): Vec2 {
  let x = 0;
  let y = 0;
  if (held.has(GameAction.Right)) x += 1;
  if (held.has(GameAction.Left)) x -= 1;
  if (held.has(GameAction.Up)) y += 1;
  if (held.has(GameAction.Down)) y -= 1;
  return norm({ x, y });
}
