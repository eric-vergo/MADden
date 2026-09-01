// Box-score accumulation. Everything is derived from the event stream a play
// produced plus its PlayOutcome, so live games and any future replay of the
// same events agree by construction.

import type {
  GameStats, GameState, PlayState, PlayerGameStats, TeamSide,
} from './types';
import type { SimEvent } from './events';
import type { PlayOutcome } from './rules/ext';
import { otherTeam } from './rules/downs';

export function emptyPlayerStats(athleteId: string): PlayerGameStats {
  return {
    athleteId,
    passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, passInt: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0,
    tgt: 0, rec: 0, recYds: 0, recTD: 0,
    tackles: 0, sacks: 0, defInt: 0, ffum: 0,
    fgm: 0, fga: 0, xpm: 0, xpa: 0,
    punts: 0, puntYds: 0,
    krYds: 0, prYds: 0, retTD: 0,
  };
}

export function ensurePlayerStats(stats: GameStats, athleteId: string): PlayerGameStats {
  const found = stats.players[athleteId];
  if (found !== undefined) return found;
  const created = emptyPlayerStats(athleteId);
  stats.players[athleteId] = created;
  return created;
}

function statsFor(stats: GameStats, play: PlayState, idx: number | null): PlayerGameStats | null {
  if (idx === null || idx < 0) return null;
  const p = play.players[idx];
  if (p === undefined) return null;
  return ensurePlayerStats(stats, p.athleteId);
}

export function recordFirstDown(s: GameState, team: TeamSide): void {
  s.stats.teams[team].firstDowns += 1;
}

export function recordThirdDown(s: GameState, team: TeamSide, converted: boolean): void {
  const t = s.stats.teams[team];
  t.thirdDownAtt += 1;
  if (converted) t.thirdDownConv += 1;
}

export function recordPenalty(s: GameState, team: TeamSide, yards: number): void {
  const t = s.stats.teams[team];
  t.penalties += 1;
  t.penaltyYds += Math.abs(yards);
}

/**
 * Fold one completed play into the box score.
 * `events` are the SimEvents emitted between the snap and the whistle.
 */
export function accumulatePlay(
  s: GameState,
  play: PlayState,
  events: readonly SimEvent[],
  o: PlayOutcome,
  offense: TeamSide,
): void {
  // An accepted penalty wipes the down off the books: nothing the nullified
  // play produced — attempts, catches, tackles, picks, kicks — may post.
  if (o.playType === 'penaltyOnly') return;

  const stats = s.stats;
  const defense = otherTeam(offense);
  const team = stats.teams[offense];

  let passerIdx: number | null = o.passerIdx;
  let targetIdx: number | null = o.targetIdx;
  let completed = o.completed;

  for (const ev of events) {
    switch (ev.type) {
      case 'PASS_THROWN': {
        passerIdx = ev.passerIdx;
        targetIdx = ev.targetIdx;
        const ps = statsFor(stats, play, ev.passerIdx);
        if (ps !== null) ps.passAtt += 1;
        const ts = statsFor(stats, play, ev.targetIdx);
        if (ts !== null) ts.tgt += 1;
        break;
      }
      case 'CATCH': {
        const rs = statsFor(stats, play, ev.receiverIdx);
        const catcher = play.players[ev.receiverIdx];
        if (rs !== null && catcher !== undefined && catcher.team === offense) {
          // The credited target follows the ball: if someone other than the
          // intended man came down with it, the target moves to him so that
          // receptions never exceed targets.
          if (targetIdx !== null && targetIdx !== ev.receiverIdx) {
            const old = statsFor(stats, play, targetIdx);
            if (old !== null && old.tgt > 0) old.tgt -= 1;
            rs.tgt += 1;
            targetIdx = ev.receiverIdx;
          }
          rs.rec += 1;
          completed = true;
          const ps = statsFor(stats, play, passerIdx);
          if (ps !== null) ps.passCmp += 1;
        }
        break;
      }
      case 'INTERCEPTION': {
        const ds = statsFor(stats, play, ev.defenderIdx);
        if (ds !== null) ds.defInt += 1;
        const ps = statsFor(stats, play, passerIdx);
        if (ps !== null) ps.passInt += 1;
        break;
      }
      case 'SACK': {
        const ds = statsFor(stats, play, ev.tacklerIdx);
        if (ds !== null) { ds.sacks += 1; ds.tackles += 1; }
        team.sacksAllowed += 1;
        break;
      }
      case 'TACKLE': {
        const ds = statsFor(stats, play, ev.tacklerIdx);
        if (ds !== null) ds.tackles += 1;
        if (ev.assistIdx !== null) {
          const as = statsFor(stats, play, ev.assistIdx);
          if (as !== null) as.tackles += 1;
        }
        break;
      }
      case 'FUMBLE': {
        const cs = statsFor(stats, play, ev.carrierIdx);
        if (cs !== null) cs.fumbles += 1;
        if (ev.forcedByIdx !== null) {
          const fs = statsFor(stats, play, ev.forcedByIdx);
          if (fs !== null) fs.ffum += 1;
        }
        break;
      }
      case 'FIELD_GOAL_RESULT': {
        const ks = statsFor(stats, play, kickerIdxOf(play));
        if (ks !== null) { ks.fga += 1; if (ev.good) ks.fgm += 1; }
        break;
      }
      case 'XP_RESULT': {
        const ks = statsFor(stats, play, kickerIdxOf(play));
        if (ks !== null) { ks.xpa += 1; if (ev.good) ks.xpm += 1; }
        break;
      }
      case 'KICK_LAUNCHED': {
        if (ev.style === 'punt') {
          const ks = statsFor(stats, play, ev.kickerIdx);
          if (ks !== null) ks.punts += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  // Yardage attribution from the play's own result.
  switch (o.playType) {
    case 'run':
    case 'scramble': {
      const cs = statsFor(stats, play, o.carrierIdx);
      if (cs !== null) {
        cs.rushAtt += 1;
        cs.rushYds += o.yards;
        if (o.touchdown) cs.rushTD += 1;
      }
      team.rushYds += o.yards;
      team.totalYds += o.yards;
      break;
    }
    case 'pass': {
      if (completed) {
        const ps = statsFor(stats, play, passerIdx);
        if (ps !== null) {
          ps.passYds += o.yards;
          if (o.touchdown) ps.passTD += 1;
        }
        const rs = statsFor(stats, play, o.carrierIdx ?? targetIdx);
        if (rs !== null) {
          rs.recYds += o.yards;
          if (o.touchdown) rs.recTD += 1;
        }
        team.passYds += o.yards;
        team.totalYds += o.yards;
      }
      break;
    }
    case 'sack': {
      team.totalYds += o.yards;
      break;
    }
    case 'punt': {
      const ks = statsFor(stats, play, kickerIdxOf(play));
      if (ks !== null) ks.puntYds += Math.abs(o.yards);
      break;
    }
    case 'kickoff': {
      const rs = statsFor(stats, play, o.carrierIdx);
      if (rs !== null) {
        rs.krYds += Math.max(0, o.yards);
        if (o.touchdown) rs.retTD += 1;
      }
      break;
    }
    default:
      break;
  }

  if (o.turnover === 'int' || o.turnover === 'fumble') {
    stats.teams[offense].turnovers += 1;
  }
  void defense;
}

function kickerIdxOf(play: PlayState): number | null {
  for (let i = 0; i < play.players.length; i++) {
    const p = play.players[i];
    if (p === undefined) continue;
    if (p.role === 'K' || p.role === 'P') return i;
  }
  return null;
}
