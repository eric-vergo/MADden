// Regression: ticker templates 13/14 ({kicker}) and 15 ({punter}) must name the
// player who kicked the ball. PLAY_RESULT.carrierIdx is never the kicker — for a
// placekick it stays null, and for a punt it is the RECEIVING team's returner —
// so the copy has to come from KICK_LAUNCHED.kickerIdx instead.

import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import type { GameState, PlayState, SimPlayer } from '../../src/sim/types';
import { PlayByPlay } from '../../src/game/PlayByPlay';
import { makeState } from '../audio/gameStateFixture';

/** Index → athleteId map is all PlayByPlay.nameOf reads out of PlayState. */
function withPlayers(state: GameState, byIndex: Readonly<Record<number, string>>): GameState {
  const players: SimPlayer[] = [];
  for (let i = 0; i < 22; i++) {
    players.push({ athleteId: byIndex[i] ?? `unused-${i}`, jersey: 0 } as unknown as SimPlayer);
  }
  return { ...state, play: { players } as unknown as PlayState };
}

function playResult(over: Partial<Extract<SimEvent, { type: 'PLAY_RESULT' }>>): SimEvent {
  return {
    type: 'PLAY_RESULT',
    tick: 100,
    offense: 0,
    playType: 'run',
    yards: 0,
    carrierIdx: null,
    passerIdx: null,
    targetIdx: null,
    tacklerIdx: null,
    touchdown: false,
    turnover: null,
    deadReason: 'tackle',
    ...over,
  } as SimEvent;
}

/** HOM roster athlete ids; nameOf renders "F. Last{n}" for HOM-{n-1}. */
const KICKER = 'HOM-38';
const RETURNER = 'AWY-7';

describe('ticker credits the kicker, not the returner', () => {
  it('names the punter on a punt (template 15)', () => {
    const pbp = new PlayByPlay();
    const state = withPlayers(makeState(), { 10: KICKER, 15: RETURNER });

    pbp.handle([
      { type: 'KICK_LAUNCHED', tick: 60, style: 'punt', kickerIdx: 10, power01: 0.8, accuracy01: 0.5 },
    ], state);
    pbp.handle([{ type: 'PUNT_DOWNED', tick: 95, atY: 30 }], state);
    pbp.handle([playResult({ playType: 'punt', yards: -39, carrierIdx: 15 })], state);

    expect(pbp.lastLine).toContain('Last39'); // HOM-38 → "First39 Last39"
    expect(pbp.lastLine).not.toContain('Last8'); // the returner AWY-7
    expect(pbp.lastLine).toContain('39 yards');
  });

  it('names the kicker on a made field goal (template 13)', () => {
    const pbp = new PlayByPlay();
    const state = withPlayers(makeState(), { 9: KICKER });

    pbp.handle([
      { type: 'KICK_LAUNCHED', tick: 60, style: 'placekick', kickerIdx: 9, power01: 0.9, accuracy01: 0.6 },
    ], state);
    pbp.handle([
      { type: 'FIELD_GOAL_RESULT', tick: 80, team: 0, good: true, distanceYds: 43, missSide: null },
    ], state);
    pbp.handle([playResult({ playType: 'fieldGoal', yards: 0, carrierIdx: null })], state);

    expect(pbp.lastLine).toBe("F. Last39's 43-yard field goal attempt is GOOD.");
  });

  it('names the kicker on a miss (template 14)', () => {
    const pbp = new PlayByPlay();
    const state = withPlayers(makeState(), { 9: KICKER });

    pbp.handle([
      { type: 'KICK_LAUNCHED', tick: 60, style: 'placekick', kickerIdx: 9, power01: 0.5, accuracy01: 0.2 },
    ], state);
    pbp.handle([
      { type: 'FIELD_GOAL_RESULT', tick: 80, team: 0, good: false, distanceYds: 49, missSide: 'short' },
    ], state);
    pbp.handle([playResult({ playType: 'fieldGoal', yards: 0, carrierIdx: null })], state);

    expect(pbp.lastLine).toBe("F. Last39's 49-yarder is NO GOOD, wide and short.");
    expect(pbp.lastLine).not.toContain('the runner');
  });

  it('still names the returner on a kickoff return (template 16)', () => {
    const pbp = new PlayByPlay();
    const state = withPlayers(makeState(), { 10: KICKER, 15: RETURNER });

    pbp.handle([
      { type: 'KICK_LAUNCHED', tick: 60, style: 'kickoff', kickerIdx: 10, power01: 1, accuracy01: 0.5 },
    ], state);
    pbp.handle([playResult({ playType: 'kickoff', yards: 24, carrierIdx: 15 })], state);

    expect(pbp.lastLine).toContain('Last8'); // AWY-7 → "First8 Last8"
    expect(pbp.lastLine).not.toContain('Last39');
  });

  it('falls back to a role word when no kick was launched', () => {
    const pbp = new PlayByPlay();
    const state = withPlayers(makeState(), { 15: RETURNER });
    pbp.handle([playResult({ playType: 'punt', yards: -35, carrierIdx: 15 })], state);
    expect(pbp.lastLine).toContain('the punter');
    expect(pbp.lastLine).not.toContain('Last8');
  });
});
