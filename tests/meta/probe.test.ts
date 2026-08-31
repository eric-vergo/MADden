import { describe, it } from 'vitest';
import { generateLeague } from '../../src/meta/league';
import { generateSchedule } from '../../src/meta/schedule';
import { simGame } from '../../src/meta/quickSim';

describe('calibration probe', () => {
  it('league scoring', () => {
    let pts = 0, games = 0, yds = 0, sacks = 0, tos = 0, punts = 0, pens = 0;
    let att = 0, cmp = 0, rushAtt = 0, rushYds = 0, ot = 0, fgm = 0, fga = 0;
    const t0 = Date.now();
    for (let s = 0; s < 100; s++) {
      const league = generateLeague(1000 + s, 0);
      const sched = generateSchedule(1000 + s, 0, league.teams);
      for (const g of sched) {
        const o = simGame(1000 + s, g, league.teams);
        pts += o.result.homeScore + o.result.awayScore;
        if (o.result.ot) ot++;
        games++;
        for (const t of o.box.stats.teams) {
          yds += t.totalYds; tos += t.turnovers; pens += t.penalties;
          sacks += t.sacksAllowed;
        }
        for (const k of Object.keys(o.box.stats.players)) {
          const p = o.box.stats.players[k]!;
          att += p.passAtt; cmp += p.passCmp; rushAtt += p.rushAtt; rushYds += p.rushYds;
          punts += p.punts; fgm += p.fgm; fga += p.fga;
        }
      }
    }
    const tg = games * 2;
    console.log('games', games, 'ms', Date.now() - t0);
    console.log('pts/team', (pts / tg).toFixed(2), 'yds/team', (yds / tg).toFixed(1));
    console.log('comp%', (cmp / att).toFixed(3), 'att/team', (att / tg).toFixed(1));
    console.log('ypc', (rushYds / rushAtt).toFixed(2), 'carries/team', (rushAtt / tg).toFixed(1));
    console.log('sacks/team', (sacks / tg).toFixed(2), 'to/team', (tos / tg).toFixed(2));
    console.log('punts/game', (punts / games).toFixed(2), 'pens/team', (pens / tg).toFixed(2));
    console.log('fg%', (fgm / fga).toFixed(3), 'fga/team', (fga / tg).toFixed(2));
    console.log('ot rate', (ot / games).toFixed(3));
  });

  it('ovr edge win rate', () => {
    const buckets = new Map<number, { w: number; n: number }>();
    for (let s = 0; s < 60; s++) {
      const league = generateLeague(5000 + s, 0);
      const sched = generateSchedule(5000 + s, 0, league.teams);
      for (const g of sched) {
        const h = league.teams.find((t) => t.identity.id === g.homeId)!;
        const a = league.teams.find((t) => t.identity.id === g.awayId)!;
        const gap = h.ovr - a.ovr;
        const o = simGame(5000 + s, g, league.teams);
        const homeWon = o.result.homeScore > o.result.awayScore;
        for (const [lo, hi, key] of [[4, 6, 5], [8, 12, 10], [14, 100, 15]] as const) {
          if (gap >= lo && gap <= hi) {
            const b = buckets.get(key) ?? { w: 0, n: 0 }; b.n++; if (homeWon) b.w++; buckets.set(key, b);
          }
          if (-gap >= lo && -gap <= hi) {
            const b = buckets.get(key) ?? { w: 0, n: 0 }; b.n++; if (!homeWon) b.w++; buckets.set(key, b);
          }
        }
      }
    }
    for (const k of [5, 10, 15]) {
      const b = buckets.get(k);
      if (b) console.log(`gap ~${k}: winrate ${(b.w / b.n).toFixed(3)} n=${b.n}`);
    }
  });

  it('team ovr spread', () => {
    for (let s = 0; s < 3; s++) {
      const league = generateLeague(77 + s, 0);
      const ovrs = league.teams.map((t) => t.ovr).sort((a, b) => b - a);
      console.log('ovrs', ovrs.join(','));
      let stars = 0;
      for (const t of league.teams) for (const a of t.roster.athletes) {
        const peak = Math.max(...Object.values(a.ratings));
        if (peak >= 93) stars++;
      }
      console.log('stars', stars);
    }
  });
});
