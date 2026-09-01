// Fixed-timestep driver. The ONLY place in the codebase that touches
// performance.now / requestAnimationFrame: everything downstream advances in
// whole TICK_DT steps and receives an interpolation alpha for rendering.

import { TICK_DT } from '../sim/constants';

/** What the loop drives — GameSession implements this. */
export interface LoopTarget {
  stepOneTick(): void;
  /** `alpha` in [0,1) between the last two ticks; `frameDtSec` is real time. */
  render(alpha: number, frameDtSec: number): void;
}

/** Tab-restore spiral guard: never simulate more than this per frame. */
export const MAX_FRAME_SEC = 0.25;

/** Hard cap on catch-up steps so a slow machine degrades instead of locking. */
const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_SEC / TICK_DT);

export interface GameLoopOptions {
  now?: () => number;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function defaultRequestFrame(cb: (t: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(defaultNow()), 16) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  private handle: number | null = null;
  private readonly now: () => number;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  constructor(private readonly target: LoopTarget, opts: GameLoopOptions = {}) {
    this.now = opts.now ?? defaultNow;
    this.requestFrame = opts.requestFrame ?? defaultRequestFrame;
    this.cancelFrame = opts.cancelFrame ?? defaultCancelFrame;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Accumulator remainder in seconds (debug / tests). */
  get accumulator(): number {
    return this.acc;
  }

  start(): void {
    if (this.handle !== null) return;
    this.last = this.now();
    this.acc = 0;
    this.handle = this.requestFrame(this.frame);
  }

  stop(): void {
    if (this.handle === null) return;
    this.cancelFrame(this.handle);
    this.handle = null;
  }

  /**
   * Advance by a real-time delta. Returns the number of sim ticks stepped.
   * Split out from `frame` so headless tests can drive the loop without RAF.
   */
  advance(dtSec: number): number {
    this.acc += Math.min(Math.max(dtSec, 0), MAX_FRAME_SEC);
    let steps = 0;
    while (this.acc >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
      this.target.stepOneTick();
      this.acc -= TICK_DT;
      steps++;
    }
    // Bled the step cap dry: drop the backlog rather than spiral next frame.
    if (this.acc >= TICK_DT) this.acc = 0;
    return steps;
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), MAX_FRAME_SEC);
    this.last = now;
    this.advance(dt);
    this.target.render(this.acc / TICK_DT, dt);
    if (this.handle !== null) this.handle = this.requestFrame(this.frame);
  };
}
