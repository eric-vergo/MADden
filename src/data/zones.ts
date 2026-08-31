// Zone landmark table. A zone is a point + radius + depth band, authored in the
// normalized frame (offense drives +y, x measured from the ball spot) and
// resolved at the snap from the line of scrimmage and the ball's hash position.
//
// The defender's job, given a resolved zone: get to (x, y), then mirror the
// most dangerous eligible inside [minY, maxY] without leaving `radius` of the
// landmark. Deep zones never chase below minDepth until the ball is thrown.

import type { ZoneName } from '../sim/types';
import { FIELD_W } from '../sim/constants';

export interface ZoneSpec {
  /** Landmark x offset from the ball spot (+ = offense's right). */
  dx: number;
  /** Landmark depth past the line of scrimmage, in yards. */
  depth: number;
  /** Soft radius the defender works within (yards). */
  radius: number;
  /** Depth band the zone is responsible for, relative to the LOS. */
  minDepth: number;
  maxDepth: number;
}

// TODO(balance): zone landmarks/radii are gameplay tuning, not geometry.
export const ZONES: Record<ZoneName, ZoneSpec> = {
  // Three deep: each corner takes an outside third, the free safety the middle.
  'deepThird-L': { dx: -13, depth: 18, radius: 9, minDepth: 12, maxDepth: 45 },
  'deepThird-M': { dx: 0, depth: 20, radius: 9, minDepth: 12, maxDepth: 45 },
  'deepThird-R': { dx: 13, depth: 18, radius: 9, minDepth: 12, maxDepth: 45 },

  // Two deep: safeties split the field, each with a wider radius to cover it.
  'deepHalf-L': { dx: -9.5, depth: 17, radius: 11, minDepth: 11, maxDepth: 45 },
  'deepHalf-R': { dx: 9.5, depth: 17, radius: 11, minDepth: 11, maxDepth: 45 },

  // Four deep, numbered left to right.
  'deepQuarter-1': { dx: -17, depth: 16, radius: 8, minDepth: 10, maxDepth: 45 },
  'deepQuarter-2': { dx: -6, depth: 16, radius: 8, minDepth: 10, maxDepth: 45 },
  'deepQuarter-3': { dx: 6, depth: 16, radius: 8, minDepth: 10, maxDepth: 45 },
  'deepQuarter-4': { dx: 17, depth: 16, radius: 8, minDepth: 10, maxDepth: 45 },

  // Underneath: curl-flat squeezes the curl first and breaks late on the flat.
  'curlFlat-L': { dx: -12, depth: 7, radius: 7, minDepth: 0, maxDepth: 14 },
  'curlFlat-R': { dx: 12, depth: 7, radius: 7, minDepth: 0, maxDepth: 14 },

  'hook-L': { dx: -6.5, depth: 10, radius: 6, minDepth: 4, maxDepth: 16 },
  'hook-M': { dx: 0, depth: 11, radius: 6, minDepth: 4, maxDepth: 16 },
  'hook-R': { dx: 6.5, depth: 10, radius: 6, minDepth: 4, maxDepth: 16 },

  'flat-L': { dx: -16, depth: 3.5, radius: 6, minDepth: 0, maxDepth: 9 },
  'flat-R': { dx: 16, depth: 3.5, radius: 6, minDepth: 0, maxDepth: 9 },
};

/** Fixed iteration order — never enumerate ZONES by key. */
export const ZONE_NAMES: readonly ZoneName[] = [
  'deepThird-L', 'deepThird-M', 'deepThird-R',
  'deepHalf-L', 'deepHalf-R',
  'deepQuarter-1', 'deepQuarter-2', 'deepQuarter-3', 'deepQuarter-4',
  'curlFlat-L', 'curlFlat-R',
  'hook-L', 'hook-M', 'hook-R',
  'flat-L', 'flat-R',
];

/** Zone landmark in world coordinates. */
export interface ResolvedZone {
  x: number;
  y: number;
  radius: number;
  /** Depth band in world y, ordered so minY <= maxY regardless of direction. */
  minY: number;
  maxY: number;
}

/** Landmarks stay this far from the sideline so defenders keep working room. */
const SIDELINE_MARGIN = 2.0;

/**
 * Resolve a zone against the current spot.
 * `dir` is the OFFENSE's attack direction (+1 attacking high y); both axes
 * mirror when dir === -1, matching the sim's single normalized→world transform.
 */
export function resolveZone(
  zone: ZoneName,
  ballX: number,
  losY: number,
  dir: 1 | -1,
): ResolvedZone {
  const spec = ZONES[zone];
  const x = clampX(ballX + dir * spec.dx);
  const y = losY + dir * spec.depth;
  const a = losY + dir * spec.minDepth;
  const b = losY + dir * spec.maxDepth;
  return {
    x,
    y,
    radius: spec.radius,
    minY: Math.min(a, b),
    maxY: Math.max(a, b),
  };
}

function clampX(x: number): number {
  if (x < SIDELINE_MARGIN) return SIDELINE_MARGIN;
  if (x > FIELD_W - SIDELINE_MARGIN) return FIELD_W - SIDELINE_MARGIN;
  return x;
}

/** True for zones a defender must not vacate before the ball is thrown. */
export function isDeepZone(zone: ZoneName): boolean {
  return ZONES[zone].minDepth >= 10;
}
