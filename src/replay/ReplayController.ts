// Playback cursor over one RecordedPlay.
//
// The cursor is measured in FRAMES, not ticks: advance(1) moves it by `speed`
// frames, so 0.5x plays every recorded frame twice. view() hands back the same
// (prev, curr, alpha) triple the live loop feeds Renderer.draw, which is the
// whole point — a replay is drawn by the normal renderer, not a second one.

import type { PlayManifest, TickSnapshot } from '../sim/types';
import type { RecordedPlay } from './ReplayBuffer';

export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Broadcast default: half speed. */
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 0.5;

export function isReplaySpeed(v: number): v is ReplaySpeed {
  return (REPLAY_SPEEDS as readonly number[]).includes(v);
}

/** Next speed in the ring — for a future speed toggle in the replay UI. */
export function nextReplaySpeed(speed: ReplaySpeed): ReplaySpeed {
  const i = REPLAY_SPEEDS.indexOf(speed);
  return REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length] ?? DEFAULT_REPLAY_SPEED;
}

export interface ReplayFrameView {
  prev: TickSnapshot;
  curr: TickSnapshot;
  /** Interpolation factor between prev and curr, in [0, 1). */
  alpha: number;
}

/** Camera focus for one recorded frame: ball, else carrier, else the LOS. */
export function focusYOf(snap: TickSnapshot): number | null {
  if (snap.ball) return snap.ball.y;
  for (const p of snap.players) {
    if (p.hasBall) return p.y;
  }
  return snap.lineOfScrimmageY;
}

export class ReplayController {
  private readonly play: RecordedPlay;
  private cursorPos = 0;
  private speedValue: ReplaySpeed;

  constructor(play: RecordedPlay, speed: ReplaySpeed = DEFAULT_REPLAY_SPEED) {
    this.play = play;
    this.speedValue = speed;
  }

  get manifest(): PlayManifest {
    return this.play.manifest;
  }

  get frames(): readonly TickSnapshot[] {
    return this.play.frames;
  }

  get frameCount(): number {
    return this.play.frames.length;
  }

  /** Highest legal cursor position. */
  get lastIndex(): number {
    return Math.max(0, this.frameCount - 1);
  }

  get cursor(): number {
    return this.cursorPos;
  }

  get speed(): ReplaySpeed {
    return this.speedValue;
  }

  /** 0 at the snap, 1 at the whistle (1 for a degenerate one-frame play). */
  get progress01(): number {
    return this.lastIndex === 0 ? 1 : this.cursorPos / this.lastIndex;
  }

  /** True once the last frame has been reached (or there is nothing to play). */
  get done(): boolean {
    return this.frameCount === 0 || this.cursorPos >= this.lastIndex;
  }

  /** Ticks of playback still to run at the current speed. */
  get remainingTicks(): number {
    if (this.done) return 0;
    return Math.ceil((this.lastIndex - this.cursorPos) / this.speedValue);
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speedValue = speed;
  }

  /** Advance by `ticks` sim ticks of wall time. Returns `done`. */
  advance(ticks = 1): boolean {
    if (this.frameCount === 0) return true;
    const step = Math.max(0, ticks) * this.speedValue;
    this.cursorPos = Math.min(this.lastIndex, this.cursorPos + step);
    return this.done;
  }

  /** Jump to an absolute frame position; clamped into [0, lastIndex]. */
  scrub(position: number): void {
    const p = Number.isFinite(position) ? position : 0;
    this.cursorPos = Math.min(this.lastIndex, Math.max(0, p));
  }

  /** Jump by fraction of the play; clamped the same way. */
  scrub01(fraction: number): void {
    this.scrub((Number.isFinite(fraction) ? fraction : 0) * this.lastIndex);
  }

  restart(): void {
    this.cursorPos = 0;
  }

  /** The pair of frames straddling the cursor, or null for an empty play. */
  view(): ReplayFrameView | null {
    const frames = this.play.frames;
    if (frames.length === 0) return null;
    const i = Math.min(this.lastIndex, Math.floor(this.cursorPos));
    const prev = frames[i];
    if (prev === undefined) return null;
    const next = frames[i + 1];
    if (next === undefined) return { prev, curr: prev, alpha: 0 };
    return { prev, curr: next, alpha: this.cursorPos - i };
  }

  /** World y the camera should follow at the cursor. */
  focusY(): number | null {
    const view = this.view();
    return view === null ? null : focusYOf(view.curr);
  }
}
