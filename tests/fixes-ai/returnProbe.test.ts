// Regression probe for F1: over a handful of seeded CPU-vs-CPU games,
// interception returns must gain ground on average and kick returns must not
// all end behind the spot where the ball was fielded.
//
// This measures whole games rather than a scripted fixture, so it catches any
// remaining site where a defensive ball carrier reads the snapping offense's
// direction instead of his own.

import { describe, expect, it } from 'vitest';
import { GameSim } from '../../src/sim/GameSim';
import { GamePhase, type GameConfig, type TeamRoster } from '../../src/sim/types';
import { emptyTickInput } from '../../src/sim/events';
import { makeTestRoster } from '../harness/fixtures';

interface ReturnSample {
  /** Yards gained toward the ball carrier's OWN goal. */
  gain: number;
  startY: number;
  endY: number;
}

interface GameProbe {
  intReturns: ReturnSample[];
  kickReturns: ReturnSample[];
}

interface Live {
  idx: number;
  startY: number;
  dir: number;
  lastY: number;
}

function probeGame(seed: number, tickCap = 60 * 60 * 90): GameProbe {
  const rosters: [TeamRoster, TeamRoster] = [
    makeTestRoster('HOM', seed),
    makeTestRoster('AWY', seed + 1),
  ];
  const config: GameConfig = {
    quarterLengthSec: 300,
    difficulty: 'allPro',
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
  };
  const sim = new GameSim(config, rosters, seed);

  const out: GameProbe = { intReturns: [], kickReturns: [] };
  let intLive: Live | null = null;
  let kickLive: Live | null = null;
  let kickoffInFlight = false;

  const close = (l: Live, into: ReturnSample[]): void => {
    into.push({ gain: (l.lastY - l.startY) * l.dir, startY: l.startY, endY: l.lastY });
  };

  let ticks = 0;
  while (sim.state.phase !== GamePhase.GAME_OVER && ticks < tickCap) {
    const events = sim.tick(emptyTickInput());
    const st = sim.state;
    const play = st.play;

    for (const e of events) {
      if (e.type === 'INTERCEPTION' && play) {
        const p = play.players[e.defenderIdx];
        if (p) {
          intLive = { idx: e.defenderIdx, startY: p.pos2.y, dir: st.attackDir[p.team], lastY: p.pos2.y };
        }
      }
      if (e.type === 'KICK_LAUNCHED' && e.style === 'kickoff') kickoffInFlight = true;
    }

    // A kickoff becomes a return the tick the ball is first held by a player.
    if (kickoffInFlight && kickLive === null && play && play.ball.mode === 'held') {
      const ci = play.ball.carrierIdx;
      const p = ci === null ? undefined : play.players[ci];
      if (p && ci !== null) {
        kickLive = { idx: ci, startY: p.pos2.y, dir: st.attackDir[p.team], lastY: p.pos2.y };
      }
    }

    if (play) {
      if (intLive) {
        const p = play.players[intLive.idx];
        if (p) intLive.lastY = p.pos2.y;
      }
      if (kickLive) {
        const p = play.players[kickLive.idx];
        if (p) kickLive.lastY = p.pos2.y;
      }
    }

    if (st.phase !== GamePhase.PLAY_LIVE) {
      if (intLive) { close(intLive, out.intReturns); intLive = null; }
      if (kickLive) { close(kickLive, out.kickReturns); kickLive = null; }
      kickoffInFlight = false;
    }
    ticks++;
  }
  return out;
}

const SEEDS = [4101, 4102, 4103, 4104];

describe('defensive / return ball carriers gain ground (headless probe)', () => {
  const all: GameProbe = { intReturns: [], kickReturns: [] };
  for (const seed of SEEDS) {
    const g = probeGame(seed);
    all.intReturns.push(...g.intReturns);
    all.kickReturns.push(...g.kickReturns);
  }

  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  it('interception returns average non-negative yardage', () => {
    expect(all.intReturns.length).toBeGreaterThan(0);
    const m = mean(all.intReturns.map((r) => r.gain));
    // eslint-disable-next-line no-console
    console.log(`INT returns: n=${all.intReturns.length} mean=${m.toFixed(1)} min=${Math.min(...all.intReturns.map((r) => r.gain)).toFixed(1)}`);
    expect(m).toBeGreaterThanOrEqual(0);
  });

  it('kick returns do not all end behind the catch spot', () => {
    expect(all.kickReturns.length).toBeGreaterThan(0);
    const gains = all.kickReturns.map((r) => r.gain);
    // eslint-disable-next-line no-console
    console.log(`Kick returns: n=${gains.length} mean=${mean(gains).toFixed(1)} positive=${gains.filter((g) => g > 0).length}`);
    expect(gains.filter((g) => g > 0).length).toBeGreaterThan(0);
    expect(mean(gains)).toBeGreaterThanOrEqual(0);
  });
});
