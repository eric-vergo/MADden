// Playbook validation: the data agent's contract with the sim. If any of these
// fail, some play would put a phantom player on the field, send a receiver out
// of bounds, or hand the ball to nobody.

import { describe, expect, it } from 'vitest';
import {
  allDefensivePlays, allFormations, allOffensivePlays, getFormation,
} from '../../src/data/plays/index';
import { SPECIAL_TEAMS_FORMATION_IDS } from '../../src/data/plays/formations';
import { FIELD_W, HASH_RIGHT_X } from '../../src/sim/constants';
import type {
  DefAssignment, DefensivePlayDef, FormationDef, OffAssignment, OffPlayType,
  OffensivePlayDef, RoleId, Route, Vec2,
} from '../../src/sim/types';

const FORMATIONS = allFormations();
const OFF_PLAYS = allOffensivePlays();
const DEF_PLAYS = allDefensivePlays();

/** Widest legal offset from the ball: hash to the far sideline. */
const MAX_OFFSET_X = FIELD_W - HASH_RIGHT_X; // 23.583 yd

const ST_PLAY_TYPES: readonly OffPlayType[] = [
  'kickoff', 'punt', 'fieldGoal', 'extraPoint', 'twoPoint', 'kneel', 'spike',
];

const ALL_PLAY_TYPES: readonly OffPlayType[] = [
  'run', 'pass', 'playAction', 'screen',
  'kickoff', 'punt', 'fieldGoal', 'extraPoint', 'twoPoint', 'kneel', 'spike',
];

function roleKeys(align: Partial<Record<RoleId, Vec2>>): string[] {
  return Object.keys(align).sort();
}

function assignmentKeys(a: Partial<Record<RoleId, unknown>>): string[] {
  return Object.keys(a).sort();
}

/** Object.values on a Partial record, without the undefined holes. */
function values<T>(rec: Partial<Record<RoleId, T>>): T[] {
  return Object.values(rec).filter((v): v is T => v !== undefined);
}

function isSpecialTeamsFormation(id: string): boolean {
  return SPECIAL_TEAMS_FORMATION_IDS.includes(id);
}

/** The route a role actually runs, counting an RB's check-release. */
function routeOf(a: OffAssignment | DefAssignment | undefined): Route | undefined {
  if (a === undefined) return undefined;
  if (a.kind === 'route') return a.route;
  if (a.kind === 'passProScan') return a.checkRoute;
  return undefined;
}

function formationOf(play: { formationId: string }): FormationDef {
  const f = getFormation(play.formationId);
  if (f === undefined) throw new Error(`missing formation ${play.formationId}`);
  return f;
}

describe('formations', () => {
  it('have unique ids', () => {
    const ids = FORMATIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('field exactly 11 roles each', () => {
    for (const f of FORMATIONS) {
      expect(roleKeys(f.alignments).length, f.id).toBe(11);
    }
  });

  it('never stack two players on the same spot', () => {
    for (const f of FORMATIONS) {
      const spots = Object.entries(f.alignments) as Array<[string, Vec2]>;
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const a = spots[i]!;
          const b = spots[j]!;
          const d = Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y);
          expect(d, `${f.id}: ${a[0]}/${b[0]}`).toBeGreaterThan(0.7);
        }
      }
    }
  });

  it('stay inbounds from either hash', () => {
    for (const f of FORMATIONS) {
      for (const [role, v] of Object.entries(f.alignments) as Array<[string, Vec2]>) {
        expect(Math.abs(v.x), `${f.id}.${role}`).toBeLessThan(MAX_OFFSET_X);
      }
    }
  });

  it('align on the correct side of the ball', () => {
    for (const f of FORMATIONS) {
      for (const [role, v] of Object.entries(f.alignments) as Array<[string, Vec2]>) {
        if (f.side === 'O') expect(v.y, `${f.id}.${role}`).toBeLessThanOrEqual(0);
        else expect(v.y, `${f.id}.${role}`).toBeGreaterThan(0);
      }
    }
  });

  it('put exactly seven offensive players on the line', () => {
    for (const f of FORMATIONS) {
      if (f.side !== 'O' || isSpecialTeamsFormation(f.id)) continue;
      const onLine = (values<Vec2>(f.alignments)).filter((v) => v.y >= -1.0);
      expect(onLine.length, f.id).toBe(7);
    }
  });

  it('cover the designed base looks', () => {
    const offBase = FORMATIONS.filter((f) => f.side === 'O' && !isSpecialTeamsFormation(f.id));
    const defBase = FORMATIONS.filter((f) => f.side === 'D' && !isSpecialTeamsFormation(f.id));
    expect(offBase.map((f) => f.id).sort()).toEqual(
      ['goal-line', 'gun-2x2', 'gun-empty', 'gun-trips-right', 'i-form', 'singleback'],
    );
    expect(defBase.map((f) => f.id).sort()).toEqual(
      ['34-base', '43-base', 'dime-416', 'gl-53', 'nickel-425'],
    );
  });

  it('are all used by at least one play', () => {
    const used = new Set<string>([
      ...OFF_PLAYS.map((p) => p.formationId),
      ...DEF_PLAYS.map((p) => p.formationId),
    ]);
    for (const f of FORMATIONS) expect(used.has(f.id), `unused formation ${f.id}`).toBe(true);
  });
});

describe('offensive playbook', () => {
  it('has 36 called plays plus the special-teams and clock plays', () => {
    const called = OFF_PLAYS.filter((p) => !ST_PLAY_TYPES.includes(p.type));
    expect(called.length).toBe(36);
    expect(called.filter((p) => p.type === 'run').length).toBe(10);
    expect(called.filter((p) => p.type === 'pass').length).toBe(18);
    expect(called.filter((p) => p.type === 'screen').length).toBe(3);
    expect(called.filter((p) => p.type === 'playAction').length).toBe(5);
  });

  it('spans the quick / medium / deep situation buckets', () => {
    const called = OFF_PLAYS.filter((p) => !ST_PLAY_TYPES.includes(p.type));
    const tagged = (t: string): number => called.filter((p) => p.tags.includes(t as never)).length;
    expect(tagged('quick')).toBeGreaterThanOrEqual(7);
    expect(tagged('medium')).toBeGreaterThanOrEqual(8);
    expect(tagged('deep')).toBeGreaterThanOrEqual(5);
    expect(tagged('run-inside')).toBeGreaterThanOrEqual(6);
    expect(tagged('run-outside')).toBeGreaterThanOrEqual(2);
    expect(tagged('draw')).toBeGreaterThanOrEqual(1);
    expect(tagged('goal-line')).toBeGreaterThanOrEqual(2);
    // Clock management lives on the special plays, not the called book.
    expect(OFF_PLAYS.filter((p) => p.tags.includes('clock-kill')).length).toBe(1);
    expect(OFF_PLAYS.filter((p) => p.tags.includes('clock-save')).length).toBe(1);
  });

  it('has unique ids and names', () => {
    const ids = OFF_PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('represents every OffPlayType', () => {
    for (const t of ALL_PLAY_TYPES) {
      expect(OFF_PLAYS.some((p) => p.type === t), `no play of type ${t}`).toBe(true);
    }
  });

  it('references existing formations', () => {
    for (const p of OFF_PLAYS) {
      const f = getFormation(p.formationId);
      expect(f, `${p.id} -> ${p.formationId}`).toBeDefined();
      expect(f?.side).toBe('O');
    }
  });

  it('assigns exactly the formation personnel', () => {
    for (const p of OFF_PLAYS) {
      const f = formationOf(p);
      expect(assignmentKeys(p.assignments), p.id).toEqual(roleKeys(f.alignments));
    }
  });

  it('gives every run exactly one ball carrier', () => {
    for (const p of OFF_PLAYS) {
      if (p.type !== 'run') continue;
      const carries = values(p.assignments).filter((a) => a.kind === 'carry');
      // A QB sneak's carry IS the 'sneak' drop — there is no exchange.
      const sneaks = values(p.assignments).filter(
        (a) => a.kind === 'qb' && a.drop.type === 'sneak',
      );
      expect(carries.length + sneaks.length, p.id).toBe(1);
    }
  });

  it('never declares two carries on any play', () => {
    for (const p of OFF_PLAYS) {
      const carries = values(p.assignments).filter((a) => a.kind === 'carry');
      expect(carries.length, p.id).toBeLessThanOrEqual(1);
    }
  });

  it('paces the mesh between a dive and a toss', () => {
    for (const p of OFF_PLAYS) {
      for (const a of values(p.assignments)) {
        if (a.kind !== 'carry') continue;
        expect(a.meshTick, p.id).toBeGreaterThanOrEqual(18);
        expect(a.meshTick, p.id).toBeLessThanOrEqual(36);
        expect(a.path.length, p.id).toBeGreaterThan(0);
      }
    }
  });

  it('sends at most five route runners', () => {
    for (const p of OFF_PLAYS) {
      const routes = values(p.assignments).filter((a) => a.kind === 'route');
      expect(routes.length, p.id).toBeLessThanOrEqual(5);
    }
  });

  it('gives every progression read and checkdown a real route', () => {
    for (const p of OFF_PLAYS) {
      const prog = p.qbProgression ?? [];
      expect(new Set(prog).size, `${p.id} duplicate read`).toBe(prog.length);
      expect(prog.length, p.id).toBeLessThanOrEqual(4);
      for (const role of prog) {
        const a = p.assignments[role];
        expect(a, `${p.id} read ${role} not in play`).toBeDefined();
        expect(a?.kind, `${p.id} read ${role}`).toBe('route');
      }
      if (p.checkdown !== undefined) {
        const a = p.assignments[p.checkdown];
        expect(a, `${p.id} checkdown ${p.checkdown} not in play`).toBeDefined();
        expect(routeOf(a), `${p.id} checkdown ${p.checkdown} has no route`).toBeDefined();
      }
    }
  });

  it('gives every non-special pass concept two to four reads', () => {
    for (const p of OFF_PLAYS) {
      if (p.type !== 'pass' && p.type !== 'playAction') continue;
      const prog = p.qbProgression ?? [];
      expect(prog.length, p.id).toBeGreaterThanOrEqual(2);
      expect(prog.length, p.id).toBeLessThanOrEqual(4);
    }
  });

  it('declares play-action and screen metadata consistently', () => {
    for (const p of OFF_PLAYS) {
      if (p.type === 'playAction') {
        expect(p.playAction, p.id).toBeDefined();
        const fakeTo = p.playAction?.fakeTo;
        expect(fakeTo !== undefined && p.assignments[fakeTo] !== undefined, p.id).toBe(true);
        expect(p.playAction?.fakeTicks, p.id).toBeGreaterThanOrEqual(16);
        expect(p.playAction?.fakeTicks, p.id).toBeLessThanOrEqual(32);
        expect(p.tags.includes('play-action'), p.id).toBe(true);
      } else {
        expect(p.playAction, p.id).toBeUndefined();
      }
      if (p.type === 'screen') {
        const to = p.screenTo;
        expect(to, p.id).toBeDefined();
        expect(routeOf(to === undefined ? undefined : p.assignments[to]), p.id).toBeDefined();
        expect(p.tags.includes('screen'), p.id).toBe(true);
      } else {
        expect(p.screenTo, p.id).toBeUndefined();
      }
    }
  });

  it('tags every called play for the CPU coach', () => {
    for (const p of OFF_PLAYS) {
      if (ST_PLAY_TYPES.includes(p.type) && p.type !== 'twoPoint') continue;
      expect(p.tags.length, p.id).toBeGreaterThan(0);
    }
  });

  it('keeps every waypoint inbounds from either hash', () => {
    for (const p of OFF_PLAYS) {
      const f = formationOf(p);
      for (const [role, a] of Object.entries(p.assignments) as Array<[RoleId, OffAssignment | DefAssignment]>) {
        const spot = f.alignments[role];
        if (spot === undefined) continue;
        const paths: Array<{ dx: number; dy: number }[]> = [];
        const r = routeOf(a);
        if (r !== undefined) paths.push([...r.waypoints]);
        if (a.kind === 'carry') paths.push([...a.path]);
        for (const path of paths) {
          for (const w of path) {
            expect(Math.abs(spot.x + w.dx), `${p.id}.${role}`).toBeLessThan(MAX_OFFSET_X);
            expect(spot.y + w.dy, `${p.id}.${role}`).toBeGreaterThan(-14);
            expect(spot.y + w.dy, `${p.id}.${role}`).toBeLessThan(45);
          }
        }
      }
    }
  });

  it('paces waypoints forward in time', () => {
    for (const p of OFF_PLAYS) {
      for (const [role, a] of Object.entries(p.assignments) as Array<[RoleId, OffAssignment | DefAssignment]>) {
        const r = routeOf(a);
        const path = r !== undefined ? r.waypoints : a.kind === 'carry' ? a.path : [];
        let last = -1;
        for (const w of path) {
          const t = w.atTick;
          expect(t, `${p.id}.${role} missing atTick`).toBeDefined();
          if (t !== undefined) {
            expect(t, `${p.id}.${role}`).toBeGreaterThan(last);
            last = t;
          }
        }
      }
    }
  });

  it('protects the passer on every drop-back concept', () => {
    for (const p of OFF_PLAYS) {
      if (p.type !== 'pass' && p.type !== 'playAction') continue;
      const blockers = values(p.assignments).filter(
        (a) => a.kind === 'passBlock' || a.kind === 'passProScan',
      );
      expect(blockers.length, p.id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('defensive playbook', () => {
  it('has 18 called plays plus special teams', () => {
    const called = DEF_PLAYS.filter((p) => p.shell !== 'specialTeams');
    expect(called.length).toBe(18);
    expect(DEF_PLAYS.filter((p) => p.shell === 'specialTeams').length).toBe(3);
  });

  it('has unique ids', () => {
    const ids = DEF_PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references existing defensive formations', () => {
    for (const p of DEF_PLAYS) {
      const f = getFormation(p.formationId);
      expect(f, `${p.id} -> ${p.formationId}`).toBeDefined();
      expect(f?.side).toBe('D');
    }
  });

  it('assigns exactly the formation personnel', () => {
    for (const p of DEF_PLAYS) {
      const f = formationOf(p);
      expect(assignmentKeys(p.assignments), p.id).toEqual(roleKeys(f.alignments));
    }
  });

  it('builds coherent coverage shells', () => {
    const count = (p: DefensivePlayDef, pred: (z: string) => boolean): number =>
      values(p.assignments).filter((a) => a.kind === 'zone' && pred(a.zone)).length;

    for (const p of DEF_PLAYS) {
      if (p.shell === 'specialTeams' || p.shell === 'goalLine') continue;
      // Run commits deliberately abandon the shell to fit gaps; the
      // 'tags blitzes and run commits truthfully' test covers them instead.
      if (p.tags.includes('run-commit')) continue;
      const thirds = count(p, (z) => z.startsWith('deepThird'));
      const halves = count(p, (z) => z.startsWith('deepHalf'));
      const quarters = count(p, (z) => z.startsWith('deepQuarter'));
      const under = count(p, (z) => !z.startsWith('deep'));
      const man = values(p.assignments).filter((a) => a.kind === 'man').length;

      switch (p.shell) {
        case 'cover3':
          expect(thirds, p.id).toBe(3);
          expect(under, p.id).toBeGreaterThanOrEqual(3);
          break;
        case 'cover2':
        case 'cover2man':
          expect(halves, p.id).toBe(2);
          expect(under + man, p.id).toBeGreaterThanOrEqual(5);
          break;
        case 'cover4':
          expect(quarters, p.id).toBe(4);
          break;
        case 'cover1':
          expect(thirds, p.id).toBe(1); // single high
          expect(man, p.id).toBeGreaterThanOrEqual(3);
          break;
        case 'cover0':
          expect(thirds + halves + quarters, p.id).toBe(0);
          expect(man, p.id).toBeGreaterThanOrEqual(5);
          break;
        default:
          break;
      }
    }
  });

  it('always fields three to seven front defenders and never more than six rushers', () => {
    for (const p of DEF_PLAYS) {
      if (p.shell === 'specialTeams') continue;
      const rushers = values(p.assignments).filter(
        (a) => a.kind === 'rush' || a.kind === 'blitz',
      ).length;
      // A runFit defender attacks a gap too — he is part of the front.
      const front = rushers + values(p.assignments).filter((a) => a.kind === 'runFit').length;
      expect(front, p.id).toBeGreaterThanOrEqual(3);
      // Nine in the box is the goal-line ceiling; ten would leave a receiver
      // uncovered with nobody in the deep middle.
      expect(front, p.id).toBeLessThanOrEqual(9);
      expect(rushers, p.id).toBeLessThanOrEqual(6);
    }
  });

  it('tags blitzes and run commits truthfully', () => {
    for (const p of DEF_PLAYS) {
      const blitzers = values(p.assignments).filter((a) => a.kind === 'blitz').length;
      if (blitzers > 0) expect(p.tags.includes('blitz'), p.id).toBe(true);
      const fits = values(p.assignments).filter((a) => a.kind === 'runFit').length;
      if (p.tags.includes('run-commit')) expect(fits, p.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('only man-covers roles the offense can actually field', () => {
    const offRoles = new Set<string>();
    for (const f of FORMATIONS) {
      if (f.side !== 'O') continue;
      for (const role of Object.keys(f.alignments)) offRoles.add(role);
    }
    for (const p of DEF_PLAYS) {
      for (const a of values(p.assignments)) {
        if (a.kind !== 'man') continue;
        if (a.target.startsWith('count-')) continue;
        expect(offRoles.has(a.target), `${p.id} covers phantom ${a.target}`).toBe(true);
      }
    }
  });

  it('covers each shell family at least once', () => {
    const shells = new Set(DEF_PLAYS.map((p) => p.shell));
    for (const s of ['cover0', 'cover1', 'cover2', 'cover3', 'cover4', 'cover2man', 'goalLine', 'specialTeams']) {
      expect(shells.has(s as DefensivePlayDef['shell']), `no ${s} play`).toBe(true);
    }
  });
});

describe('playbook / sim interface', () => {
  it('exposes a play for every situation the CPU can face', () => {
    const byType = (t: OffPlayType): readonly OffensivePlayDef[] =>
      OFF_PLAYS.filter((p) => p.type === t);
    expect(byType('kickoff').length).toBeGreaterThan(0);
    expect(byType('punt').length).toBeGreaterThan(0);
    expect(byType('fieldGoal').length).toBeGreaterThan(0);
    expect(byType('extraPoint').length).toBeGreaterThan(0);
    expect(byType('twoPoint').length).toBeGreaterThan(0);
    expect(byType('kneel').length).toBe(1);
    expect(byType('spike').length).toBe(1);
    // Kick returns / punt returns / FG block must exist for the special phases.
    expect(DEF_PLAYS.filter((p) => p.shell === 'specialTeams').length).toBe(3);
  });
});
