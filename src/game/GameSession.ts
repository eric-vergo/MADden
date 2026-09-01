// The glue between the pure sim and everything presentational: owns the
// GameSim, samples input into the right context each tick, funnels UI choices
// in as SimCommands, fans events out to audio + play-by-play, keeps the
// snapshot double-buffer the renderer interpolates between, and tells the App
// when the user owes the game a decision.
//
// Every collaborator is injected, so the whole class runs headless with a
// NullAudioEngine and no renderer at all.

import { TICK_DT, TICK_HZ } from '../sim/constants';
import { GameSim } from '../sim/GameSim';
import type { SimCommand, SimEvent } from '../sim/events';
import {
  GameAction, GamePhase,
  type GameConfig, type GameState, type InputFrame, type PendingPenaltyDecision,
  type TeamRoster, type TeamSide, type TickSnapshot,
} from '../sim/types';
import { EMPTY_INPUT_FRAME } from '../sim/types';
import { Rng, hashSeed } from '../sim/rng';
import { cpuCallPlay } from '../sim/ai/index';
import { DEAD_PAUSE_TICKS } from '../sim/phases/playDead';
import { InputContext } from '../input/types';
import {
  DEFAULT_REPLAY_SPEED, ReplayBuffer, ReplayController, ReplayTrigger, focusYOf,
  type ReplayFrameView, type ReplaySpeed,
} from '../replay/index';
import type { AudioEngine } from '../audio/AudioEngine';
import { AudioDirector } from '../audio/AudioDirector';
import type { EffectKind } from '../render/EffectsRenderer';
import type {
  BannerSpec, ReceiverKey, RendererExtras, TeamPresentation, TickerLine, YardagePopup,
} from '../render/types';
import type { SettingsSave } from '../save/schemas';
import { PlayByPlay } from './PlayByPlay';

// ---------------------------------------------------------------------------
// Injected surfaces
// ---------------------------------------------------------------------------

/** What the session needs from the input layer (InputSystem satisfies it). */
export interface InputSource {
  sample(context: InputContext): InputFrame;
  reset?(): void;
}

/** What the session needs from the renderer (Renderer satisfies it). */
export interface RenderTarget {
  draw(
    prev: TickSnapshot,
    curr: TickSnapshot,
    alpha: number,
    state: Readonly<GameState>,
    extras: RendererExtras,
  ): void;
  snapCamera(worldY: number): void;
  readonly effects?: {
    emit(kind: EffectKind, x: number, y: number, tick: number): void;
    clear(): void;
  };
  /** Optional zoom hook — the real Renderer's Camera satisfies it. */
  readonly camera?: {
    setZoom(zoom: number): void;
  };
}

// ---------------------------------------------------------------------------
// Prompts — the decisions only a human can make
// ---------------------------------------------------------------------------

export type UserPrompt =
  | { kind: 'playCall'; side: 'offense' | 'defense' }
  | { kind: 'penalty'; decision: PendingPenaltyDecision }
  | { kind: 'pat' }
  | { kind: 'coinToss'; winner: TeamSide; overtime: boolean }
  | { kind: 'halftime' }
  | { kind: 'gameOver' };

function promptKey(p: UserPrompt | null): string {
  if (p === null) return 'none';
  switch (p.kind) {
    case 'playCall': return `playCall:${p.side}`;
    case 'coinToss': return `coinToss:${p.overtime ? 'ot' : 'start'}`;
    case 'penalty': return `penalty:${p.decision.flag.kind}:${p.decision.decidingTeam}`;
    default: return p.kind;
  }
}

export interface GameSessionHooks {
  /** Fires whenever the outstanding user decision changes (null = none). */
  onPrompt?(prompt: UserPrompt | null, session: GameSession): void;
  onPhaseChange?(from: GamePhase, to: GamePhase, session: GameSession): void;
  /** Esc during live play — the App opens the pause screen. */
  onPauseRequested?(session: GameSession): void;
  onGameOver?(state: Readonly<GameState>, session: GameSession): void;
  onEvents?(events: readonly SimEvent[], state: Readonly<GameState>): void;
  /** A big-play replay took the screen; sim ticking is paused until it ends. */
  onReplayStart?(session: GameSession): void;
  onReplayEnd?(session: GameSession, skipped: boolean): void;
}

export interface GameSessionOptions {
  config: GameConfig;
  rosters: [TeamRoster, TeamRoster];
  seed: number;
  audio: AudioEngine;
  teams: readonly [TeamPresentation, TeamPresentation];
  input?: InputSource;
  renderer?: RenderTarget | null;
  settings?: SettingsSave;
  hooks?: GameSessionHooks;
}

// TODO(balance): presentation timings owned by the integration layer.
const QUARTER_BREAK_AUTO_TICKS = 90;
const POPUP_TICKS = 48;
const COVERAGE_HINT_DELAY_TICKS = 120;
/** Camera bump while a replay plays (meta-design section 10). */
const REPLAY_ZOOM = 1.15;
/**
 * Most footage one replay shows — the end of a long scramble, not all of it.
 * Four seconds of tape is eight seconds on screen at the default half speed.
 */
const REPLAY_MAX_SOURCE_TICKS = TICK_HZ * 4;
/** Dead-ball frames kept so the replay ends ON the tackle, not before it. */
const REPLAY_TAIL_TICKS = 30;

/** Difficulties that get the pre-snap coverage hint under the 'auto' setting. */
const AUTO_HINT_DIFFICULTIES: ReadonlySet<string> = new Set(['rookie', 'pro']);

/** Play types whose yardage is a gain worth popping up over the spot. */
const POPUP_PLAY_TYPES: ReadonlySet<string> = new Set(['run', 'pass', 'sack', 'scramble']);

export class GameSession {
  readonly sim: GameSim;
  readonly playByPlay = new PlayByPlay();
  readonly audioDirector: AudioDirector;

  private readonly input: InputSource | null;
  private readonly hooks: GameSessionHooks;
  private readonly teams: readonly [TeamPresentation, TeamPresentation];
  private renderer: RenderTarget | null;
  private settings: SettingsSave | null;

  private queued: SimCommand[] = [];
  private prevSnap: TickSnapshot;
  private currSnap: TickSnapshot;
  private pausedFlag = false;
  private inputEnabled = true;
  private inputWasEnabled = true;
  private lastContext: InputContext = InputContext.MENU;
  private promptKeyCache = 'none';
  private promptCache: UserPrompt | null = null;
  private breakTicks = 0;
  private popup: YardagePopup | null = null;
  /** Tick the offense broke the huddle — the coverage hint counts from here. */
  private huddleBreakTick = -1;
  private finished = false;

  private readonly replayBuffer = new ReplayBuffer();
  private readonly replayTrigger = new ReplayTrigger();
  private replay: ReplayController | null = null;
  private replaySpeed: ReplaySpeed = DEFAULT_REPLAY_SPEED;
  private replayPending = false;
  private deadEnteredTick = -1;

  constructor(private readonly opts: GameSessionOptions) {
    this.sim = new GameSim(opts.config, opts.rosters, opts.seed);
    this.audioDirector = new AudioDirector(opts.audio);
    this.input = opts.input ?? null;
    this.hooks = opts.hooks ?? {};
    this.teams = opts.teams;
    this.renderer = opts.renderer ?? null;
    this.settings = opts.settings ?? null;
    this.prevSnap = this.sim.snapshot();
    this.currSnap = this.prevSnap;
    // The stadium is full before the first snap: bring the crowd bed up now
    // rather than on the first tick. dispose() takes it back down.
    opts.audio.setCrowdIntensity(this.audioDirector.crowdIntensity);
  }

  // --- basic accessors ------------------------------------------------------

  get state(): Readonly<GameState> {
    return this.sim.state;
  }

  get userTeam(): TeamSide | null {
    return this.sim.state.config.userTeam;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  get over(): boolean {
    return this.sim.state.phase === GamePhase.GAME_OVER;
  }

  get prompt(): UserPrompt | null {
    return this.promptCache;
  }

  /** Input context the last sampled tick used (debug / HUD). */
  get context(): InputContext {
    return this.lastContext;
  }

  get snapshots(): readonly [TickSnapshot, TickSnapshot] {
    return [this.prevSnap, this.currSnap];
  }

  /** True while a replay owns the screen (the sim is frozen). */
  get replaying(): boolean {
    return this.replay !== null;
  }

  /** The running replay's cursor, for HUD/debug readouts. */
  get replayController(): ReplayController | null {
    return this.replay;
  }

  /** A replay is armed and waiting for the dead-ball beat to finish. */
  get replayArmed(): boolean {
    return this.replayPending;
  }

  setReplaySpeed(speed: ReplaySpeed): void {
    this.replaySpeed = speed;
    this.replay?.setSpeed(speed);
  }

  /** End the current replay early (any key does this from the REPLAY context). */
  skipReplay(): void {
    this.endReplay(true);
  }

  setRenderer(renderer: RenderTarget | null): void {
    this.renderer = renderer;
  }

  setSettings(settings: SettingsSave): void {
    this.settings = settings;
  }

  /** Disable while a DOM overlay owns the keyboard (play call, pause, prompts). */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }

  pause(): void {
    if (this.pausedFlag) return;
    this.pausedFlag = true;
    this.input?.reset?.();
  }

  resume(): void {
    if (!this.pausedFlag) return;
    this.pausedFlag = false;
    this.input?.reset?.();
  }

  /** Leaving the game for good: silence the crowd, drop transient state. */
  dispose(): void {
    // Final: a stray tick from a loop callback must not restart the crowd.
    this.finished = true;
    this.opts.audio.stopAmbience();
    this.audioDirector.reset();
    this.playByPlay.reset();
    this.input?.reset?.();
    this.replay = null;
    this.replayPending = false;
    this.replayTrigger.reset();
    this.replayBuffer.clear();
    this.renderer?.camera?.setZoom(1);
    this.renderer = null;
  }

  // --- commands -------------------------------------------------------------

  queueCommand(cmd: SimCommand): void {
    this.queued.push(cmd);
  }

  selectPlay(playId: string): void {
    const side = this.userCallSide();
    const user = this.userTeam;
    if (side === null || user === null) return;
    this.queueCommand({ type: 'SELECT_PLAY', team: user, side, playId });
  }

  requestTimeout(): void {
    const user = this.userTeam;
    if (user === null) return;
    this.queueCommand({ type: 'TIMEOUT', team: user });
  }

  decidePenalty(choice: 'accept' | 'decline'): void {
    this.queueCommand(choice === 'accept' ? { type: 'ACCEPT_PENALTY' } : { type: 'DECLINE_PENALTY' });
  }

  choosePat(choice: 'xp' | 'two'): void {
    this.queueCommand({ type: 'CHOOSE_PAT', choice });
  }

  chooseCoinToss(choice: 'receive' | 'kick'): void {
    const s = this.sim.state;
    const winner = s.coin?.winner;
    if (winner === null || winner === undefined) return;
    this.queueCommand({ type: 'COIN_TOSS_CHOICE', team: winner, choice });
  }

  continueBreak(): void {
    this.queueCommand({ type: 'CONTINUE' });
  }

  // --- play-call helpers ----------------------------------------------------

  /** Which side the user is on the hook to call, or null when nobody is. */
  userCallSide(): 'offense' | 'defense' | null {
    const s = this.sim.state;
    const user = s.config.userTeam;
    if (user === null || s.phase !== GamePhase.PLAY_CALL) return null;
    if (user === s.possession) return s.selectedOffensePlayId === null ? 'offense' : null;
    return s.selectedDefensePlayId === null ? 'defense' : null;
  }

  /** Ask Coach: up to `count` distinct situation-appropriate play ids. */
  coachSuggestions(count = 3): string[] {
    const s = this.sim.state;
    const user = s.config.userTeam;
    if (user === null) return [];
    const side: 'offense' | 'defense' = user === s.possession ? 'offense' : 'defense';
    return this.suggestFor(user, side, count);
  }

  suggestFor(team: TeamSide, side: 'offense' | 'defense', count = 3): string[] {
    const s = this.sim.state as GameState;
    const out: string[] = [];
    // A fresh sub-stream per call: the coach must never disturb the sim's rng.
    const rng = new Rng(hashSeed(s.seed, 'coachHint', s.playLog.length, side));
    for (let i = 0; i < count * 6 && out.length < count; i++) {
      const id = cpuCallPlay(s, team, side, rng);
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  // --- the tick -------------------------------------------------------------

  stepOneTick(): void {
    if (this.pausedFlag || this.finished) return;
    const s = this.sim.state;
    if (s.phase === GamePhase.GAME_OVER) return;

    // A replay owns the tick: the sim is frozen mid-PLAY_DEAD and picks up
    // exactly where it left off once the playback finishes or is skipped.
    if (this.replay !== null) {
      this.stepReplay();
      return;
    }
    if (this.replayPending && this.startReplayIfReady()) return;

    const context = this.deriveContext();
    const frame = this.sampleInput(context);
    this.lastContext = context;

    this.readFrame(frame, context);
    this.autoAdvanceBreaks();

    const commands = this.queued;
    this.queued = [];
    const events = this.sim.tick({ frame, commands });

    this.prevSnap = this.currSnap;
    this.currSnap = this.sim.snapshot();

    this.handleEvents(events);
    this.recordFrame();
  }

  render(alpha: number, frameDtSec: number = TICK_DT): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const view = this.replay?.view() ?? null;
    if (view !== null) {
      // Playback owns its own interpolation, so the live loop's alpha is
      // deliberately ignored here.
      renderer.draw(view.prev, view.curr, view.alpha, this.sim.state, this.replayExtras(frameDtSec, view));
      return;
    }
    renderer.draw(this.prevSnap, this.currSnap, alpha, this.sim.state, this.buildExtras(frameDtSec));
  }

  // --- replay ---------------------------------------------------------------

  /**
   * Feed the ring: ~1s of pre-snap lead, every live tick, and a short dead-ball
   * tail so the replay ends on the tackle instead of the frame before it.
   */
  private recordFrame(): void {
    const s = this.sim.state;
    if (s.phase === GamePhase.PRE_SNAP) {
      this.replayBuffer.pushLead(this.currSnap);
      return;
    }
    if (s.phase === GamePhase.PLAY_LIVE) {
      this.replayBuffer.push(this.currSnap);
      return;
    }
    if (s.phase === GamePhase.PLAY_DEAD && s.tick - this.deadEnteredTick <= REPLAY_TAIL_TICKS) {
      this.replayBuffer.push(this.currSnap);
    }
  }

  /** New snap: drop the previous play and flush the pre-snap lead in. */
  private beginReplayRecording(): void {
    const s = this.sim.state;
    const p = s.play;
    this.replayBuffer.beginPlay({
      startTick: s.tick,
      description: p === null ? 'play' : `${p.offensePlay.name} vs ${p.defensePlay.name}`,
      bigPlay: false,
    });
  }

  /** Big-play policy: arm a replay for the dead-ball beat that follows. */
  private evaluateReplay(events: readonly SimEvent[]): void {
    const s = this.sim.state;
    // A replay is presentation: it costs a human nothing and a headless driver
    // (no renderer, or nobody's team) a pile of ticks it never sees.
    if (this.renderer === null || s.config.userTeam === null) return;
    const clock = { quarter: s.quarter, clockSec: s.clockSec };
    if (!this.replayTrigger.offer(events, clock)) return;
    this.replayTrigger.arm(clock);
    const line = this.playByPlay.lastLine;
    this.replayBuffer.annotate(line === '' ? { bigPlay: true } : { bigPlay: true, description: line });
    this.replayPending = true;
  }

  /**
   * Replays only ever cut in at the end of the dead-ball pause, where nothing
   * else owns the screen. A play that resolved through the penalty prompt has
   * already moved on by the time its result lands, so that one is let go.
   */
  private startReplayIfReady(): boolean {
    const s = this.sim.state;
    if (s.phase !== GamePhase.PLAY_DEAD) {
      this.replayPending = false;
      return false;
    }
    if (s.tick - this.deadEnteredTick < DEAD_PAUSE_TICKS) return false;
    return this.startReplay();
  }

  private startReplay(): boolean {
    this.replayPending = false;
    const play = this.replayBuffer.lastPlay(REPLAY_MAX_SOURCE_TICKS);
    if (play === null || play.frames.length < 2) return false;

    this.replay = new ReplayController(play, this.replaySpeed);
    this.input?.reset?.();
    this.lastContext = InputContext.REPLAY;
    const first = play.frames[0];
    if (first !== undefined) {
      this.renderer?.snapCamera(focusYOf(first) ?? this.sim.state.ballOnY);
    }
    this.renderer?.camera?.setZoom(REPLAY_ZOOM);
    this.hooks.onReplayStart?.(this);
    return true;
  }

  /** One tick of playback. Any key in the REPLAY context skips out. */
  private stepReplay(): void {
    const replay = this.replay;
    if (replay === null) return;
    const frame = this.sampleInput(InputContext.REPLAY);
    this.lastContext = InputContext.REPLAY;
    if (frame.pressed.size > 0) {
      this.endReplay(true);
      return;
    }
    // Ending on the tick the cursor lands would cut the last frame before it is
    // ever drawn, so the finished replay holds for one tick first.
    if (replay.done) {
      this.endReplay(false);
      return;
    }
    replay.advance(1);
  }

  private endReplay(skipped: boolean): void {
    if (this.replay === null) return;
    this.replay = null;
    this.renderer?.camera?.setZoom(1);
    this.renderer?.snapCamera(this.cameraTargetY());
    this.input?.reset?.();
    this.hooks.onReplayEnd?.(this, skipped);
  }

  // --- input ----------------------------------------------------------------

  private sampleInput(context: InputContext): InputFrame {
    if (!this.inputEnabled || this.input === null) {
      if (this.inputWasEnabled) {
        this.inputWasEnabled = false;
        this.input?.reset?.();
      }
      return EMPTY_INPUT_FRAME;
    }
    this.inputWasEnabled = true;
    return this.orient(this.input.sample(context));
  }

  /**
   * The input layer reports movement in camera space ("up" = up the screen).
   * When the viewer's team attacks -y the camera is flipped, so the stick has
   * to be rotated 180 degrees before the sim, which works in world yards.
   */
  private orient(frame: InputFrame): InputFrame {
    const s = this.sim.state;
    const viewer = s.config.userTeam;
    if (viewer === null || s.attackDir[viewer] === 1) return frame;
    if (frame.move.x === 0 && frame.move.y === 0) return frame;
    return {
      held: frame.held,
      pressed: frame.pressed,
      released: frame.released,
      move: { x: -frame.move.x, y: -frame.move.y },
    };
  }

  private deriveContext(): InputContext {
    if (this.pausedFlag) return InputContext.PAUSED;
    const s = this.sim.state;
    const user = s.config.userTeam;
    if (user === null) return InputContext.MENU;
    switch (s.phase) {
      case GamePhase.PLAY_CALL:
        return InputContext.PLAY_CALL;
      case GamePhase.PRE_SNAP:
        return s.possession === user ? InputContext.PRE_SNAP_OFF : InputContext.PRE_SNAP_DEF;
      case GamePhase.PLAY_LIVE:
        return this.liveContext(user);
      default:
        return InputContext.MENU;
    }
  }

  private liveContext(user: TeamSide): InputContext {
    const s = this.sim.state;
    const p = s.play;
    if (p === null) return InputContext.MENU;
    // The kicking team owns the meter while it is live.
    if (p.kickMeter.active && s.possession === user) return InputContext.KICK_METER;

    const ctrl = p.controlledIdx >= 0 ? p.players[p.controlledIdx] : undefined;
    if (ctrl === undefined) return InputContext.MENU;
    const mode = p.ball.mode;
    if ((mode === 'kick' || mode === 'punt') && ctrl.team !== s.possession) {
      return InputContext.RETURN_WAIT;
    }
    if (ctrl.hasBall) {
      const dir = s.attackDir[s.possession];
      const behindLos = (ctrl.pos2.y - p.lineOfScrimmageY) * dir <= 0.5;
      if (ctrl.role === 'QB' && mode === 'held' && behindLos) return InputContext.QB_PASSING;
      return InputContext.BALL_CARRIER;
    }
    return ctrl.team === s.possession ? InputContext.BALL_CARRIER : InputContext.DEFENSE;
  }

  /** Turn frame edges the sim does not read itself into SimCommands. */
  private readFrame(frame: InputFrame, context: InputContext): void {
    const s = this.sim.state;
    const user = s.config.userTeam;
    if (user === null) return;

    if (frame.pressed.has(GameAction.Pause)) {
      this.hooks.onPauseRequested?.(this);
      return;
    }
    if (context === InputContext.MENU && frame.pressed.has(GameAction.Back)) {
      this.hooks.onPauseRequested?.(this);
      return;
    }

    if (frame.pressed.has(GameAction.Timeout) && s.timeouts[user] > 0) {
      this.queueCommand({ type: 'TIMEOUT', team: user });
    }

    if (context === InputContext.DEFENSE && frame.pressed.has(GameAction.SwitchPlayer)) {
      this.switchToNearestDefender();
    }
    if (context === InputContext.PRE_SNAP_DEF) {
      if (frame.pressed.has(GameAction.SwitchPlayer)) this.cycleDefender();
      if (frame.pressed.has(GameAction.Snap)) this.switchToDefenderNearestLos();
    }
    if (context === InputContext.RETURN_WAIT) {
      if (frame.pressed.has(GameAction.FairCatch)) {
        this.queueCommand({ type: 'RETURN_DECISION', choice: 'kneel' });
      } else if (Math.hypot(frame.move.x, frame.move.y) > 0.25) {
        this.queueCommand({ type: 'RETURN_DECISION', choice: 'return' });
      }
    }
  }

  /** Breaks the user has no say in still need a nudge to move along. */
  private autoAdvanceBreaks(): void {
    const s = this.sim.state;
    if (s.phase !== GamePhase.QUARTER_BREAK) {
      this.breakTicks = 0;
      return;
    }
    this.breakTicks++;
    const waited = this.breakTicks - QUARTER_BREAK_AUTO_TICKS;
    // Retry every half second: a dropped CONTINUE must never strand the game.
    if (waited >= 0 && waited % 30 === 0) this.continueBreak();
  }

  // --- defender switching ---------------------------------------------------

  private defenderIndices(): number[] {
    const p = this.sim.state.play;
    if (p === null) return [];
    const out: number[] = [];
    for (let i = 0; i < p.players.length; i++) {
      const pl = p.players[i];
      if (pl !== undefined && pl.team !== this.sim.state.possession) out.push(i);
    }
    return out;
  }

  private switchTo(idx: number): void {
    const p = this.sim.state.play;
    if (p === null || idx < 0 || idx === p.controlledIdx) return;
    this.queueCommand({ type: 'SWITCH_CONTROLLED', playerIdx: idx });
  }

  /** SwitchPlayer during a live play grabs the defender closest to the ball. */
  private switchToNearestDefender(): void {
    const p = this.sim.state.play;
    if (p === null) return;
    const target = p.ball.pos2;
    let best = -1;
    let bestD = Infinity;
    for (const i of this.defenderIndices()) {
      const pl = p.players[i];
      if (pl === undefined || pl.anim === 'down') continue;
      const d = Math.hypot(pl.pos2.x - target.x, pl.pos2.y - target.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.switchTo(best);
  }

  private switchToDefenderNearestLos(): void {
    const p = this.sim.state.play;
    if (p === null) return;
    let best = -1;
    let bestD = Infinity;
    for (const i of this.defenderIndices()) {
      const pl = p.players[i];
      if (pl === undefined) continue;
      const d = Math.abs(pl.pos2.y - p.lineOfScrimmageY);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.switchTo(best);
  }

  private cycleDefender(): void {
    const p = this.sim.state.play;
    if (p === null) return;
    const list = this.defenderIndices();
    if (list.length === 0) return;
    const at = list.indexOf(p.controlledIdx);
    const next = list[(at + 1 + list.length) % list.length];
    if (next !== undefined) this.switchTo(next);
  }

  // --- events ---------------------------------------------------------------

  private handleEvents(events: readonly SimEvent[]): void {
    const s = this.sim.state;
    this.audioDirector.handle(events, s);
    this.playByPlay.handle(events, s);
    this.hooks.onEvents?.(events, s);

    for (const ev of events) {
      switch (ev.type) {
        case 'PHASE_CHANGE':
          this.onPhaseChange(ev.from, ev.to, ev.tick);
          break;
        case 'CATCH':
          this.emitEffect('catchFlash');
          break;
        case 'TACKLE':
          if (ev.bigHit) this.emitEffect('bigHit');
          else this.emitEffect('dust');
          break;
        case 'PLAY_RESULT':
          this.setYardagePopup(ev.playType, ev.yards);
          break;
        case 'GAME_OVER':
          this.finished = true;
          this.opts.audio.stopAmbience();
          this.hooks.onGameOver?.(s, this);
          break;
        default:
          break;
      }
    }
    this.evaluateReplay(events);
    this.expirePresentation();
    this.refreshPrompt();
  }

  /** `changeTick` is the sim tick the transition happened on, not tick+1. */
  private onPhaseChange(from: GamePhase, to: GamePhase, changeTick: number): void {
    // A new snap: cut the camera rather than sweeping it down the field.
    if (to === GamePhase.PRE_SNAP) {
      const los = this.sim.state.play?.lineOfScrimmageY ?? this.sim.state.ballOnY;
      this.renderer?.snapCamera(los);
      // The hint is a read, and a read takes time at the line — not time spent
      // in the play-call menu, which is where PLAY_CALL would have measured it.
      this.huddleBreakTick = changeTick;
    }
    if (to === GamePhase.PLAY_LIVE) this.beginReplayRecording();
    if (to === GamePhase.PLAY_DEAD) this.deadEnteredTick = changeTick;
    this.hooks.onPhaseChange?.(from, to, this);
  }

  private emitEffect(kind: EffectKind): void {
    const effects = this.renderer?.effects;
    const ball = this.currSnap.ball;
    if (!effects || !ball) return;
    effects.emit(kind, ball.x, ball.y, this.currSnap.tick);
  }

  /**
   * Only plays from scrimmage get a yardage popup: on a punt or a kickoff
   * `yards` is the kick distance, and "+45" over a punt reads as a gain.
   */
  private setYardagePopup(playType: string, yards: number): void {
    if (!POPUP_PLAY_TYPES.has(playType)) return;
    const s = this.sim.state;
    const ball = this.currSnap.ball;
    this.popup = {
      yards,
      x: ball?.x ?? 26.7,
      y: ball?.y ?? s.ballOnY,
      startTick: s.tick,
    };
  }

  private expirePresentation(): void {
    const tick = this.sim.state.tick;
    if (this.popup !== null && tick - this.popup.startTick > POPUP_TICKS) this.popup = null;
  }

  // --- prompts --------------------------------------------------------------

  private computePrompt(): UserPrompt | null {
    const s = this.sim.state;
    const user = s.config.userTeam;
    if (user === null) return null;
    switch (s.phase) {
      case GamePhase.GAME_OVER:
        return { kind: 'gameOver' };
      case GamePhase.HALFTIME:
        return { kind: 'halftime' };
      case GamePhase.COIN_TOSS:
      case GamePhase.OVERTIME_TOSS: {
        const coin = s.coin;
        if (coin === null || coin.winner === null || coin.winner !== user) return null;
        return { kind: 'coinToss', winner: coin.winner, overtime: s.phase === GamePhase.OVERTIME_TOSS };
      }
      case GamePhase.POINT_AFTER_CHOICE:
        return s.possession === user ? { kind: 'pat' } : null;
      case GamePhase.PENALTY_DECISION: {
        const d = s.pendingPenalty;
        if (d === null || d.decidingTeam !== user) return null;
        return { kind: 'penalty', decision: d };
      }
      case GamePhase.PLAY_CALL: {
        const side = this.userCallSide();
        return side === null ? null : { kind: 'playCall', side };
      }
      default:
        return null;
    }
  }

  /** Recompute the outstanding prompt and notify only on a real change. */
  refreshPrompt(): void {
    const next = this.computePrompt();
    const key = promptKey(next);
    if (key === this.promptKeyCache) {
      this.promptCache = next;
      return;
    }
    this.promptKeyCache = key;
    this.promptCache = next;
    this.hooks.onPrompt?.(next, this);
  }

  // --- renderer extras ------------------------------------------------------

  private cameraTargetY(): number {
    const curr = this.currSnap;
    if (curr.ball) return curr.ball.y;
    for (const p of curr.players) {
      if (p.hasBall) return p.y;
    }
    if (curr.lineOfScrimmageY !== null) return curr.lineOfScrimmageY;
    return this.sim.state.ballOnY;
  }

  private receiverKeys(): ReceiverKey[] {
    const p = this.sim.state.play;
    if (p === null) return [];
    const out: ReceiverKey[] = [];
    for (let i = 0; i < 11 && out.length < 5; i++) {
      const pl = p.players[i];
      if (pl === undefined) continue;
      const kind = pl.assignment.kind;
      if (kind === 'route' || kind === 'passProScan') out.push({ idx: i, key: out.length + 1 });
    }
    return out;
  }

  private showReceiverKeys(): boolean {
    const s = this.sim.state;
    const p = s.play;
    if (p === null || s.phase !== GamePhase.PLAY_LIVE) return false;
    if (s.config.userTeam !== s.possession) return false;
    const ctrl = p.controlledIdx >= 0 ? p.players[p.controlledIdx] : undefined;
    return ctrl !== undefined && ctrl.hasBall && ctrl.role === 'QB' && p.ball.mode === 'held';
  }

  private passLanding(): { x: number; y: number } | null {
    const p = this.sim.state.play;
    if (p === null || p.ball.mode !== 'pass') return null;
    const target = p.ball.targetIdx === null ? undefined : p.players[p.ball.targetIdx];
    if (target === undefined) return null;
    return { x: target.pos2.x, y: target.pos2.y };
  }

  private coverageHint(): string | null {
    const s = this.sim.state;
    const p = s.play;
    if (p === null || s.phase !== GamePhase.PRE_SNAP) return null;
    if (s.config.userTeam !== s.possession) return null;
    const mode = this.settings?.coverageHints ?? 'auto';
    if (mode === 'off') return null;
    if (mode === 'auto' && !AUTO_HINT_DIFFICULTIES.has(s.config.difficulty)) return null;
    if (this.huddleBreakTick < 0 || s.tick - this.huddleBreakTick < COVERAGE_HINT_DELAY_TICKS) {
      return null;
    }

    const shell = p.defensePlay.shell;
    // Nobody reads coverage on a kickoff.
    if (shell === 'specialTeams') return null;
    const trueLabel = shell === 'cover0' || shell === 'cover1' || shell === 'cover2man' ? 'MAN' : 'ZONE';
    // A hint is a read, not a readout: it lies sometimes, deterministically.
    const qb = p.players[p.controlledIdx >= 0 ? p.controlledIdx : 0];
    const accuracy = 0.55 + (qb?.ratings.awr ?? 70) * 0.004;
    const rng = new Rng(hashSeed(s.seed, 'hint', s.playLog.length));
    const shown = rng.chance(accuracy) ? trueLabel : trueLabel === 'MAN' ? 'ZONE' : 'MAN';
    return `COVERAGE: ${shown}?`;
  }

  private ticker(): TickerLine | null {
    return this.playByPlay.ticker;
  }

  private banner(): BannerSpec | null {
    return this.playByPlay.banner;
  }

  /**
   * Replay frames go through the same Renderer.draw, so everything the HUD and
   * the live overlays would add is switched off here: what is left is the
   * field, the players, the letterbox and the REPLAY banner.
   */
  private replayExtras(frameDtSec: number, view: ReplayFrameView): RendererExtras {
    const s = this.sim.state;
    const viewer = s.config.userTeam ?? 0;
    return {
      frameDtSec,
      teams: this.teams,
      ticker: null,
      banner: null,
      coverageHint: null,
      yardagePopup: null,
      receiverKeys: [],
      showReceiverKeys: false,
      passLanding: null,
      replay: true,
      showHud: false,
      cameraTargetY: focusYOf(view.curr) ?? s.ballOnY,
      viewAttackDir: s.attackDir[viewer],
      debug: false,
    };
  }

  buildExtras(frameDtSec: number): RendererExtras {
    const s = this.sim.state;
    const viewer = s.config.userTeam ?? 0;
    return {
      frameDtSec,
      teams: this.teams,
      ticker: this.ticker(),
      banner: this.banner(),
      coverageHint: this.coverageHint(),
      yardagePopup: this.popup,
      receiverKeys: this.receiverKeys(),
      showReceiverKeys: this.showReceiverKeys(),
      passLanding: this.passLanding(),
      replay: false,
      showHud: true,
      cameraTargetY: this.cameraTargetY(),
      viewAttackDir: s.attackDir[viewer],
      debug: false,
    };
  }
}
