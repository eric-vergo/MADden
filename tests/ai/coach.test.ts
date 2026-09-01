import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/sim/GameSim';
import { GamePhase, type Difficulty, type GameConfig, type GameState } from '../../src/sim/types';
import { Rng } from '../../src/sim/rng';
import { getDefensivePlay, getOffensivePlay } from '../../src/data/plays/index';
import { cpuCallPlay } from '../../src/sim/ai/index';
import { bucketOf, fourthDownChoice, situationOf, shouldKneel } from '../../src/sim/ai/coach';
import { makeTestRoster } from '../harness/fixtures';

function state(over: Partial<GameState> = {}, difficulty: Difficulty = 'allPro'): GameState {
  const config: GameConfig = {
    quarterLengthSec: 300,
    difficulty,
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
  };
  const s = createInitialState(config, [makeTestRoster('HOM', 3), makeTestRoster('AWY', 4)], 3);
  s.phase = GamePhase.PLAY_CALL;
  s.nextPlayKind = 'normal';
  s.possession = 0;
  return Object.assign(s, over);
}

function sample(s: GameState, n: number): string[] {
  const out: string[] = [];
  const rng = new Rng(1234);
  for (let i = 0; i < n; i++) out.push(cpuCallPlay(s, 0, 'offense', rng));
  return out;
}

function typeOf(id: string): string {
  return getOffensivePlay(id)?.type ?? 'unknown';
}

function isPassy(id: string): boolean {
  const t = typeOf(id);
  return t === 'pass' || t === 'playAction' || t === 'screen';
}

describe('coach: situation buckets', () => {
  it('classifies the standard down-and-distance cases', () => {
    expect(bucketOf(situationOf(state({ down: 1, toGo: 10, ballOnY: 50 }), 0))).toBe('1st-10');
    expect(bucketOf(situationOf(state({ down: 3, toGo: 1, ballOnY: 50 }), 0))).toBe('3rd-short');
    expect(bucketOf(situationOf(state({ down: 3, toGo: 12, ballOnY: 50 }), 0))).toBe('3rd-long');
    expect(bucketOf(situationOf(state({ down: 2, toGo: 2, ballOnY: 50 }), 0))).toBe('2nd-short');
    expect(bucketOf(situationOf(state({ down: 1, toGo: 10, ballOnY: 95 }), 0))).toBe('red-zone');
    expect(bucketOf(situationOf(state({ down: 2, toGo: 3, ballOnY: 108 }), 0))).toBe('goal-to-go');
  });
});

describe('coach: run/pass balance by situation', () => {
  it('3rd-and-1 heavily favors runs', () => {
    const picks = sample(state({ down: 3, toGo: 1, ballOnY: 50 }), 300);
    const runs = picks.filter((p) => typeOf(p) === 'run').length;
    expect(runs / picks.length).toBeGreaterThan(0.6);
  });

  it('3rd-and-12 goes to the passing game', () => {
    const picks = sample(state({ down: 3, toGo: 12, ballOnY: 50 }), 300);
    const passes = picks.filter(isPassy).length;
    expect(passes / picks.length).toBeGreaterThan(0.9);
  });

  it('leading in the four-minute offense runs more than on 1st-and-10', () => {
    const fourMin = sample(
      state({ down: 1, toGo: 10, ballOnY: 50, quarter: 4, clockSec: 200, score: [21, 14] }),
      300,
    );
    const neutral = sample(state({ down: 1, toGo: 10, ballOnY: 50 }), 300);
    const rate = (ps: string[]): number => ps.filter((p) => typeOf(p) === 'run').length / ps.length;
    expect(rate(fourMin)).toBeGreaterThan(rate(neutral));
  });
});

describe('coach: clock management', () => {
  it('kneels out a late lead', () => {
    const s = state({
      down: 1, toGo: 10, ballOnY: 50, quarter: 4, clockSec: 60,
      score: [24, 17], timeouts: [3, 0],
    });
    expect(shouldKneel(s, 0, situationOf(s, 0))).toBe(true);
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(9)))).toBe('kneel');
  });

  it('does not kneel while trailing', () => {
    const s = state({
      down: 1, toGo: 10, ballOnY: 50, quarter: 4, clockSec: 60,
      score: [17, 24], timeouts: [3, 0],
    });
    expect(shouldKneel(s, 0, situationOf(s, 0))).toBe(false);
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(9)))).not.toBe('kneel');
  });

  it('does not kneel with too much time on the clock', () => {
    const s = state({
      down: 1, toGo: 10, ballOnY: 50, quarter: 4, clockSec: 400,
      score: [24, 17], timeouts: [3, 3],
    });
    expect(shouldKneel(s, 0, situationOf(s, 0))).toBe(false);
  });
});

describe('coach: fourth down', () => {
  it('punts from its own territory', () => {
    const s = state({ down: 4, toGo: 8, ballOnY: 40 }); // own 30
    const sit = situationOf(s, 0);
    expect(sit.yardsToGoal).toBe(70);
    expect(fourthDownChoice(s, 0, sit, 'allPro')).toBe('punt');
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(2)))).toBe('punt');
  });

  it('kicks the field goal in range', () => {
    const s = state({ down: 4, toGo: 6, ballOnY: 90 }); // opponent 20
    const sit = situationOf(s, 0);
    expect(fourthDownChoice(s, 0, sit, 'allPro')).toBe('fg');
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(2)))).toBe('fieldGoal');
  });

  it('goes for it on 4th-and-1 in plus territory', () => {
    const s = state({ down: 4, toGo: 1, ballOnY: 78 }); // opponent 32
    expect(fourthDownChoice(s, 0, situationOf(s, 0), 'allPro')).toBe('go');
  });

  it('is more conservative on rookie than on all-madden', () => {
    const s = state({ down: 4, toGo: 5, ballOnY: 78 });
    const sit = situationOf(s, 0);
    expect(fourthDownChoice(s, 0, sit, 'rookie')).not.toBe('go');
    expect(fourthDownChoice(s, 0, sit, 'allMadden')).toBe('go');
  });

  it('goes for it when trailing late and out of range', () => {
    const s = state({
      down: 4, toGo: 9, ballOnY: 45, quarter: 4, clockSec: 100, score: [10, 17],
    });
    expect(fourthDownChoice(s, 0, situationOf(s, 0), 'allPro')).toBe('go');
  });
});

describe('coach: special situations', () => {
  it('calls a kickoff when one is pending', () => {
    const s = state({ nextPlayKind: 'kickoff' });
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(5)))).toBe('kickoff');
  });

  it('kicks the extra point in a normal PAT spot', () => {
    const s = state({ nextPlayKind: 'pat', quarter: 2, score: [7, 0] });
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(5)))).toBe('extraPoint');
  });

  it('goes for two when the classic chart says so', () => {
    // Down 2 late: 14-16 before the PAT.
    const s = state({ nextPlayKind: 'pat', quarter: 4, clockSec: 120, score: [14, 16] });
    expect(typeOf(cpuCallPlay(s, 0, 'offense', new Rng(5)))).toBe('twoPoint');
  });

  it('picks the matching return unit on defense', () => {
    const s = state({ nextPlayKind: 'kickoff' });
    const id = cpuCallPlay(s, 1, 'defense', new Rng(5));
    expect(id).toBe('st-kick-return-unit');
  });

  it('picks the punt return unit against a punt', () => {
    const s = state({ nextPlayKind: 'normal', selectedOffensePlayId: 'punt-deep' });
    expect(cpuCallPlay(s, 1, 'defense', new Rng(5))).toBe('st-punt-return-unit');
  });

  it('picks a scrimmage defense on a normal down', () => {
    const s = state({ down: 1, toGo: 10, ballOnY: 50 });
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const id = cpuCallPlay(s, 1, 'defense', rng);
      const play = getDefensivePlay(id);
      expect(play, `unknown defensive play ${id}`).toBeDefined();
      expect(play?.shell).not.toBe('specialTeams');
    }
  });
});

describe('coach: determinism', () => {
  it('the same seed and state produce the same call', () => {
    const s = state({ down: 1, toGo: 10, ballOnY: 50 });
    const a = cpuCallPlay(s, 0, 'offense', new Rng(77));
    const b = cpuCallPlay(s, 0, 'offense', new Rng(77));
    expect(a).toBe(b);
  });

  it('per-game memory is derived from the play log, not module state', () => {
    const s = state({ down: 1, toGo: 10, ballOnY: 50 });
    const before = cpuCallPlay(s, 0, 'offense', new Rng(77));
    s.playLog.push({
      tick: 10, quarter: 1, clockSec: 280, down: 1, toGo: 10, ballOnY: 50,
      possession: 0, offensePlayId: 'gun-inside-zone', defensePlayId: '43-cover-3',
      text: '', yards: 14, scoring: false, turnover: false,
    });
    // Same rng seed, richer memory: the call is still a pure function of state.
    const again = cpuCallPlay(s, 0, 'offense', new Rng(77));
    const repeat = cpuCallPlay(s, 0, 'offense', new Rng(77));
    expect(again).toBe(repeat);
    expect(typeof before).toBe('string');
  });
});
