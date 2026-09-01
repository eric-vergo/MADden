// Ring buffer of TickSnapshots — the raw material every replay is cut from.
//
// Recording is pure bookkeeping: the frames are the exact snapshots the live
// renderer already drew (GameSim.snapshot()), so a replay redraws the play
// frame-for-frame with zero determinism impact. The buffer holds ONE play at a
// time plus a rolling ~1s pre-snap lead that is flushed in at the snap.

import { REPLAY_BUFFER_TICKS, TICK_HZ } from '../sim/constants';
import type { PlayManifest, TickSnapshot } from '../sim/types';

/** Pre-snap frames kept in front of the snap (~1 second). */
export const REPLAY_LEAD_TICKS = TICK_HZ;

/** One recorded play, oldest frame first. */
export interface RecordedPlay {
  manifest: PlayManifest;
  frames: readonly TickSnapshot[];
}

export interface ReplayBufferOptions {
  /** Ring capacity in ticks (default REPLAY_BUFFER_TICKS ≈ 25s). */
  capacity?: number;
  /** Pre-snap lead window in ticks (default REPLAY_LEAD_TICKS = 1s). */
  leadTicks?: number;
}

export class ReplayBuffer {
  readonly capacity: number;
  readonly leadTicks: number;

  private readonly ring: Array<TickSnapshot | undefined>;
  private start = 0;
  private count = 0;
  private lead: TickSnapshot[] = [];
  private manifest: PlayManifest | null = null;

  constructor(opts: ReplayBufferOptions = {}) {
    this.capacity = Math.max(1, Math.floor(opts.capacity ?? REPLAY_BUFFER_TICKS));
    this.leadTicks = Math.max(0, Math.floor(opts.leadTicks ?? REPLAY_LEAD_TICKS));
    this.ring = new Array<TickSnapshot | undefined>(this.capacity);
  }

  /** Frames recorded for the current play (never more than `capacity`). */
  get length(): number {
    return this.count;
  }

  /** Pre-snap frames waiting to be flushed by the next beginPlay(). */
  get leadLength(): number {
    return this.lead.length;
  }

  /** True between beginPlay() and clear() — i.e. a play is on tape. */
  get recording(): boolean {
    return this.manifest !== null;
  }

  get playManifest(): PlayManifest | null {
    return this.manifest;
  }

  /** Newest recorded tick, or -1 when nothing is recorded. */
  get lastTick(): number {
    return this.at(this.count - 1)?.tick ?? -1;
  }

  /** Frame `i` counting from the oldest (0) to the newest (length - 1). */
  at(i: number): TickSnapshot | undefined {
    if (i < 0 || i >= this.count) return undefined;
    return this.ring[(this.start + i) % this.capacity];
  }

  /**
   * Hold a pre-snap frame. Only the newest `leadTicks` survive, so a long
   * huddle never ends up in front of the snap.
   */
  pushLead(snap: TickSnapshot): void {
    if (this.leadTicks === 0) return;
    const last = this.lead[this.lead.length - 1];
    if (last !== undefined && snap.tick <= last.tick) return;
    this.lead.push(snap);
    const overflow = this.lead.length - this.leadTicks;
    if (overflow > 0) this.lead.splice(0, overflow);
  }

  /** Record one frame, dropping the oldest once the ring is full. */
  push(snap: TickSnapshot): void {
    // Ticks only ever move forward: a repeated snapshot is a caller mistake,
    // not a frame, and would show up as a stutter in the replay.
    if (this.count > 0 && snap.tick <= this.lastTick) return;
    if (this.count < this.capacity) {
      this.ring[(this.start + this.count) % this.capacity] = snap;
      this.count++;
      return;
    }
    this.ring[this.start] = snap;
    this.start = (this.start + 1) % this.capacity;
  }

  /**
   * Start a new play: the previous one is dropped and the pre-snap lead is
   * flushed in as the opening frames.
   */
  beginPlay(manifest: PlayManifest): void {
    this.start = 0;
    this.count = 0;
    this.ring.fill(undefined);
    this.manifest = { ...manifest };
    const lead = this.lead;
    this.lead = [];
    for (const frame of lead) this.push(frame);
  }

  /** Patch the manifest once the play's result is known (big play, copy). */
  annotate(patch: Partial<PlayManifest>): void {
    if (this.manifest === null) return;
    this.manifest = { ...this.manifest, ...patch };
  }

  /**
   * The recorded play, trimmed to its newest `maxFrames` frames (a 12-second
   * scramble is not a highlight — the end of it is). Null until beginPlay().
   */
  lastPlay(maxFrames: number = this.capacity): RecordedPlay | null {
    const manifest = this.manifest;
    if (manifest === null || this.count === 0) return null;
    const take = Math.min(this.count, Math.max(1, Math.floor(maxFrames)));
    const frames: TickSnapshot[] = [];
    for (let i = this.count - take; i < this.count; i++) {
      const frame = this.at(i);
      if (frame !== undefined) frames.push(frame);
    }
    return { manifest, frames };
  }

  /** Drop everything, including the lead and the manifest. */
  clear(): void {
    this.start = 0;
    this.count = 0;
    this.ring.fill(undefined);
    this.lead = [];
    this.manifest = null;
  }
}
