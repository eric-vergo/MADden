// Measurement helper for the "shape of the football" that the phase-3 rules
// fixes brought into existence: real kick and punt returns, defensive scores,
// own-impetus safeties and pass interference.
//
// None of these can be read off the box score — SimStats has no return columns
// and no foul census — and the reception that starts a return emits no event.
// So this walks GameSim tick by tick and watches the ball change hands, which
// is the only place the start of a return is observable.
//
// Shared by tests/calibration-probe.test.ts (prints it) and
// tests/soak.test.ts (asserts on it).

import { GameSim } from '../../src/sim/GameSim';
import { GamePhase, type GameConfig, type TeamSide } from '../../src/sim/types';
import { emptyTickInput } from '../../src/sim/events';
import { makeTestRoster } from '../harness/fixtures';

const TICK_CAP = 60 * 60 * 90;

export interface FootballShape {
  games: number;
  /** Yards gained on every kickoff return that actually got run back. */
  kickReturns: number[];
  /** Same for punts. */
  puntReturns: number[];
  /** Interception returns taken all the way. */
  pickSixes: number;
  /** Fumble returns taken all the way. */
  fumbleSixes: number;
  /** Kick and punt returns taken all the way. */
  returnTds: number;
  safeties: number;
  /** Play type each safety came off, so a spike in them can be explained. */
  safetyPlayTypes: Record<string, number>;
  touchbacks: number;
  fairCatches: number;
  interceptions: number;
  /** Flags thrown, by kind, across the whole slate. */
  flags: Record<string, number>;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Largest value, or 0 for an empty sample. */
export function maxOf(xs: readonly number[]): number {
  let m = 0;
  for (const x of xs) if (x > m) m = x;
  return m;
}

/**
 * Run `games` headless CPU-vs-CPU games from `seedBase` and fold them into one
 * census. Matches tests/harness/headlessGame.ts's config exactly so the numbers
 * line up with the soak slate.
 */
export function measureFootballShape(seedBase: number, games: number): FootballShape {
  const out: FootballShape = {
    games,
    kickReturns: [], puntReturns: [],
    pickSixes: 0, fumbleSixes: 0, returnTds: 0,
    safeties: 0, safetyPlayTypes: {}, touchbacks: 0, fairCatches: 0, interceptions: 0,
    flags: {},
  };

  for (let g = 0; g < games; g++) {
    const seed = seedBase + g;
    const config: GameConfig = {
      quarterLengthSec: 300,
      difficulty: 'allPro',
      userTeam: null,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: false,
    };
    const sim = new GameSim(
      config,
      [makeTestRoster('HOM', seed), makeTestRoster('AWY', seed + 1)],
      seed,
    );

    // Per-play return tracking. `kickStyle` is armed by KICK_LAUNCHED and
    // disarmed at the whistle; `startY`/`lastY` follow the returner.
    let kickStyle: 'kickoff' | 'punt' | 'placekick' | null = null;
    let kickingTeam: TeamSide | null = null;
    let startY: number | null = null;
    let lastY = 0;
    let returnDir: 1 | -1 = 1;
    let safetyThisPlay = false;

    const endReturn = (): void => {
      if (startY !== null && kickStyle !== null) {
        const yds = (lastY - startY) * returnDir;
        if (kickStyle === 'kickoff') out.kickReturns.push(yds);
        else if (kickStyle === 'punt') out.puntReturns.push(yds);
      }
      kickStyle = null;
      kickingTeam = null;
      startY = null;
    };

    let ticks = 0;
    while (sim.state.phase !== GamePhase.GAME_OVER && ticks < TICK_CAP) {
      for (const e of sim.tick(emptyTickInput())) {
        switch (e.type) {
          case 'KICK_LAUNCHED':
            kickStyle = e.style;
            kickingTeam = sim.state.possession;
            startY = null;
            break;
          case 'SAFETY': out.safeties++; safetyThisPlay = true; break;
          case 'TOUCHBACK': out.touchbacks++; break;
          case 'FAIR_CATCH': out.fairCatches++; break;
          case 'INTERCEPTION': out.interceptions++; break;
          case 'FLAG':
            out.flags[e.flag.kind] = (out.flags[e.flag.kind] ?? 0) + 1;
            break;
          case 'PLAY_RESULT':
            if (safetyThisPlay) {
              out.safetyPlayTypes[e.playType] = (out.safetyPlayTypes[e.playType] ?? 0) + 1;
              safetyThisPlay = false;
            }
            if (e.touchdown) {
              if (e.turnover === 'int') out.pickSixes++;
              else if (e.turnover === 'fumble') out.fumbleSixes++;
              else if (e.playType === 'kickoff' || e.playType === 'punt') out.returnTds++;
            }
            break;
          case 'WHISTLE': endReturn(); break;
          default: break;
        }
      }

      // Watch the ball between events: a returner fielding a kick emits
      // nothing, so this is where a return is seen to begin.
      const play = sim.state.play;
      const idx = play === null ? null : play.ball.carrierIdx;
      if (kickStyle !== null && kickingTeam !== null && play !== null && idx !== null) {
        const c = play.players[idx];
        if (c !== undefined && c.team !== kickingTeam) {
          if (startY === null) {
            startY = c.pos2.y;
            returnDir = sim.state.attackDir[c.team];
          }
          lastY = c.pos2.y;
        }
      }
      ticks++;
    }
    endReturn();
  }

  return out;
}
