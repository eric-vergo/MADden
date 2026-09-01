// Regression: "Accepted penalties still credit every stat the nullified play
// produced". An accepted penalty wipes the down, so nothing the play produced
// may reach the box score.

import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import type { PlayOutcome } from '../../src/sim/rules/ext';
import { defaultOutcome } from '../../src/sim/phases/outcome';
import { accumulatePlay, emptyPlayerStats } from '../../src/sim/stats';
import type { PlayerGameStats } from '../../src/sim/types';
import { makeScenario } from '../sim-core/helpers';

const ZERO = emptyPlayerStats('x');

/** Every counter that is not zero, per player. */
function nonZero(stats: Record<string, PlayerGameStats>): Record<string, Partial<PlayerGameStats>> {
  const out: Record<string, Partial<PlayerGameStats>> = {};
  for (const [id, row] of Object.entries(stats)) {
    const diff: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'athleteId') continue;
      const base = (ZERO as unknown as Record<string, number>)[k] ?? 0;
      if (typeof v === 'number' && v !== base) diff[k] = v;
    }
    if (Object.keys(diff).length > 0) out[id] = diff as Partial<PlayerGameStats>;
  }
  return out;
}

const NULLIFIED_EVENTS: { name: string; events: SimEvent[] }[] = [
  {
    name: 'completed pass',
    events: [
      { type: 'PASS_THROWN', tick: 1, passerIdx: 0, targetIdx: 3, bullet: false, airYds: 12 },
      { type: 'CATCH', tick: 2, receiverIdx: 3, contested: false },
      { type: 'TACKLE', tick: 3, tacklerIdx: 14, carrierIdx: 3, bigHit: false, assistIdx: 15 },
    ],
  },
  {
    name: 'interception',
    events: [
      { type: 'PASS_THROWN', tick: 1, passerIdx: 0, targetIdx: 3, bullet: false, airYds: 20 },
      { type: 'INTERCEPTION', tick: 2, defenderIdx: 16 },
      { type: 'TACKLE', tick: 3, tacklerIdx: 5, carrierIdx: 16, bigHit: false, assistIdx: null },
    ],
  },
  {
    name: 'sack',
    events: [
      { type: 'PASS_THROWN', tick: 1, passerIdx: 0, targetIdx: 3, bullet: false, airYds: 0 },
      { type: 'SACK', tick: 2, tacklerIdx: 13, qbIdx: 0, yards: -7 },
    ],
  },
  {
    name: 'run stuffed, ball on the ground',
    events: [
      { type: 'TACKLE', tick: 2, tacklerIdx: 13, carrierIdx: 1, bigHit: true, assistIdx: null },
      { type: 'FUMBLE', tick: 2, carrierIdx: 1, forcedByIdx: 13 },
    ],
  },
  {
    name: 'kick',
    events: [
      { type: 'KICK_LAUNCHED', tick: 1, style: 'punt', kickerIdx: 10, power01: 0.8, accuracy01: 0.9 },
      { type: 'FIELD_GOAL_RESULT', tick: 2, team: 0, good: true, distanceYds: 42, missSide: null },
      { type: 'XP_RESULT', tick: 2, team: 0, good: true },
    ],
  },
];

describe('accumulatePlay ignores a nullified play', () => {
  for (const c of NULLIFIED_EVENTS) {
    it(`posts nothing for a ${c.name} wiped out by an accepted penalty`, () => {
      const sc = makeScenario();
      const s = sc.state;
      const penaltyOnly: PlayOutcome = {
        ...defaultOutcome(s, sc.play),
        playType: 'penaltyOnly',
        deadReason: 'penaltyDead',
        yards: 0,
      };
      accumulatePlay(s, sc.play, c.events, penaltyOnly, 0);
      expect(nonZero(s.stats.players)).toEqual({});
      expect(s.stats.teams[0].totalYds).toBe(0);
      expect(s.stats.teams[0].sacksAllowed).toBe(0);
      expect(s.stats.teams[0].turnovers).toBe(0);
    });
  }

  it('still posts everything for a play that stands', () => {
    const sc = makeScenario();
    const s = sc.state;
    const live: PlayOutcome = {
      ...defaultOutcome(s, sc.play),
      playType: 'pass',
      yards: 15,
      passerIdx: 0,
      targetIdx: 3,
      carrierIdx: 3,
      completed: true,
    };
    const events = NULLIFIED_EVENTS[0]?.events ?? [];
    accumulatePlay(s, sc.play, events, live, 0);
    const posted = nonZero(s.stats.players);
    expect(Object.keys(posted).length).toBeGreaterThan(0);
    expect(s.stats.teams[0].passYds).toBe(15);
  });
});
