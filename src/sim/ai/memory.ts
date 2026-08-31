// Per-play AI memory helpers. Alignment spots are the origin every authored
// route/path is measured from, so they are latched before anyone moves.

import type { SimPlayer, Vec2 } from '../types';
import { CENTER_X } from '../constants';
import { mindGet, mindSet } from './context';

export const CENTER_X_REF = CENTER_X;

const MIND_ALIGN_X = 'aiAlignX';
const MIND_ALIGN_Y = 'aiAlignY';
const MIND_ALIGNED = 'aiAligned';

/** Latch the player's current spot as his alignment (pre-snap / first tick). */
export function recordAlignment(p: SimPlayer): void {
  mindSet(p, MIND_ALIGN_X, p.pos2.x);
  mindSet(p, MIND_ALIGN_Y, p.pos2.y);
  mindSet(p, MIND_ALIGNED, 1);
}

/** Alignment spot, falling back to the live position when never latched. */
export function alignmentOf(p: SimPlayer): Vec2 {
  if (mindGet(p, MIND_ALIGNED) !== 1) return { x: p.pos2.x, y: p.pos2.y };
  return { x: mindGet(p, MIND_ALIGN_X, p.pos2.x), y: mindGet(p, MIND_ALIGN_Y, p.pos2.y) };
}

export function hasAlignment(p: SimPlayer): boolean {
  return mindGet(p, MIND_ALIGNED) === 1;
}

/**
 * Clear every brain's scratch for a new play, keeping the key set stable so
 * writes always happen in the same order.
 */
export function resetMind(p: SimPlayer): void {
  const keys = Object.keys(p.mind).sort();
  for (const k of keys) {
    if (k === MIND_ALIGN_X || k === MIND_ALIGN_Y || k === MIND_ALIGNED) continue;
    delete p.mind[k];
  }
}
