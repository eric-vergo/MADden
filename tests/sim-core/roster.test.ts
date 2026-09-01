// Role -> athlete resolution and formation placement.

import { describe, expect, it } from 'vitest';
import {
  buildPlayState, buildUnit, DEF_ROLE_ORDER, findRole, formationRoles,
  OFF_ROLE_ORDER, resolveRoleAthlete,
} from '../../src/sim/roster';
import { getFormation } from '../../src/data/plays/index';
import { createInitialState } from '../../src/sim/GameSim';
import { CENTER_X } from '../../src/sim/constants';
import type { Assignment, RoleId, TeamRoster } from '../../src/sim/types';
import { lineToGainY } from '../../src/sim/rules/downs';
import { findDefensePlay, findOffensePlay, testConfig, testRosters } from './helpers';

function roster(): TeamRoster {
  return testRosters()[0];
}

describe('role -> athlete resolution', () => {
  it('reads straight down the depth chart for the obvious roles', () => {
    const r = roster();
    const used = new Set<string>();
    expect(resolveRoleAthlete(r, 'QB', used).id).toBe(r.depth.QB[0]);
    used.add(r.depth.QB[0] as string);
    expect(resolveRoleAthlete(r, 'RB', used).id).toBe(r.depth.RB[0]);
    expect(resolveRoleAthlete(r, 'WR3', new Set()).id).toBe(r.depth.WR[2]);
    expect(resolveRoleAthlete(r, 'C', new Set()).id).toBe(r.depth.OL[2]);
    expect(resolveRoleAthlete(r, 'FS', new Set()).id).toBe(r.depth.S[0]);
    expect(resolveRoleAthlete(r, 'ROLB', new Set()).id).toBe(r.depth.LB[2]);
  });

  it('pulls the special slots from the places the design specifies', () => {
    const r = roster();
    // Fullback is the second running back.
    expect(resolveRoleAthlete(r, 'FB', new Set()).id).toBe(r.depth.RB[1]);
    // Second inside backer comes off the linebacker chart.
    expect(resolveRoleAthlete(r, 'MLB2', new Set()).id).toBe(r.depth.LB[3]);
    // Third safety from the safety chart.
    expect(resolveRoleAthlete(r, 'S3', new Set()).id).toBe(r.depth.S[2]);
    // Holder is the backup quarterback.
    expect(resolveRoleAthlete(r, 'H', new Set()).id).toBe(r.depth.QB[1]);
    // Returners come off the dedicated slots.
    expect(resolveRoleAthlete(r, 'KR', new Set()).id).toBe(r.returners.kr);
    expect(resolveRoleAthlete(r, 'PR', new Set()).id).toBe(r.returners.pr);
  });

  it('falls back deterministically when a slot is taken or missing', () => {
    const r = roster();
    const used = new Set<string>([r.depth.QB[1] as string]);
    // Holder falls through to the punter once QB2 is on the field elsewhere.
    const h = resolveRoleAthlete(r, 'H', used);
    expect(used.has(h.id)).toBe(false);
    // Same inputs, same answer.
    expect(resolveRoleAthlete(r, 'H', new Set([r.depth.QB[1] as string])).id).toBe(h.id);
  });

  it('never fields the same athlete twice in one unit', () => {
    const r = roster();
    for (const formationId of ['gun-2x2', 'st-kickoff', 'st-punt', 'st-field-goal']) {
      const f = getFormation(formationId);
      if (f === undefined) continue;
      const unit = buildUnit(r, 0, f, {}, 1, { x: CENTER_X, y: 50 });
      expect(unit.length).toBe(11);
      const ids = new Set(unit.map((p) => p.athleteId));
      expect(ids.size).toBe(11);
    }
  });
});

describe('formation placement', () => {
  it('lists roles in canonical order', () => {
    const f = getFormation('gun-2x2');
    expect(f).toBeDefined();
    if (f === undefined) return;
    const roles = formationRoles(f);
    const order = OFF_ROLE_ORDER as readonly RoleId[];
    let last = -1;
    for (const r of roles) {
      const i = order.indexOf(r);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
    expect(DEF_ROLE_ORDER.length).toBeGreaterThan(0);
  });

  it('mirrors alignment when the offense attacks -y', () => {
    const f = getFormation('gun-2x2');
    expect(f).toBeDefined();
    if (f === undefined) return;
    const spot = { x: CENTER_X, y: 60 };
    const plus = buildUnit(roster(), 0, f, {}, 1, spot);
    const minus = buildUnit(roster(), 0, f, {}, -1, spot);
    for (let i = 0; i < 11; i++) {
      const a = plus[i];
      const b = minus[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      expect(a.pos2.y - spot.y).toBeCloseTo(-(b.pos2.y - spot.y), 6);
      expect(a.pos2.x - spot.x).toBeCloseTo(-(b.pos2.x - spot.x), 6);
    }
  });

  it('builds a 22-man snap with the offense first and the ball dead at the line', () => {
    const state = createInitialState(testConfig(), testRosters(), 5);
    const off = findOffensePlay((p) => p.type === 'pass');
    const def = findDefensePlay((p) => p.shell !== 'specialTeams');
    const play = buildPlayState(state, off, def, {
      offense: 0, dir: 1, spot: { x: CENTER_X, y: 45 },
      firstDownY: lineToGainY(45, 10, 1), controlledIdx: -1,
    });
    expect(play.players.length).toBe(22);
    for (let i = 0; i < 11; i++) expect(play.players[i]?.team).toBe(0);
    for (let i = 11; i < 22; i++) expect(play.players[i]?.team).toBe(1);
    expect(play.ball.mode).toBe('dead');
    expect(play.ball.pos2.y).toBe(45);
    expect(play.snapTick).toBe(-1);
    expect(play.lineOfScrimmageY).toBe(45);
    expect(play.firstDownY).toBe(55);
    expect(findRole(play, 'QB')).toBeGreaterThanOrEqual(0);

    // Offense lines up behind the ball, defense in front of it.
    for (let i = 0; i < 11; i++) {
      const p = play.players[i];
      if (p === undefined || p.role === 'QB' || p.role === 'RB' || p.role === 'FB') continue;
      expect(p.pos2.y).toBeLessThanOrEqual(45.001);
    }
    for (let i = 11; i < 22; i++) {
      const p = play.players[i];
      if (p === undefined) continue;
      expect(p.pos2.y).toBeGreaterThanOrEqual(44.999);
    }
  });

  it('copies the play assignments onto the right roles', () => {
    const state = createInitialState(testConfig(), testRosters(), 5);
    const off = findOffensePlay((p) => p.type === 'pass');
    const def = findDefensePlay((p) => p.shell !== 'specialTeams');
    const play = buildPlayState(state, off, def, {
      offense: 0, dir: 1, spot: { x: CENTER_X, y: 45 },
      firstDownY: 55, controlledIdx: -1,
    });
    for (let i = 0; i < 22; i++) {
      const p = play.players[i];
      if (p === undefined) continue;
      const src = i < 11 ? off.assignments : def.assignments;
      const expected = (src[p.role] ?? { kind: 'idle' }) as Assignment;
      expect(p.assignment.kind).toBe(expected.kind);
    }
  });

  it('keeps every player inside the field of play', () => {
    const state = createInitialState(testConfig(), testRosters(), 5);
    const off = findOffensePlay((p) => p.type === 'pass');
    const def = findDefensePlay((p) => p.shell !== 'specialTeams');
    for (const y of [11, 50, 108]) {
      for (const dir of [1, -1] as const) {
        const play = buildPlayState(state, off, def, {
          offense: 0, dir, spot: { x: 2, y }, firstDownY: y + 10 * dir, controlledIdx: -1,
        });
        for (const p of play.players) {
          expect(p.pos2.x).toBeGreaterThanOrEqual(0);
          expect(p.pos2.x).toBeLessThanOrEqual(53.334);
          expect(p.pos2.y).toBeGreaterThanOrEqual(0);
          expect(p.pos2.y).toBeLessThanOrEqual(120);
        }
      }
    }
  });
});
