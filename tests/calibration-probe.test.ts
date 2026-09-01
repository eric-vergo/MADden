// Diagnostic probe, not an assertion suite. It prints the league-wide shape of
// the football plus the mechanism traces that explain it, so a tuning pass can
// see WHY a band moved rather than only that it did.
//
//   npx vitest run --mode soak tests/calibration-probe.test.ts
//
// Four independent seed families run so a reading is not one lucky slate; the
// soak test itself pins the 10_000 family.

import { describe, it } from 'vitest';
import { runHeadlessGame } from './harness/headlessGame';
import type { SimEvent } from '../src/sim/events';

const SOAK = import.meta.env.MODE === 'soak';

type ProbeState = Parameters<NonNullable<Parameters<typeof runHeadlessGame>[0]['onEvent']>>[1];

describe.skipIf(!SOAK)('calibration probe', () => {
  it.each([
    { label: 'soak seeds', base: 10_000 },
    { label: 'probe seeds', base: 40_000 },
    { label: 'fresh seeds', base: 70_000 },
    { label: 'other seeds', base: 90_000 },
  ])('prints per-team averages ($label)', ({ label, base }) => {
    const n = 32;
    const agg = {
      pts: 0, yds: 0, passYds: 0, rushYds: 0, sacks: 0, to: 0,
      punts: 0, pens: 0, comp: 0, att: 0, rushAtt: 0, fga: 0, fgm: 0, plays: 0,
    };
    for (let i = 0; i < n; i++) {
      const r = runHeadlessGame({ seed: base + i, quarterLengthSec: 300 });
      const s = r.state.stats;
      for (const t of s.teams) {
        agg.pts += t.points; agg.yds += t.totalYds; agg.passYds += t.passYds;
        agg.rushYds += t.rushYds; agg.to += t.turnovers; agg.pens += t.penalties;
        agg.sacks += t.sacksAllowed;
      }
      for (const key of Object.keys(s.players)) {
        const p = s.players[key];
        if (p === undefined) continue;
        agg.comp += p.passCmp; agg.att += p.passAtt; agg.rushAtt += p.rushAtt;
        agg.punts += p.punts; agg.fga += p.fga; agg.fgm += p.fgm;
      }
      agg.plays += r.state.playLog.length;
    }
    const teams = n * 2;
    console.log(`${label} ${JSON.stringify({
      ptsPerTeam: +(agg.pts / teams).toFixed(1),
      ydsPerTeam: +(agg.yds / teams).toFixed(0),
      passYdsPerTeam: +(agg.passYds / teams).toFixed(0),
      rushYdsPerTeam: +(agg.rushYds / teams).toFixed(0),
      compPct: +(agg.comp / Math.max(1, agg.att)).toFixed(3),
      ypc: +(agg.rushYds / Math.max(1, agg.rushAtt)).toFixed(2),
      sacksPerTeam: +(agg.sacks / teams).toFixed(2),
      toPerTeam: +(agg.to / teams).toFixed(2),
      puntsPerGame: +(agg.punts / n).toFixed(1),
      fgaPerGame: +(agg.fga / n).toFixed(1),
      fgPct: +(agg.fgm / Math.max(1, agg.fga)).toFixed(2),
      pensPerGame: +(agg.pens / n).toFixed(1),
      playsPerGame: +(agg.plays / n).toFixed(0),
    }, null, 1)}`);
  }, 180_000);

  it('prints mechanism diagnostics', () => {
    const n = 8;
    let snapTick = -1;
    const timeToThrow: number[] = [];
    const rushDist: number[] = [];
    const counts: Record<string, number> = {};
    const playTypes: Record<string, number> = {};
    const deadReasons: Record<string, number> = {};
    const bump = (m: Record<string, number>, k: string): void => {
      m[k] = (m[k] ?? 0) + 1;
    };

    const onEvent = (e: SimEvent, state: ProbeState): void => {
      bump(counts, e.type);
      if (e.type === 'SNAP') snapTick = e.tick;
      if (e.type === 'PLAY_RESULT') { bump(playTypes, e.playType); bump(deadReasons, e.deadReason); }
      if (e.type !== 'PASS_THROWN' || snapTick < 0) return;
      timeToThrow.push(e.tick - snapTick);
      // How close the rush actually got by the time the ball came out — the
      // single most diagnostic number when sacks go missing.
      const play = state.play;
      const qb = play?.players[e.passerIdx];
      if (!play || !qb) return;
      let nearest = 99;
      for (let i = 11; i < 22; i++) {
        const d = play.players[i];
        if (d === undefined || d.anim === 'down' || d.engagedWith !== null) continue;
        nearest = Math.min(nearest, Math.hypot(d.pos2.x - qb.pos2.x, d.pos2.y - qb.pos2.y));
      }
      rushDist.push(nearest);
    };

    for (let i = 0; i < n; i++) {
      runHeadlessGame({ seed: 40_000 + i, quarterLengthSec: 300, onEvent });
    }

    const pct = (xs: number[], f: number): number => {
      const v = xs[Math.floor(xs.length * f)];
      return v === undefined ? 0 : +v.toFixed(2);
    };
    timeToThrow.sort((a, b) => a - b);
    rushDist.sort((a, b) => a - b);
    const meanThrow = timeToThrow.reduce((a, b) => a + b, 0) / Math.max(1, timeToThrow.length);

    console.log(JSON.stringify({
      games: n,
      // 60 ticks = 1 second. Real quarterbacks average roughly 2.7 seconds.
      timeToThrowTicks: {
        p10: pct(timeToThrow, 0.1), p50: pct(timeToThrow, 0.5),
        p90: pct(timeToThrow, 0.9), mean: +meanThrow.toFixed(1),
      },
      nearestFreeDefenderAtRelease: {
        p10: pct(rushDist, 0.1), p50: pct(rushDist, 0.5), p90: pct(rushDist, 0.9),
      },
      playTypes,
      deadReasons,
      counts,
    }, null, 1));
  }, 180_000);
});
