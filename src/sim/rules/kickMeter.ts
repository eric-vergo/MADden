// Three-press kick meter. Every value here is a pure function of tick counts,
// which is what makes kicking deterministic and unit-testable.
//
//   press 1 -> meter starts, power fills over KICK.meterFillTicks
//   press 2 -> power locked; accuracy marker sweeps over KICK.meterSweepTicks
//   press 3 -> accuracy locked; the sweep midpoint is dead-centre

import type { KickMeterState } from '../types';
import { KICK } from '../../data/balance';

export type MeterStage = 'idle' | 'filling' | 'sweeping' | 'locked';

export function meterStage(km: KickMeterState): MeterStage {
  if (!km.active || km.startTick < 0) return 'idle';
  if (km.powerLockTick === null) return 'filling';
  if (km.accuracyLockTick === null) return 'sweeping';
  return 'locked';
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Power fraction the bar shows (or locked in) at `tick`. */
export function powerAt(km: KickMeterState, tick: number, fillTicks = KICK.meterFillTicks): number {
  if (!km.active || km.startTick < 0) return 0;
  const end = km.powerLockTick ?? tick;
  return clamp01((end - km.startTick) / fillTicks);
}

/**
 * Signed accuracy error in [-1, 1]: 0 is perfect (a press at the sweep
 * midpoint), negative = early, positive = late. Never pressing runs the sweep
 * out to +1.
 */
export function accuracyErrorAt(
  km: KickMeterState,
  tick: number,
  sweepTicks = KICK.meterSweepTicks,
): number {
  if (km.powerLockTick === null) return 0;
  const end = km.accuracyLockTick ?? tick;
  const p = clamp01((end - km.powerLockTick) / sweepTicks);
  const e = (p - 0.5) * 2;
  return e < -1 ? -1 : e > 1 ? 1 : e;
}

/** 1 = perfect strike, 0 = worst possible. */
export function accuracy01(signedError: number): number {
  const a = 1 - Math.abs(signedError);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** Angular error the miss translates into, plus the player's manual aim. */
export function aimErrorRad(signedError: number, aimOffset: number): number {
  return signedError * KICK.aimMaxOffsetRad + aimOffset;
}

/** Tick a press must land on to produce exactly `power01`. */
export function tickForPower(startTick: number, power01: number, fillTicks = KICK.meterFillTicks): number {
  return startTick + Math.round(clamp01(power01) * fillTicks);
}

/** Tick a press must land on to produce exactly `signedError`. */
export function tickForAccuracy(
  powerLockTick: number,
  signedError: number,
  sweepTicks = KICK.meterSweepTicks,
): number {
  return powerLockTick + Math.round((signedError / 2 + 0.5) * sweepTicks);
}

/** Advance the meter state machine one press. Returns the resulting stage. */
export function press(km: KickMeterState, tick: number): MeterStage {
  if (!km.active) return 'idle';
  if (km.startTick < 0) {
    km.startTick = tick;
    return 'filling';
  }
  if (km.powerLockTick === null) {
    km.powerLockTick = tick;
    return 'sweeping';
  }
  if (km.accuracyLockTick === null) {
    km.accuracyLockTick = tick;
    return 'locked';
  }
  return 'locked';
}

/**
 * Watchdog so an unpressed meter still produces a kick: the power bar tops out
 * and the accuracy sweep runs off the end (a bad but legal kick).
 */
export function forceExpiry(km: KickMeterState, tick: number): void {
  if (!km.active || km.startTick < 0) return;
  if (km.powerLockTick === null && tick - km.startTick >= KICK.meterFillTicks) {
    km.powerLockTick = km.startTick + KICK.meterFillTicks;
  }
  if (
    km.powerLockTick !== null && km.accuracyLockTick === null &&
    tick - km.powerLockTick >= KICK.meterSweepTicks
  ) {
    km.accuracyLockTick = km.powerLockTick + KICK.meterSweepTicks;
  }
}
