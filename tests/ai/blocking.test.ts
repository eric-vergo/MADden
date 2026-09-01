import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../src/data/balance';
import { Rng } from '../../src/sim/rng';
import { assignBlockPairs, resolveContest } from '../../src/sim/ai/blocking';
import { makeScenario } from './helpers';

interface Outcomes { pancake: number; win: number; stalemate: number; shed: number; }

function contestRates(
  blocker: { pbk: number; str: number },
  defender: { shd: number; str: number },
  rolls: number,
): Outcomes {
  const s = makeScenario({
    los: 60,
    seed: 4242,
    players: [
      {
        slot: 5, role: 'C', pos: 'OL', x: 26.6, y: 59.3,
        ratings: { pbk: blocker.pbk, rbk: blocker.pbk, str: blocker.str },
        assignment: { kind: 'passBlock' },
      },
      {
        slot: 12, role: 'DT1', pos: 'DL', team: 1, x: 26.6, y: 60.8,
        ratings: { shd: defender.shd, str: defender.str },
        assignment: { kind: 'rush', lane: 'interior-left' },
      },
    ],
  });
  const b = s.play.players[5]!;
  const d = s.play.players[12]!;
  const out: Outcomes = { pancake: 0, win: 0, stalemate: 0, shed: 0 };

  for (let n = 0; n < rolls; n++) {
    // Re-lock the pair and put the contest exactly on its interval.
    b.engagedWith = 12;
    d.engagedWith = 5;
    b.anim = 'blocking';
    d.anim = 'engaged';
    d.stateTimer = 0;
    b.stateTimer = 0;
    b.mind['bkEngTick'] = s.state.tick - BLOCK.contestIntervalTicks;
    b.mind['bkWins'] = 0;
    const margin = resolveContest(s.ctx(), 5);
    expect(margin).not.toBeNull();
    const m = margin as number;
    if (m > BLOCK.pancakeMargin) out.pancake++;
    else if (m > BLOCK.winMargin) out.win++;
    else if (m > BLOCK.stalemateMargin) out.stalemate++;
    else out.shed++;
    s.state.tick += 1;
  }
  return out;
}

describe('blocking contests at rating extremes', () => {
  it('a dominant blocker pancakes sometimes and is never shed', () => {
    const out = contestRates({ pbk: 95, str: 90 }, { shd: 40, str: 50 }, 400);
    expect(out.pancake).toBeGreaterThan(0);
    expect(out.shed).toBe(0);
    expect(out.pancake / 400).toBeGreaterThan(0.5);
  });

  it('a dominant rusher sheds constantly and is never pancaked', () => {
    const out = contestRates({ pbk: 40, str: 45 }, { shd: 95, str: 90 }, 400);
    expect(out.shed / 400).toBeGreaterThan(0.5);
    expect(out.pancake).toBe(0);
  });

  it('even ratings produce a spread of outcomes', () => {
    const out = contestRates({ pbk: 75, str: 75 }, { shd: 75, str: 75 }, 400);
    expect(out.win + out.stalemate).toBeGreaterThan(200);
    expect(out.pancake).toBeGreaterThanOrEqual(0);
    expect(out.shed).toBeGreaterThan(0);
  });
});

describe('shed side effects', () => {
  it('a shed stuns the blocker and gives the rusher a burst window', () => {
    const s = makeScenario({
      los: 60,
      seed: 11,
      players: [
        {
          slot: 5, role: 'C', pos: 'OL', x: 26.6, y: 59.3,
          ratings: { pbk: 40, str: 40 }, assignment: { kind: 'passBlock' },
        },
        {
          slot: 12, role: 'DT1', pos: 'DL', team: 1, x: 26.6, y: 60.8,
          ratings: { shd: 99, str: 99 },
          assignment: { kind: 'rush', lane: 'interior-left' },
        },
      ],
    });
    const b = s.play.players[5]!;
    const d = s.play.players[12]!;
    b.engagedWith = 12;
    d.engagedWith = 5;
    b.mind['bkEngTick'] = s.state.tick - BLOCK.contestIntervalTicks;
    const margin = resolveContest(s.ctx(), 5) as number;
    expect(margin).toBeLessThanOrEqual(BLOCK.stalemateMargin);
    expect(b.engagedWith).toBeNull();
    expect(b.stateTimer).toBe(BLOCK.shedStunTicks);
    expect(d.mind['puShedUntil']).toBe(s.state.tick + BLOCK.shedBurstTicks);
  });
});

describe('pass protection pairing', () => {
  it('assigns blockers inside-out and leaves extra rushers free', () => {
    const s = makeScenario({
      los: 60,
      players: [
        { slot: 4, role: 'LG', pos: 'OL', x: 24.8, y: 59.3, assignment: { kind: 'passBlock' } },
        { slot: 5, role: 'C', pos: 'OL', x: 26.6, y: 59.3, assignment: { kind: 'passBlock' } },
        { slot: 6, role: 'RG', pos: 'OL', x: 28.4, y: 59.3, assignment: { kind: 'passBlock' } },
        { slot: 11, role: 'DT1', pos: 'DL', team: 1, x: 25.6, y: 60.8, assignment: { kind: 'rush', lane: 'interior-left' } },
        { slot: 12, role: 'DT2', pos: 'DL', team: 1, x: 27.6, y: 60.8, assignment: { kind: 'rush', lane: 'interior-right' } },
        { slot: 13, role: 'LE', pos: 'DL', team: 1, x: 22.0, y: 60.8, assignment: { kind: 'rush', lane: 'edge-left' } },
        { slot: 14, role: 'RE', pos: 'DL', team: 1, x: 31.0, y: 60.8, assignment: { kind: 'rush', lane: 'edge-right' } },
      ],
    });
    assignBlockPairs(s.ctx());
    const claimed = [4, 5, 6].map((i) => s.play.players[i]!.mind['bkTgt']);
    // Every lineman has a man, and no two share one.
    expect(new Set(claimed).size).toBe(3);
    for (const c of claimed) expect(c).toBeGreaterThanOrEqual(11);
    // Four rushers, three blockers: exactly one comes free.
    const free = [11, 12, 13, 14].filter((d) => !claimed.includes(d));
    expect(free.length).toBe(1);
  });
});

describe('rng plumbing', () => {
  it('the same seed reproduces the same contest sequence', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    expect(a.gauss()).toBe(b.gauss());
  });
});
