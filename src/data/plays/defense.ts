// The defensive playbook: 18 called plays across five fronts, plus the
// special-teams units. Shells are internally coherent by construction —
// Cover 3 = three deep thirds + four under, Cover 2 = two halves + five under,
// Cover 4 = four quarters, man plays cover every eligible with count-N or role
// targets, blitzes trade a coverage body for a rusher.
//
// Frame: same normalized frame as the offense (offense drives +y), so a
// defender's alignment dy is positive and zone landmarks resolve off the LOS
// (see src/data/zones.ts).

import type { DefAssignment, DefensivePlayDef, RoleId } from '../../sim/types';

type Assignments = Partial<Record<RoleId, DefAssignment>>;

/** Standard four-man rush from a 4-3/nickel/dime front. */
function fourManRush(): Assignments {
  return {
    LE: { kind: 'rush', lane: 'edge-left', contain: true },
    DT1: { kind: 'rush', lane: 'interior-left' },
    DT2: { kind: 'rush', lane: 'interior-right' },
    RE: { kind: 'rush', lane: 'edge-right', contain: true },
  };
}

export const DEFENSIVE_PLAYS: readonly DefensivePlayDef[] = [
  // =========================================================================
  // 4-3 (LE DT1 DT2 RE LOLB MLB1 ROLB CB1 CB2 FS SS)
  // =========================================================================
  {
    id: '43-cover-3',
    name: '4-3 Cover 3 Sky',
    formationId: '43-base',
    shell: 'cover3',
    tags: ['zone'],
    assignments: {
      ...fourManRush(),
      LOLB: { kind: 'zone', zone: 'curlFlat-L' },
      MLB1: { kind: 'zone', zone: 'hook-M' },
      ROLB: { kind: 'zone', zone: 'hook-R' },
      CB1: { kind: 'zone', zone: 'deepThird-L' },
      CB2: { kind: 'zone', zone: 'deepThird-R' },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'curlFlat-R' }, // sky: strong safety rolls down
    },
  },
  {
    id: '43-cover-2',
    name: '4-3 Cover 2',
    formationId: '43-base',
    shell: 'cover2',
    tags: ['zone'],
    assignments: {
      ...fourManRush(),
      LOLB: { kind: 'zone', zone: 'curlFlat-L' },
      MLB1: { kind: 'zone', zone: 'hook-M' },
      ROLB: { kind: 'zone', zone: 'curlFlat-R' },
      CB1: { kind: 'zone', zone: 'flat-L' },
      CB2: { kind: 'zone', zone: 'flat-R' },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },
  {
    id: '43-cover-1',
    name: '4-3 Cover 1',
    formationId: '43-base',
    shell: 'cover1',
    tags: ['man'],
    assignments: {
      ...fourManRush(),
      LOLB: { kind: 'man', target: 'RB', leverage: 'inside', cushionYd: 3 },
      MLB1: { kind: 'zone', zone: 'hook-M' }, // rat in the hole
      ROLB: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 3 },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 5 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 5 },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'man', target: 'count-2-right', leverage: 'inside', cushionYd: 4 },
    },
  },
  {
    id: '43-cover-2-man',
    name: '4-3 Cover 2 Man',
    formationId: '43-base',
    shell: 'cover2man',
    tags: ['man'],
    assignments: {
      ...fourManRush(),
      LOLB: { kind: 'man', target: 'count-2-left', leverage: 'inside', cushionYd: 4 },
      MLB1: { kind: 'man', target: 'RB', leverage: 'inside', cushionYd: 3 },
      ROLB: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 3 },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'inside', cushionYd: 6 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'inside', cushionYd: 6 },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },
  {
    id: '43-run-commit',
    name: '4-3 Run Commit',
    formationId: '43-base',
    shell: 'cover1',
    tags: ['run-commit', 'man'],
    assignments: {
      LE: { kind: 'rush', lane: 'edge-left', contain: true },
      DT1: { kind: 'runFit', gap: 'A-left' },
      DT2: { kind: 'runFit', gap: 'A-right' },
      RE: { kind: 'rush', lane: 'edge-right', contain: true },
      LOLB: { kind: 'runFit', gap: 'C-left' },
      MLB1: { kind: 'runFit', gap: 'B-left' },
      ROLB: { kind: 'runFit', gap: 'C-right' },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 7 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 7 },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'runFit', gap: 'B-right' },
    },
  },

  // =========================================================================
  // 3-4 (LE DT1 RE LOLB MLB1 MLB2 ROLB CB1 CB2 FS SS)
  // =========================================================================
  {
    id: '34-cover-3',
    name: '3-4 Cover 3',
    formationId: '34-base',
    shell: 'cover3',
    tags: ['zone'],
    assignments: {
      LE: { kind: 'rush', lane: 'interior-left' },
      DT1: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'rush', lane: 'edge-right' },
      ROLB: { kind: 'rush', lane: 'edge-right', contain: true },
      LOLB: { kind: 'zone', zone: 'curlFlat-L' },
      MLB1: { kind: 'zone', zone: 'hook-M' },
      MLB2: { kind: 'zone', zone: 'hook-R' },
      CB1: { kind: 'zone', zone: 'deepThird-L' },
      CB2: { kind: 'zone', zone: 'deepThird-R' },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'curlFlat-R' },
    },
  },
  {
    id: '34-olb-fire',
    name: '3-4 OLB Fire',
    formationId: '34-base',
    shell: 'cover3',
    tags: ['blitz', 'zone'],
    assignments: {
      LE: { kind: 'rush', lane: 'interior-left' },
      DT1: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'rush', lane: 'edge-right' },
      LOLB: { kind: 'blitz', gap: 'C-left', timing: 'snap' },
      ROLB: { kind: 'blitz', gap: 'C-right', timing: 'snap' },
      MLB1: { kind: 'zone', zone: 'hook-M' },
      MLB2: { kind: 'zone', zone: 'curlFlat-R' },
      CB1: { kind: 'zone', zone: 'deepThird-L' },
      CB2: { kind: 'zone', zone: 'deepThird-R' },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'curlFlat-L' },
    },
  },
  {
    id: '34-cover-2-drop8',
    name: '3-4 Cover 2 Drop-8',
    formationId: '34-base',
    shell: 'cover2',
    tags: ['zone', 'prevent'],
    assignments: {
      LE: { kind: 'rush', lane: 'interior-left' },
      DT1: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'rush', lane: 'edge-right', contain: true },
      LOLB: { kind: 'zone', zone: 'flat-L' },
      ROLB: { kind: 'zone', zone: 'flat-R' },
      MLB1: { kind: 'zone', zone: 'hook-L' },
      MLB2: { kind: 'zone', zone: 'hook-R' },
      CB1: { kind: 'zone', zone: 'curlFlat-L' },
      CB2: { kind: 'zone', zone: 'curlFlat-R' },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },

  // =========================================================================
  // Nickel 4-2-5 (LE DT1 DT2 RE MLB1 MLB2 CB1 CB2 CB3 FS SS)
  // =========================================================================
  {
    id: 'nickel-cover-2',
    name: 'Nickel Cover 2',
    formationId: 'nickel-425',
    shell: 'cover2',
    tags: ['zone'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'zone', zone: 'hook-L' },
      MLB2: { kind: 'zone', zone: 'hook-M' },
      CB1: { kind: 'zone', zone: 'flat-L' },
      CB2: { kind: 'zone', zone: 'flat-R' },
      CB3: { kind: 'zone', zone: 'curlFlat-R' },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },
  {
    id: 'nickel-cover-3-match',
    name: 'Nickel Cover 3 Match',
    formationId: 'nickel-425',
    shell: 'cover3',
    tags: ['zone'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'zone', zone: 'hook-M' },
      MLB2: { kind: 'zone', zone: 'hook-R' },
      CB1: { kind: 'zone', zone: 'deepThird-L' },
      CB2: { kind: 'zone', zone: 'deepThird-R' },
      CB3: { kind: 'zone', zone: 'curlFlat-R' },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'curlFlat-L' },
    },
  },
  {
    id: 'nickel-cover-1-robber',
    name: 'Nickel Cover 1 Robber',
    formationId: 'nickel-425',
    shell: 'cover1',
    tags: ['man'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'man', target: 'RB', leverage: 'inside', cushionYd: 3 },
      MLB2: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 3 },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 6 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 6 },
      CB3: { kind: 'man', target: 'count-2-right', leverage: 'outside', cushionYd: 5 },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'hook-M' }, // robber sits on the dig window
    },
  },
  {
    id: 'nickel-double-a-gap',
    name: 'Nickel Double A-Gap',
    formationId: 'nickel-425',
    shell: 'cover1',
    tags: ['blitz', 'man'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'blitz', gap: 'A-left', timing: 'snap' },
      MLB2: { kind: 'blitz', gap: 'A-right', timing: 'snap' },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 5 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 5 },
      CB3: { kind: 'man', target: 'count-2-right', leverage: 'inside', cushionYd: 4 },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 4 },
    },
  },
  {
    id: 'nickel-fire-zone',
    name: 'Nickel Fire Zone',
    formationId: 'nickel-425',
    shell: 'cover3',
    tags: ['blitz', 'zone'],
    assignments: {
      LE: { kind: 'rush', lane: 'edge-left', contain: true },
      DT1: { kind: 'rush', lane: 'interior-left' },
      DT2: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'zone', zone: 'flat-R' }, // end drops into the vacated flat
      MLB1: { kind: 'blitz', gap: 'B-right', timing: 'snap' },
      MLB2: { kind: 'zone', zone: 'hook-M' },
      CB3: { kind: 'blitz', gap: 'D-right', timing: 'delayed' },
      CB1: { kind: 'zone', zone: 'deepThird-L' },
      CB2: { kind: 'zone', zone: 'deepThird-R' },
      FS: { kind: 'zone', zone: 'deepThird-M' },
      SS: { kind: 'zone', zone: 'curlFlat-L' },
    },
  },
  {
    id: 'nickel-cover-0-all-out',
    name: 'Nickel Cover 0 All-Out',
    formationId: 'nickel-425',
    shell: 'cover0',
    tags: ['blitz', 'man'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'blitz', gap: 'A-left', timing: 'snap' },
      MLB2: { kind: 'blitz', gap: 'A-right', timing: 'snap' },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'inside', cushionYd: 2 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'inside', cushionYd: 2 },
      CB3: { kind: 'man', target: 'count-2-right', leverage: 'inside', cushionYd: 2 },
      FS: { kind: 'man', target: 'RB', leverage: 'inside', cushionYd: 3 },
      SS: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 3 },
    },
  },

  // =========================================================================
  // Dime 4-1-6 (LE DT1 DT2 RE MLB1 CB1 CB2 CB3 CB4 FS SS)
  // =========================================================================
  {
    id: 'dime-quarters',
    name: 'Dime Quarters',
    formationId: 'dime-416',
    shell: 'cover4',
    tags: ['zone', 'prevent'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'zone', zone: 'hook-M' },
      CB1: { kind: 'zone', zone: 'deepQuarter-1' },
      CB3: { kind: 'zone', zone: 'curlFlat-L' },
      FS: { kind: 'zone', zone: 'deepQuarter-2' },
      SS: { kind: 'zone', zone: 'deepQuarter-3' },
      CB4: { kind: 'zone', zone: 'curlFlat-R' },
      CB2: { kind: 'zone', zone: 'deepQuarter-4' },
    },
  },
  {
    id: 'dime-cover-2-sink',
    name: 'Dime Cover 2 Sink',
    formationId: 'dime-416',
    shell: 'cover2',
    tags: ['zone', 'prevent'],
    assignments: {
      ...fourManRush(),
      MLB1: { kind: 'zone', zone: 'hook-M' },
      CB1: { kind: 'zone', zone: 'flat-L' },
      CB2: { kind: 'zone', zone: 'flat-R' },
      CB3: { kind: 'zone', zone: 'hook-L' },
      CB4: { kind: 'zone', zone: 'hook-R' },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },

  // =========================================================================
  // Goal line 5-3 (LOLB LE DT1 DT2 RE MLB1 MLB2 ROLB CB1 CB2 SS)
  // =========================================================================
  {
    id: 'gl-53-plug',
    name: 'GL 5-3 Plug',
    formationId: 'gl-53',
    shell: 'goalLine',
    tags: ['run-commit'],
    assignments: {
      LOLB: { kind: 'rush', lane: 'edge-left', contain: true },
      LE: { kind: 'runFit', gap: 'B-left' },
      DT1: { kind: 'runFit', gap: 'A-left' },
      DT2: { kind: 'runFit', gap: 'A-right' },
      RE: { kind: 'rush', lane: 'edge-right', contain: true },
      MLB1: { kind: 'runFit', gap: 'C-left' },
      MLB2: { kind: 'runFit', gap: 'B-right' },
      ROLB: { kind: 'runFit', gap: 'C-right' },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 3 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 3 },
      SS: { kind: 'runFit', gap: 'D-right' },
    },
  },
  {
    id: 'gl-man-heavy',
    name: 'GL Man Heavy',
    formationId: 'gl-53',
    shell: 'goalLine',
    tags: ['man'],
    assignments: {
      LOLB: { kind: 'rush', lane: 'edge-left', contain: true },
      LE: { kind: 'rush', lane: 'interior-left' },
      DT1: { kind: 'rush', lane: 'interior-left' },
      DT2: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'rush', lane: 'edge-right', contain: true },
      MLB1: { kind: 'man', target: 'RB', leverage: 'inside', cushionYd: 2 },
      MLB2: { kind: 'man', target: 'TE2', leverage: 'inside', cushionYd: 2 },
      ROLB: { kind: 'man', target: 'TE1', leverage: 'inside', cushionYd: 2 },
      CB1: { kind: 'man', target: 'count-1-left', leverage: 'outside', cushionYd: 3 },
      CB2: { kind: 'man', target: 'count-1-right', leverage: 'outside', cushionYd: 3 },
      SS: { kind: 'man', target: 'count-2-right', leverage: 'inside', cushionYd: 3 },
    },
  },

  // =========================================================================
  // Special teams
  // =========================================================================
  {
    id: 'st-kick-return-unit',
    name: 'Kick Return',
    formationId: 'st-kick-return',
    shell: 'specialTeams',
    tags: ['contain'],
    assignments: {
      LE: { kind: 'returnBlock' }, DT1: { kind: 'returnBlock' }, DT2: { kind: 'returnBlock' },
      RE: { kind: 'returnBlock' }, LOLB: { kind: 'returnBlock' },
      MLB1: { kind: 'returnBlock' }, MLB2: { kind: 'returnBlock' }, ROLB: { kind: 'returnBlock' },
      CB1: { kind: 'returnBlock' }, CB2: { kind: 'returnBlock' },
      KR: { kind: 'returner' },
    },
  },
  {
    id: 'st-punt-return-unit',
    name: 'Punt Return',
    formationId: 'st-punt-return',
    shell: 'specialTeams',
    tags: ['contain'],
    assignments: {
      LE: { kind: 'rush', lane: 'edge-left' },
      DT1: { kind: 'rush', lane: 'interior-left' },
      DT2: { kind: 'rush', lane: 'interior-right' },
      RE: { kind: 'rush', lane: 'edge-right' },
      LOLB: { kind: 'returnBlock' }, ROLB: { kind: 'returnBlock' },
      CB1: { kind: 'returnBlock' }, CB2: { kind: 'returnBlock' },
      MLB1: { kind: 'returnBlock' }, MLB2: { kind: 'returnBlock' },
      PR: { kind: 'returner' },
    },
  },
  {
    id: 'st-fg-block-unit',
    name: 'FG Block',
    formationId: 'st-fg-block',
    shell: 'specialTeams',
    tags: [],
    assignments: {
      LE: { kind: 'rush', lane: 'edge-left' },
      DT1: { kind: 'rush', lane: 'interior-left' },
      DT2: { kind: 'rush', lane: 'interior-left' },
      RE: { kind: 'rush', lane: 'interior-right' },
      LOLB: { kind: 'rush', lane: 'edge-right' },
      MLB1: { kind: 'runFit', gap: 'A-left' },
      MLB2: { kind: 'runFit', gap: 'A-right' },
      CB1: { kind: 'rush', lane: 'edge-left', contain: true },
      CB2: { kind: 'rush', lane: 'edge-right', contain: true },
      FS: { kind: 'zone', zone: 'deepHalf-L' },
      SS: { kind: 'zone', zone: 'deepHalf-R' },
    },
  },
];

/** Play ids in fixed order — for deterministic iteration by callers. */
export const DEFENSIVE_PLAY_IDS: readonly string[] = DEFENSIVE_PLAYS.map((p) => p.id);
