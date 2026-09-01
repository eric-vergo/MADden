// Temporary diagnostic: prints league-wide calibration stats from headless games.
import { describe, it } from 'vitest';
import { runHeadlessGame } from './harness/headlessGame';

const SOAK = import.meta.env.MODE === 'soak';

describe.skipIf(!SOAK)('calibration probe', () => {
  it('prints per-team averages over 12 games', () => {
    const n = 12;
    const agg = {
      pts: 0, yds: 0, passYds: 0, rushYds: 0, sacks: 0, to: 0,
      punts: 0, pens: 0, comp: 0, att: 0, rushAtt: 0, fga: 0, plays: 0,
    };
    for (let i = 0; i < n; i++) {
      const r = runHeadlessGame({ seed: 40_000 + i, quarterLengthSec: 300 });
      const s = r.state.stats;
      for (const t of s.teams) {
        agg.pts += t.points; agg.yds += t.totalYds; agg.passYds += t.passYds;
        agg.rushYds += t.rushYds; agg.to += t.turnovers; agg.pens += t.penalties;
        agg.sacks += t.sacksAllowed;
      }
      for (const key of Object.keys(s.players)) {
        const p = s.players[key]!;
        agg.comp += p.passCmp; agg.att += p.passAtt; agg.rushAtt += p.rushAtt;
        agg.punts += p.punts; agg.fga += p.fga;
      }
      agg.plays += r.state.playLog.length;
    }
    const teams = n * 2;
    console.log(JSON.stringify({
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
      pensPerGame: +(agg.pens / n).toFixed(1),
      playsPerGame: +(agg.plays / n).toFixed(0),
    }, null, 1));
  }, 120_000);
});
