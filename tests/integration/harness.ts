// Headless rig for the integration stream: a GameSession wired to a stub
// renderer, a NullAudioEngine and a scripted InputSource, plus an auto-pilot
// that answers every prompt the way a competent human would.

import { NullAudioEngine } from '../../src/audio/AudioEngine';
import { KICK } from '../../src/data/balance';
import { generateLeague } from '../../src/meta/league';
import { teamPresentation, type RendererExtras, type TeamPresentation } from '../../src/render/types';
import { GameSession, type InputSource, type RenderTarget, type UserPrompt } from '../../src/game/GameSession';
import { InputContext } from '../../src/input/types';
import {
  GameAction, GamePhase,
  type Difficulty, type GameState, type InputFrame, type TeamRoster, type TeamSide, type TickSnapshot,
} from '../../src/sim/types';

export const TEST_LEAGUE_SEED = 20260831;

export interface StubRenderer extends RenderTarget {
  draws: number;
  camSnaps: number[];
  lastExtras: RendererExtras | null;
}

export function stubRenderer(): StubRenderer {
  return {
    draws: 0,
    camSnaps: [],
    lastExtras: null,
    draw(
      _prev: TickSnapshot,
      _curr: TickSnapshot,
      _alpha: number,
      _state: Readonly<GameState>,
      extras: RendererExtras,
    ): void {
      this.draws++;
      this.lastExtras = extras;
    },
    snapCamera(worldY: number): void {
      this.camSnaps.push(worldY);
    },
  };
}

function frameOf(actions: readonly GameAction[], move = { x: 0, y: 0 }): InputFrame {
  const set = new Set(actions);
  return { held: set, pressed: set, released: new Set<GameAction>(), move };
}

/** Records every context it is sampled in and replays whatever was queued. */
export class ScriptedInput implements InputSource {
  readonly contexts: InputContext[] = [];
  readonly contextCounts = new Map<InputContext, number>();
  private next: InputFrame | null = null;
  /** Set by the auto-pilot to synthesize frames from the live game state. */
  autoFrame: ((context: InputContext) => InputFrame | null) | null = null;
  resets = 0;

  queue(actions: readonly GameAction[], move?: { x: number; y: number }): void {
    this.next = frameOf(actions, move);
  }

  sample(context: InputContext): InputFrame {
    this.contexts.push(context);
    this.contextCounts.set(context, (this.contextCounts.get(context) ?? 0) + 1);
    const queued = this.next;
    this.next = null;
    if (queued) return queued;
    return this.autoFrame?.(context) ?? frameOf([]);
  }

  reset(): void {
    this.resets++;
    this.next = null;
  }
}

export function testRosters(homeId = 'ASH', awayId = 'OAK'): [TeamRoster, TeamRoster] {
  const league = generateLeague(TEST_LEAGUE_SEED, 0);
  const home = league.teams.find((t) => t.identity.id === homeId);
  const away = league.teams.find((t) => t.identity.id === awayId);
  if (!home || !away) throw new Error('fixture teams missing from the league');
  return [home.roster, away.roster];
}

export function testTeams(homeId = 'ASH', awayId = 'OAK'): [TeamPresentation, TeamPresentation] {
  const league = generateLeague(TEST_LEAGUE_SEED, 0);
  const of = (id: string): TeamPresentation => {
    const t = league.teams.find((x) => x.identity.id === id);
    if (!t) throw new Error(`unknown team ${id}`);
    return teamPresentation(
      t.identity.id, t.identity.city, t.identity.nickname, t.identity.colors, t.identity.logo,
    );
  };
  return [of(homeId), of(awayId)];
}

export interface HarnessOptions {
  userTeam: TeamSide;
  quarterLengthSec?: number;
  seed?: number;
  difficulty?: Difficulty;
  penaltiesEnabled?: boolean;
  renderer?: RenderTarget | null;
  onPrompt?: (prompt: UserPrompt | null, session: GameSession) => void;
}

export interface Harness {
  session: GameSession;
  input: ScriptedInput;
  renderer: StubRenderer | null;
  prompts: Array<UserPrompt | null>;
  /** Selected offense play ids the auto-pilot sent in. */
  selected: string[];
  run(ticks: number, stopWhen?: (s: Readonly<GameState>) => boolean): number;
}

/** Should the kick meter be pressed on this tick? Aims at 90% power, dead-on. */
function wantsMeterPress(state: Readonly<GameState>): boolean {
  const km = state.play?.kickMeter;
  if (!km || !km.active) return false;
  if (km.startTick < 0) return true;
  if (km.powerLockTick === null) {
    return state.tick - km.startTick >= Math.round(0.9 * KICK.meterFillTicks);
  }
  if (km.accuracyLockTick === null) {
    return state.tick - km.powerLockTick >= Math.round(0.5 * KICK.meterSweepTicks);
  }
  return false;
}

/**
 * Movement for the controlled player, expressed in CAMERA space: the session
 * rotates it into world yards, so the auto-pilot pre-multiplies by the viewer's
 * attack direction the same way the renderer flips the field.
 */
function autoMove(state: Readonly<GameState>, user: TeamSide): { x: number; y: number } {
  const p = state.play;
  if (!p || p.controlledIdx < 0) return { x: 0, y: 0 };
  const me = p.players[p.controlledIdx];
  if (!me) return { x: 0, y: 0 };
  const view = state.attackDir[user];
  if (me.hasBall) {
    return { x: 0, y: state.attackDir[me.team] * view };
  }
  const dx = p.ball.pos2.x - me.pos2.x;
  const dy = p.ball.pos2.y - me.pos2.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 0.5) return { x: 0, y: 0 };
  return { x: (dx / mag) * view, y: (dy / mag) * view };
}

export function makeHarness(opts: HarnessOptions): Harness {
  const renderer = opts.renderer === undefined ? stubRenderer() : (opts.renderer as StubRenderer | null);
  const input = new ScriptedInput();
  const prompts: Array<UserPrompt | null> = [];
  const selected: string[] = [];

  const session = new GameSession({
    config: {
      quarterLengthSec: opts.quarterLengthSec ?? 60,
      difficulty: opts.difficulty ?? 'pro',
      userTeam: opts.userTeam,
      allowTies: true,
      penaltiesEnabled: opts.penaltiesEnabled ?? true,
      enableOnside: false,
    },
    rosters: testRosters(),
    seed: opts.seed ?? 4242,
    audio: new NullAudioEngine(),
    teams: testTeams(),
    input,
    renderer,
    hooks: {
      onPrompt: (prompt, s) => {
        prompts.push(prompt);
        if (prompt !== null && prompt.kind === 'playCall') {
          const id = s.coachSuggestions(1)[0];
          if (id !== undefined) selected.push(id);
        }
        opts.onPrompt?.(prompt, s);
      },
    },
  });

  input.autoFrame = (context): InputFrame | null => {
    const s = session.state;
    switch (context) {
      case InputContext.PRE_SNAP_OFF:
        return frameOf([GameAction.Snap]);
      case InputContext.KICK_METER:
        return wantsMeterPress(s) ? frameOf([GameAction.MeterPress]) : frameOf([]);
      case InputContext.BALL_CARRIER:
      case InputContext.DEFENSE:
      case InputContext.RETURN_WAIT:
        return frameOf([GameAction.Sprint], autoMove(s, opts.userTeam));
      default:
        return null;
    }
  };

  const run = (ticks: number, stopWhen?: (s: Readonly<GameState>) => boolean): number => {
    let stepped = 0;
    for (let i = 0; i < ticks; i++) {
      if (stopWhen?.(session.state)) break;
      if (session.state.phase === GamePhase.GAME_OVER) break;
      session.stepOneTick();
      stepped++;
    }
    return stepped;
  };

  return { session, input, renderer, prompts, selected, run };
}

/** Auto-pilot answers for every prompt a human would otherwise have to make. */
export function autoAnswer(prompt: UserPrompt | null, session: GameSession): void {
  if (prompt === null) return;
  switch (prompt.kind) {
    case 'playCall': {
      const id = session.coachSuggestions(1)[0];
      if (id !== undefined) session.selectPlay(id);
      return;
    }
    case 'penalty':
      session.decidePenalty('accept');
      return;
    case 'pat':
      session.choosePat('xp');
      return;
    case 'coinToss':
      session.chooseCoinToss('receive');
      return;
    case 'halftime':
      session.continueBreak();
      return;
    case 'gameOver':
      return;
  }
}
