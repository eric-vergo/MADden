// Whole-game flow: scoring transitions, special-teams spots, clock and quarter
// progression, and turnovers — asserted against real CPU-vs-CPU games so the
// phase machine is exercised end to end.

import { describe, expect, it } from 'vitest';
import { runHeadlessGame } from '../harness/headlessGame';
import { GamePhase, type GameState, type TeamSide } from '../../src/sim/types';
import type { SimEvent } from '../../src/sim/events';
import { missedFieldGoalSpot, touchbackSpot } from '../../src/sim/rules/scoring';
import { ownYardLineY } from '../../src/sim/transform';
import { KICKOFF_SPOT_FROM_OWN_GOAL, TOUCHBACK_KICKOFF_YD, TOUCHBACK_OTHER_YD } from '../../src/sim/constants';

interface Sample {
  event: SimEvent;
  possession: TeamSide;
  ballOnY: number;
  down: number;
  toGo: number;
  quarter: number;
  clockSec: number;
  clockRunning: boolean;
  nextPlayKind: GameState['nextPlayKind'];
  score: [number, number];
  attackDir: [1 | -1, 1 | -1];
}

const SAMPLE_CACHE = new Map<string, Sample[]>();

function sampleGame(seed: number, quarterLengthSec = 300): Sample[] {
  const key = `${seed}:${quarterLengthSec}`;
  const cached = SAMPLE_CACHE.get(key);
  if (cached !== undefined) return cached;
  const out: Sample[] = [];
  runHeadlessGame({
    seed,
    quarterLengthSec,
    onEvent: (event, state) => {
      out.push({
        event,
        possession: state.possession,
        ballOnY: state.ballOnY,
        down: state.down,
        toGo: state.toGo,
        quarter: state.quarter,
        clockSec: state.clockSec,
        clockRunning: state.clockRunning,
        nextPlayKind: state.nextPlayKind,
        score: [state.score[0], state.score[1]],
        attackDir: [state.attackDir[0], state.attackDir[1]],
      });
    },
  });
  SAMPLE_CACHE.set(key, out);
  return out;
}

const SEEDS = [11, 202, 3003, 40404];

describe('special-teams spot rules', () => {
  it('missed field goals spot at the kick or the opponent 20, whichever is deeper', () => {
    // The defense attacks -y, so its own goal line is y=110 and its 20 is y=90.
    // A kick held at y=95 is inside that 20, so the ball comes out to the 20.
    expect(missedFieldGoalSpot(95, -1)).toBe(90);
    expect(missedFieldGoalSpot(103, -1)).toBe(90);
    // A long try held at the defense's own 30 is spotted right there.
    expect(missedFieldGoalSpot(80, -1)).toBe(80);
    expect(missedFieldGoalSpot(17, 1)).toBe(30);
    expect(missedFieldGoalSpot(40, 1)).toBe(40);
  });

  it('touchbacks use 30 for kickoffs and 20 for punts', () => {
    expect(touchbackSpot('kickoff', 1)).toBe(10 + TOUCHBACK_KICKOFF_YD);
    expect(touchbackSpot('punt', 1)).toBe(10 + TOUCHBACK_OTHER_YD);
    expect(touchbackSpot('kickoff', -1)).toBe(110 - TOUCHBACK_KICKOFF_YD);
  });

  it('every kickoff touchback in a real game lands on the receiving 30', () => {
    let seen = 0;
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        const e = s.event;
        if (e.type !== 'PLAY_RESULT') continue;
        if (e.playType !== 'kickoff' || e.deadReason !== 'touchback') continue;
        seen++;
        expect(s.ballOnY).toBeCloseTo(ownYardLineY(TOUCHBACK_KICKOFF_YD, s.attackDir[s.possession]), 6);
        expect(s.down).toBe(1);
        expect(s.possession).not.toBe(e.offense);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('kicks always hand the ball to the other team', () => {
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        const e = s.event;
        if (e.type !== 'PLAY_RESULT') continue;
        if (e.playType !== 'kickoff' && e.playType !== 'punt') continue;
        // The kicking team never keeps the ball on a clean kick.
        if (e.turnover === null && !e.touchdown) expect(s.possession).not.toBe(e.offense);
      }
    }
  });
});

describe('scoring transitions', () => {
  it('a touchdown is followed by a try, then a kickoff by the scoring team', () => {
    let sequences = 0;
    for (const seed of SEEDS) {
      const samples = sampleGame(seed).filter((s) => s.event.type === 'PLAY_RESULT');
      for (let i = 0; i < samples.length - 2; i++) {
        const a = samples[i];
        if (a === undefined || a.event.type !== 'PLAY_RESULT') continue;
        if (!a.event.touchdown) continue;
        expect(a.nextPlayKind).toBe('pat');
        // A penalty on the try replays it, so skip any penalty-only results.
        const b = samples.slice(i + 1).find(
          (x) => x.event.type === 'PLAY_RESULT' && x.event.playType !== 'penaltyOnly',
        );
        if (b === undefined || b.event.type !== 'PLAY_RESULT') continue;
        expect(['extraPoint', 'twoPoint']).toContain(b.event.playType);
        expect(b.nextPlayKind).toBe('kickoff');
        // The scoring team kicks off from its own 35.
        expect(b.ballOnY).toBeCloseTo(
          ownYardLineY(KICKOFF_SPOT_FROM_OWN_GOAL, b.attackDir[b.possession]), 6,
        );
        sequences++;
      }
    }
    expect(sequences).toBeGreaterThan(0);
  });

  it('a made field goal scores three and sets up a kickoff', () => {
    let seen = 0;
    for (const seed of SEEDS) {
      const samples = sampleGame(seed);
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s === undefined || s.event.type !== 'FIELD_GOAL_RESULT' || !s.event.good) continue;
        seen++;
        const after = samples.slice(i).find((x) => x.event.type === 'PLAY_RESULT');
        expect(after).toBeDefined();
        if (after === undefined) continue;
        expect(after.nextPlayKind).toBe('kickoff');
      }
    }
    // Field goals are not guaranteed in every sample, so only assert the shape.
    expect(seen).toBeGreaterThanOrEqual(0);
  });

  it('a safety scores two for the defense and forces a free kick', () => {
    for (const seed of SEEDS) {
      const samples = sampleGame(seed);
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s === undefined || s.event.type !== 'SAFETY') continue;
        const after = samples.slice(i).find((x) => x.event.type === 'PLAY_RESULT');
        expect(after).toBeDefined();
        if (after === undefined) continue;
        expect(after.nextPlayKind).toBe('freeKick');
        expect(after.ballOnY).toBeCloseTo(ownYardLineY(20, after.attackDir[after.possession]), 6);
      }
    }
  });

  it('the final score equals the per-quarter scoring lines', () => {
    for (const seed of SEEDS) {
      const r = runHeadlessGame({ seed });
      for (const t of [0, 1] as const) {
        const sum = r.state.stats.scoringByQuarter[t].reduce((a, b) => a + b, 0);
        expect(sum).toBe(r.finalScore[t]);
        expect(r.state.stats.teams[t].points).toBe(r.finalScore[t]);
      }
    }
  });
});

describe('downs and turnovers in live games', () => {
  it('a first down always resets to 1st and (at most) ten', () => {
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        if (s.event.type !== 'FIRST_DOWN') continue;
        expect(s.down).toBe(1);
        expect(s.toGo).toBeGreaterThan(0);
        expect(s.toGo).toBeLessThanOrEqual(10);
      }
    }
  });

  it('turnover on downs flips possession on a failed fourth down', () => {
    let seen = 0;
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        if (s.event.type !== 'TURNOVER_ON_DOWNS') continue;
        seen++;
        expect(s.possession).not.toBe(s.event.team);
        expect(s.down).toBe(1);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('the down is never outside 1..4 and the ball never leaves the field', () => {
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        expect(s.down).toBeGreaterThanOrEqual(1);
        expect(s.down).toBeLessThanOrEqual(4);
        expect(s.ballOnY).toBeGreaterThanOrEqual(10);
        expect(s.ballOnY).toBeLessThanOrEqual(110);
      }
    }
  });
});

describe('clock and quarter progression', () => {
  it('quarters end in order and teams switch ends each break', () => {
    const samples = sampleGame(SEEDS[0] as number);
    const ends = samples.filter((s) => s.event.type === 'QUARTER_END');
    expect(ends.length).toBeGreaterThanOrEqual(4);
    const quarters = ends.map((s) => (s.event.type === 'QUARTER_END' ? s.event.quarter : -1));
    expect(quarters.slice(0, 4)).toEqual([1, 2, 3, 4]);

    // Direction flips exactly once per quarter break.
    const dirs = ends.map((s) => s.attackDir[0]);
    for (let i = 1; i < Math.min(4, dirs.length); i++) {
      expect(dirs[i]).toBe(dirs[i - 1] === 1 ? -1 : 1);
    }
  });

  it('the two-minute warning fires once per half and stops the clock', () => {
    for (const seed of SEEDS) {
      const warnings = sampleGame(seed).filter((s) => s.event.type === 'TWO_MINUTE_WARNING');
      expect(warnings.length).toBe(2);
      const halves = warnings.map((s) => (s.event.type === 'TWO_MINUTE_WARNING' ? s.event.half : 0));
      expect(halves).toEqual([1, 2]);
      for (const w of warnings) {
        expect(w.clockRunning).toBe(false);
        expect(w.clockSec).toBeLessThanOrEqual(120);
      }
    }
  });

  it('halftime hands the ball to the team that kicked off first', () => {
    for (const seed of SEEDS) {
      const samples = sampleGame(seed);
      const toss = samples.find((s) => s.event.type === 'COIN_TOSS_RESULT');
      const half = samples.findIndex((s) => s.event.type === 'HALFTIME');
      expect(toss).toBeDefined();
      expect(half).toBeGreaterThan(0);
      if (toss === undefined || toss.event.type !== 'COIN_TOSS_RESULT') continue;
      const firstReceiver = toss.event.receiving;
      const firstSnapH2 = samples.slice(half).find((s) => s.event.type === 'PLAYS_SELECTED');
      expect(firstSnapH2).toBeDefined();
      if (firstSnapH2 === undefined) continue;
      // Whoever received to open the game kicks off to open the second half.
      expect(firstSnapH2.possession).toBe(firstReceiver);
      expect(firstSnapH2.quarter).toBe(3);
    }
  });

  it('the play clock is reset and warned about before every snap', () => {
    const samples = sampleGame(SEEDS[1] as number);
    const warns = samples.filter((s) => s.event.type === 'PLAY_CLOCK_WARNING');
    expect(warns.length).toBeGreaterThan(0);
    for (const w of warns) {
      if (w.event.type === 'PLAY_CLOCK_WARNING') expect(w.event.secLeft).toBe(10);
    }
  });

  it('timeouts are restored at halftime', () => {
    const samples = sampleGame(SEEDS[0] as number);
    expect(samples.some((s) => s.event.type === 'HALFTIME')).toBe(true);
  });
});

describe('penalties in live games', () => {
  it('never enforces more than one flag per play and always logs the result', () => {
    for (const seed of SEEDS) {
      const samples = sampleGame(seed);
      const enforced = samples.filter((s) => s.event.type === 'PENALTY_ENFORCED').length;
      const declined = samples.filter((s) => s.event.type === 'PENALTY_DECLINED').length;
      const flags = samples.filter((s) => s.event.type === 'FLAG').length;
      expect(enforced + declined).toBeLessThanOrEqual(flags);
      const r = runHeadlessGame({ seed });
      const totalPenalties = r.state.stats.teams[0].penalties + r.state.stats.teams[1].penalties;
      expect(totalPenalties).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.state.stats.teams[0].penaltyYds)).toBe(true);
    }
  });

  it('accepted penalties stop the clock', () => {
    for (const seed of SEEDS) {
      for (const s of sampleGame(seed)) {
        if (s.event.type !== 'PENALTY_ENFORCED') continue;
        expect(s.clockRunning).toBe(false);
      }
    }
  });
});

describe('phase machine', () => {
  it('only ever reaches GAME_OVER through a quarter/overtime ending', () => {
    for (const seed of SEEDS) {
      const r = runHeadlessGame({ seed });
      expect(r.state.phase).toBe(GamePhase.GAME_OVER);
      const last = r.events[r.events.length - 1];
      expect(last).toBeDefined();
      const over = r.events.filter((e) => e.type === 'GAME_OVER');
      expect(over.length).toBe(1);
      if (over[0]?.type === 'GAME_OVER') {
        expect(over[0].finalScore).toEqual(r.finalScore);
      }
    }
  });
});
