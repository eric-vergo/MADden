// Scripted passing-game fixtures for the CPU QB tests.

import type { ScenarioOpts } from './helpers';

const LOS = 60;

function qbSpec(): ScenarioOpts['players'][number] {
  return {
    slot: 0, role: 'QB', pos: 'QB', x: 26.6, y: 55,
    ratings: { spd: 70, awr: 75, thp: 85, tha: 85 },
    assignment: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
    hasBall: false,
  };
}

const ROUTE = {
  kind: 'route' as const,
  route: { waypoints: [{ dx: 0, dy: 10, breakStyle: 'sharp' as const }] },
};

function base(): ScenarioOpts {
  return {
    los: LOS,
    difficulty: 'allPro',
    seed: 17,
    offensePlay: {
      type: 'pass',
      qbProgression: ['WR1', 'WR2', 'WR3'],
      checkdown: 'RB',
    },
    players: [],
  };
}

/** WR1 blanketed, WR2 wide open, WR3 blanketed. */
export function openSecondRead(): ScenarioOpts {
  const o = base();
  o.players = [
    qbSpec(),
    { slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 70, assignment: ROUTE },
    { slot: 2, role: 'WR2', pos: 'WR', x: 22, y: 68, assignment: ROUTE },
    { slot: 3, role: 'WR3', pos: 'WR', x: 40, y: 70, assignment: ROUTE },
    { slot: 5, role: 'RB', pos: 'RB', x: 29, y: 56, assignment: { kind: 'passProScan' } },
    {
      slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 12.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR1', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 12, role: 'CB2', pos: 'CB', team: 1, x: 40.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR3', leverage: 'outside', cushionYd: 2 },
    },
  ];
  return o;
}

/** Every progression read covered; the back leaks out wide open. */
export function allCovered(): ScenarioOpts {
  const o = base();
  o.players = [
    qbSpec(),
    { slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 70, assignment: ROUTE },
    { slot: 2, role: 'WR2', pos: 'WR', x: 22, y: 70, assignment: ROUTE },
    { slot: 3, role: 'WR3', pos: 'WR', x: 40, y: 70, assignment: ROUTE },
    { slot: 5, role: 'RB', pos: 'RB', x: 34, y: 62, assignment: { kind: 'passProScan' } },
    {
      slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 12.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR1', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 12, role: 'CB2', pos: 'CB', team: 1, x: 22.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR2', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 13, role: 'CB3', pos: 'CB', team: 1, x: 40.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR3', leverage: 'outside', cushionYd: 2 },
    },
  ];
  return o;
}

/** A free rusher in the QB's lap with a clean escape lane to his left. */
export function pressured(): ScenarioOpts {
  const o = base();
  o.players = [
    {
      slot: 0, role: 'QB', pos: 'QB', x: 26.6, y: 55,
      ratings: { spd: 88, acc: 85, awr: 75, thp: 85 },
      assignment: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
    },
    { slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 70, assignment: ROUTE },
    { slot: 2, role: 'WR2', pos: 'WR', x: 22, y: 70, assignment: ROUTE },
    { slot: 3, role: 'WR3', pos: 'WR', x: 40, y: 70, assignment: ROUTE },
    {
      slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 12.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR1', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 12, role: 'CB2', pos: 'CB', team: 1, x: 22.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR2', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 13, role: 'CB3', pos: 'CB', team: 1, x: 40.4, y: 70.3,
      assignment: { kind: 'man', target: 'WR3', leverage: 'outside', cushionYd: 2 },
    },
    {
      slot: 14, role: 'RE', pos: 'DL', team: 1, x: 27.2, y: 55.2,
      ratings: { spd: 40, acc: 40 },
      assignment: { kind: 'rush', lane: 'edge-right' },
    },
  ];
  return o;
}

/** A zone defender sitting on the throwing lane kills the read. */
export function deadRead(): ScenarioOpts {
  const o = base();
  o.players = [
    qbSpec(),
    { slot: 1, role: 'WR1', pos: 'WR', x: 20, y: 72, assignment: ROUTE },
    {
      slot: 11, role: 'FS', pos: 'S', team: 1, x: 20.6, y: 72.4,
      ratings: { spd: 95, acc: 95 },
      assignment: { kind: 'zone', zone: 'deepThird-M' },
    },
  ];
  return o;
}

export const PlayerSpecs = { openSecondRead, allCovered, pressured, deadRead };
