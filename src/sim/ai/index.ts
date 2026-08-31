// ★ AI entry-point contract between S1 (sim core / phases) and S8 (AI).
// S1 calls ONLY these three functions and treats them as a black box.
// S8 owns this directory and replaces the stub bodies (keeping signatures).

import type { GameState, TeamSide } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { Rng, RngSet } from '../rng';
import { allDefensivePlays, allOffensivePlays } from '../../data/plays/index';

/**
 * CPU play selection for one team/side, respecting state.nextPlayKind
 * (kickoff → a kickoff play; pat → extraPoint or twoPoint; freeKick → kickoff
 * variant). Returns a play id present in the playbook.
 */
export function cpuCallPlay(
  state: GameState,
  team: TeamSide,
  side: 'offense' | 'defense',
  rng: Rng,
): string {
  if (side === 'offense') {
    const plays = allOffensivePlays();
    const kind = state.nextPlayKind;
    if (kind === 'kickoff' || kind === 'freeKick') {
      const ko = plays.filter((p) => p.type === 'kickoff');
      if (ko.length > 0) return rng.pick(ko).id;
    }
    if (kind === 'pat') {
      const xp = plays.filter((p) => p.type === 'extraPoint');
      if (xp.length > 0) return rng.pick(xp).id;
    }
    // Rudimentary 4th-down logic so stub games exercise special teams.
    if (state.down === 4 && (kind === 'normal' || kind === null)) {
      const dir = state.attackDir[team];
      const goalY = dir === 1 ? 110 : 10;
      const kickDist = Math.abs(goalY - state.ballOnY) + 17;
      if (kickDist <= 45) {
        const fg = plays.filter((p) => p.type === 'fieldGoal');
        if (fg.length > 0) return rng.pick(fg).id;
      }
      const punt = plays.filter((p) => p.type === 'punt');
      if (punt.length > 0) return rng.pick(punt).id;
    }
    const normal = plays.filter(
      (p) => !['kickoff', 'punt', 'fieldGoal', 'extraPoint', 'twoPoint', 'kneel', 'spike'].includes(p.type),
    );
    return (normal.length > 0 ? rng.pick(normal) : rng.pick(plays)).id;
  }
  const plays = allDefensivePlays();
  const kind = state.nextPlayKind;
  if (kind === 'kickoff' || kind === 'freeKick') {
    const kr = plays.filter((p) => p.shell === 'specialTeams' && p.tags.includes('contain'));
    if (kr.length > 0) return rng.pick(kr).id;
  }
  const base = plays.filter((p) => p.shell !== 'specialTeams');
  return (base.length > 0 ? rng.pick(base) : rng.pick(plays)).id;
}

/**
 * Pre-snap AI: walk players to alignment, CPU QB snap timing, defensive
 * shifts. Called by the PRE_SNAP phase every tick for all non-user-controlled
 * players. Stub: no-op (S1's phase handles alignment placement directly until
 * S8 lands).
 */
export function updatePreSnapAI(
  _state: GameState,
  _input: TickInput,
  _rng: RngSet,
  _events: SimEvent[],
): void {
  // S8 implements.
}

/**
 * Live-play AI: drives all 22 players except the user-controlled one —
 * routes, coverage, blocking engagements, pass rush, CPU QB brain, carrier
 * decisions, pursuit, tackling attempts, special-teams units.
 * Called by the PLAY_LIVE phase every tick BEFORE physics integration.
 * Stub: no-op — with stub AI nobody moves and S1's safety whistle ends plays.
 */
export function updateLiveAI(
  _state: GameState,
  _input: TickInput,
  _rng: RngSet,
  _events: SimEvent[],
): void {
  // S8 implements.
}
