// ★ Playbook lookup API — keep these function signatures stable (S1 and the
// AI code against them). S2 owns the content files and may reshape internals.

import type { DefensivePlayDef, FormationDef, OffensivePlayDef } from '../../sim/types';
import { FORMATIONS } from './formations';
import { OFFENSIVE_PLAYS } from './offense';
import { DEFENSIVE_PLAYS } from './defense';

export function allFormations(): readonly FormationDef[] {
  return FORMATIONS;
}

export function allOffensivePlays(): readonly OffensivePlayDef[] {
  return OFFENSIVE_PLAYS;
}

export function allDefensivePlays(): readonly DefensivePlayDef[] {
  return DEFENSIVE_PLAYS;
}

export function getFormation(id: string): FormationDef | undefined {
  return FORMATIONS.find((f) => f.id === id);
}

export function getOffensivePlay(id: string): OffensivePlayDef | undefined {
  return OFFENSIVE_PLAYS.find((p) => p.id === id);
}

export function getDefensivePlay(id: string): DefensivePlayDef | undefined {
  return DEFENSIVE_PLAYS.find((p) => p.id === id);
}
