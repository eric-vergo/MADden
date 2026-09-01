// THE termination + determinism contract for the whole sim core: a full
// CPU-vs-CPU game must always reach GAME_OVER inside the tick cap with an
// internally consistent box score, and the same seed must replay identically.

import { describe, expect, it } from 'vitest';
import { runHeadlessGame, type HeadlessGameResult } from '../harness/headlessGame';
import { GamePhase } from '../../src/sim/types';

const SEEDS = [1, 7, 1234, 90210, 555_555];

function summarise(r: HeadlessGameResult): string {
  return `seed game: ${r.finalScore[0]}-${r.finalScore[1]} in ${r.ticksElapsed} ticks`;
}

describe('headless CPU-vs-CPU games always terminate', () => {
  const results = new Map<number, HeadlessGameResult>();
  for (const seed of SEEDS) results.set(seed, runHeadlessGame({ seed }));

  for (const seed of SEEDS) {
    const r = results.get(seed) as HeadlessGameResult;

    it(`seed ${seed} reaches GAME_OVER inside the tick cap`, () => {
      expect(r.hitTickCap, summarise(r)).toBe(false);
      expect(r.state.phase).toBe(GamePhase.GAME_OVER);
      expect(r.ticksElapsed).toBeGreaterThan(60 * 60); // a real game, not a stub
    });

    it(`seed ${seed} consumes the whole game clock`, () => {
      // Either regulation ran out, or overtime ended it early on a score.
      if (r.state.quarter <= 4) expect(r.state.clockSec).toBe(0);
      else expect(r.state.quarter).toBeGreaterThanOrEqual(5);
      expect(r.state.quarter).toBeGreaterThanOrEqual(4);
      const ends = r.events.filter((e) => e.type === 'QUARTER_END');
      expect(ends.length).toBeGreaterThanOrEqual(4);
    });

    it(`seed ${seed} has a consistent score and box score`, () => {
      for (const t of [0, 1] as const) {
        const line = r.state.stats.scoringByQuarter[t];
        expect(line.length).toBeGreaterThanOrEqual(4);
        expect(line.reduce((a, b) => a + b, 0)).toBe(r.finalScore[t]);
        expect(r.state.stats.teams[t].points).toBe(r.finalScore[t]);
        for (const v of line) expect(Number.isFinite(v)).toBe(true);
      }
      const gameOver = r.events.filter((e) => e.type === 'GAME_OVER');
      expect(gameOver.length).toBe(1);
      if (gameOver[0]?.type === 'GAME_OVER') {
        expect(gameOver[0].finalScore).toEqual(r.finalScore);
      }
      // A tie can only stand when the config allows it.
      if (r.finalScore[0] === r.finalScore[1]) expect(r.state.config.allowTies).toBe(true);
    });

    it(`seed ${seed} produces a finite hash and a real play log`, () => {
      expect(Number.isNaN(r.finalHash)).toBe(false);
      expect(Number.isFinite(r.finalHash)).toBe(true);
      expect(r.state.playLog.length).toBeGreaterThan(10);
      const results = r.events.filter((e) => e.type === 'PLAY_RESULT');
      expect(r.state.playLog.length).toBe(results.length);
      for (const entry of r.state.playLog) {
        expect(Number.isFinite(entry.yards)).toBe(true);
        expect(Number.isFinite(entry.ballOnY)).toBe(true);
        expect(entry.down).toBeGreaterThanOrEqual(1);
        expect(entry.down).toBeLessThanOrEqual(4);
        expect(entry.offensePlayId.length).toBeGreaterThan(0);
        expect(entry.defensePlayId.length).toBeGreaterThan(0);
      }
    });

    it(`seed ${seed} keeps every team and player stat finite`, () => {
      for (const t of [0, 1] as const) {
        const team = r.state.stats.teams[t];
        for (const [key, value] of Object.entries(team).sort()) {
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${key} is not finite`).toBe(true);
          }
        }
        expect(team.thirdDownConv).toBeLessThanOrEqual(team.thirdDownAtt);
        expect(team.topSeconds).toBeGreaterThan(0);
      }
      const ids = Object.keys(r.state.stats.players).sort();
      for (const id of ids) {
        const p = r.state.stats.players[id];
        expect(p).toBeDefined();
        if (p === undefined) continue;
        for (const [key, value] of Object.entries(p).sort()) {
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${id}.${key} is not finite`).toBe(true);
          }
        }
        expect(p.passCmp).toBeLessThanOrEqual(p.passAtt);
        expect(p.rec).toBeLessThanOrEqual(p.tgt);
        expect(p.fgm).toBeLessThanOrEqual(p.fga);
        expect(p.xpm).toBeLessThanOrEqual(p.xpa);
      }
      // Time of possession splits the whole regulation-plus-overtime clock.
      const top = r.state.stats.teams[0].topSeconds + r.state.stats.teams[1].topSeconds;
      expect(top).toBeGreaterThan(0);
      expect(Number.isFinite(top)).toBe(true);
    });

    it(`seed ${seed} never leaves the field or the down box`, () => {
      expect(r.state.ballOnY).toBeGreaterThanOrEqual(0);
      expect(r.state.ballOnY).toBeLessThanOrEqual(120);
      for (const t of [0, 1] as const) {
        expect(r.state.timeouts[t]).toBeGreaterThanOrEqual(0);
        expect(r.state.timeouts[t]).toBeLessThanOrEqual(3);
      }
    });
  }

  it('the same seed replays event-for-event', () => {
    for (const seed of [1, 7, 1234]) {
      const a = runHeadlessGame({ seed });
      const b = runHeadlessGame({ seed });
      expect(a.ticksElapsed).toBe(b.ticksElapsed);
      expect(a.finalHash).toBe(b.finalHash);
      expect(a.finalScore).toEqual(b.finalScore);
      expect(a.events.length).toBe(b.events.length);
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
      expect(JSON.stringify(a.state.playLog)).toBe(JSON.stringify(b.state.playLog));
      expect(JSON.stringify(a.state.stats)).toBe(JSON.stringify(b.state.stats));
    }
  });

  it('different seeds produce different games', () => {
    const hashes = new Set(SEEDS.map((seed) => (results.get(seed) as HeadlessGameResult).finalHash));
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('short-quarter games terminate too', () => {
    for (const seed of [3, 4]) {
      const r = runHeadlessGame({ seed, quarterLengthSec: 60 });
      expect(r.hitTickCap).toBe(false);
      expect(r.state.phase).toBe(GamePhase.GAME_OVER);
      expect(r.state.playLog.length).toBeGreaterThan(0);
    }
  });

  it('every play produces exactly one whistle and one result', () => {
    const r = results.get(SEEDS[0] as number) as HeadlessGameResult;
    const snaps = r.events.filter((e) => e.type === 'SNAP').length;
    const whistles = r.events.filter((e) => e.type === 'WHISTLE').length;
    const plays = r.events.filter((e) => e.type === 'PLAY_RESULT').length;
    expect(whistles).toBe(snaps);
    expect(plays).toBe(snaps);
  });
});
