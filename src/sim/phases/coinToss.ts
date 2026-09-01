// COIN_TOSS: pick a winner, let them choose, place the opening kickoff.

import { GamePhase, type GameState, type TeamSide } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { ext, takeEntry } from '../rules/ext';
import { setupKickoff } from '../rules/scoring';
import { otherTeam } from '../rules/downs';
import { beginPlayCall } from './common';
import { PLAY_CLOCK_SEC } from '../constants';

export function coinTossPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const e = ext(s);
  if (takeEntry(s)) {
    const winner: TeamSide = rng.misc.chance(0.5) ? 0 : 1;
    s.coin = { winner, receivingFirstHalf: null, overtime: false };
  }
  const coin = s.coin;
  if (coin === null || coin.winner === null) return;

  let choice: 'receive' | 'kick' | null = null;
  if (s.config.userTeam !== null && s.config.userTeam === coin.winner) {
    for (const c of input.commands) {
      if (c.type === 'COIN_TOSS_CHOICE' && c.team === coin.winner) choice = c.choice;
    }
  } else {
    // CPU always takes the ball to open the game.
    choice = 'receive';
  }
  if (choice === null) return;

  const receiving: TeamSide = choice === 'receive' ? coin.winner : otherTeam(coin.winner);
  coin.receivingFirstHalf = receiving;

  const kicking = otherTeam(receiving);
  setupKickoff(s, kicking);
  s.playClockSec = PLAY_CLOCK_SEC;
  e.startClockOnSnap = false;

  events.push({
    type: 'COIN_TOSS_RESULT', tick: s.tick, winner: coin.winner, receiving, overtime: false,
  });
  beginPlayCall(s);
  void GamePhase;
}
