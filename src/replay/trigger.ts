// When a play earns a replay (meta-design section 10).
//
// The sim already flags the exciting plays with BIG_PLAY, but it is deliberately
// generous there (20+ yard gains, every sack) because the crowd reacts to those
// too. Broadcast policy is stricter: touchdown, real turnover, or a 40+ yard
// scrimmage gain — never a kneel, never twice inside 20 game-seconds, and
// nothing but touchdowns in the last two minutes of a half.

import { TWO_MINUTE_SEC } from '../sim/constants';
import type { SimEvent } from '../sim/events';

export type PlayResultEvent = Extract<SimEvent, { type: 'PLAY_RESULT' }>;

/** Where the game clock stood when a play resolved. */
export interface ReplayClock {
  quarter: number;
  clockSec: number;
}

// TODO(balance): replay policy thresholds, local until the consolidation pass.
export const REPLAY_POLICY = {
  /** Gain that is worth showing again on its own merit. */
  minGainYards: 40,
  /** Never two replays inside this many game-seconds. */
  cooldownGameSec: 20,
  /** Inside this much of a half's end, only touchdowns interrupt. */
  lateHalfSec: TWO_MINUTE_SEC,
} as const;

/** Play types whose `yards` is a gain from scrimmage (kicks measure distance). */
const SCRIMMAGE: ReadonlySet<PlayResultEvent['playType']> = new Set<PlayResultEvent['playType']>([
  'run', 'pass', 'scramble', 'sack',
]);

/** Plays that are never replayed however they end. */
const NEVER: ReadonlySet<PlayResultEvent['playType']> = new Set<PlayResultEvent['playType']>([
  'kneel', 'spike', 'penaltyOnly',
]);

export interface ReplayDecision {
  /** The sim flagged this play as a BIG_PLAY. */
  bigPlay: boolean;
  result: PlayResultEvent;
  clock: ReplayClock;
  /** Clock reading of the previous replay, null when none has run. */
  lastReplayAt: ReplayClock | null;
}

/** Final two minutes of either half (the halves that actually end on 0:00). */
export function isLateInHalf(clock: ReplayClock): boolean {
  const endOfHalf = clock.quarter === 2 || clock.quarter >= 4;
  return endOfHalf && clock.clockSec <= REPLAY_POLICY.lateHalfSec;
}

/** Game-seconds between two clock readings; Infinity across a quarter change. */
export function gameSecondsSince(from: ReplayClock, to: ReplayClock): number {
  if (from.quarter !== to.quarter) return Infinity;
  return from.clockSec - to.clockSec;
}

/** The whole policy, as one pure predicate. */
export function shouldReplay(d: ReplayDecision): boolean {
  const { result } = d;
  if (!d.bigPlay) return false;
  if (NEVER.has(result.playType)) return false;

  const turnover = result.turnover === 'int' || result.turnover === 'fumble';
  const longGain = SCRIMMAGE.has(result.playType) && result.yards >= REPLAY_POLICY.minGainYards;
  if (!result.touchdown && !turnover && !longGain) return false;

  if (isLateInHalf(d.clock) && !result.touchdown) return false;

  const last = d.lastReplayAt;
  if (last !== null && gameSecondsSince(last, d.clock) < REPLAY_POLICY.cooldownGameSec) return false;
  return true;
}

/**
 * Fed the whole event batch every tick, it answers "replay this one" on the
 * tick a play resolves. The sim emits BIG_PLAY *after* PLAY_RESULT in the same
 * batch, so the batch is scanned in full before deciding — and a BIG_PLAY that
 * arrives without a result of its own is never held against a later play.
 */
export class ReplayTrigger {
  private last: ReplayClock | null = null;

  /** Clock reading of the last replay that actually ran. */
  get lastReplayAt(): ReplayClock | null {
    return this.last;
  }

  reset(): void {
    this.last = null;
  }

  /** Arm the cooldown — called when a replay actually starts. */
  arm(clock: ReplayClock): void {
    this.last = { quarter: clock.quarter, clockSec: clock.clockSec };
  }

  offer(events: readonly SimEvent[], clock: ReplayClock): boolean {
    let result: PlayResultEvent | null = null;
    let bigPlay = false;
    for (const ev of events) {
      if (ev.type === 'BIG_PLAY') bigPlay = true;
      else if (ev.type === 'PLAY_RESULT') result = ev;
    }
    if (result === null) return false;
    return shouldReplay({ bigPlay, result, clock, lastReplayAt: this.last });
  }
}
