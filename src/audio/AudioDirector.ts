// Turns the SimEvent stream into sound: one-shot SFX plus an ambient crowd
// intensity derived from the game situation. Engine-agnostic (drives the frozen
// AudioEngine interface only), stateless w.r.t. the sim — it never mutates
// GameState, so it is safe to run on a Readonly view every tick.

import { GOAL_AWAY_Y, GOAL_HOME_Y, TWO_MINUTE_SEC } from '../sim/constants';
import type { SimEvent } from '../sim/events';
import type { GameState, TeamSide } from '../sim/types';
import type { AudioEngine } from './AudioEngine';

// TODO(balance): crowd situation model. Local until the consolidation pass.
const CROWD = {
  base: 0.25,
  redZoneBoost: 0.15,
  redZoneYd: 20,
  twoMinuteBoost: 0.12,
  closeQ4Boost: 0.15,
  closeQ4Margin: 8,
  closeQ4ClockSec: 300,
  /** Transient excitement decay per sim tick (~0.62 after 1s, ~0.15 after 4s). */
  decayPerTick: 0.992,
  /** Excitement is signed: a dagger by the other team pulls the bed down. */
  excitementMax: 0.7,
  excitementMin: -0.2,
  /** Negative reactions land softer than positive ones. */
  negativeScale: 0.7,
} as const;

// TODO(balance): per-event crowd reaction magnitudes.
const REACT = {
  bigHit: 0.12,
  sack: 0.25,
  interception: 0.4,
  fumble: 0.3,
  fumbleRecovered: 0.2,
  touchdown: 0.6,
  fieldGoalGood: 0.35,
  fieldGoalMiss: 0.3,
  patMiss: 0.2,
  twoPointGood: 0.3,
  safety: 0.4,
  firstDown: 0.15,
  kickBlocked: 0.4,
  bigPlay: 0.2,
  flag: 0.1,
  gameOver: 0.5,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function other(team: TeamSide): TeamSide {
  return team === 0 ? 1 : 0;
}

export class AudioDirector {
  private excitement = 0;
  private lastTick = -1;
  private intensity: number = CROWD.base;
  /** Set while handling one batch so TACKLE+SACK don't stack two impacts. */
  private hitThisBatch = false;

  constructor(private readonly engine: AudioEngine) {}

  /** Last value pushed to the engine (debug / demo readout). */
  get crowdIntensity(): number {
    return this.intensity;
  }

  /** Drop transient state when a game ends or the engine is re-pointed. */
  reset(): void {
    this.excitement = 0;
    this.lastTick = -1;
    this.intensity = CROWD.base;
  }

  handle(events: readonly SimEvent[], state: Readonly<GameState>): void {
    this.decay(state.tick);
    this.hitThisBatch = false;
    for (const ev of events) this.dispatch(ev, state);
    this.intensity = clamp(this.situationBase(state) + this.excitement, 0, 1);
    this.engine.setCrowdIntensity(this.intensity);
  }

  // --- Crowd model ----------------------------------------------------------

  private decay(tick: number): void {
    const dt = this.lastTick < 0 ? 0 : Math.max(0, tick - this.lastTick);
    this.lastTick = tick;
    if (dt > 0 && this.excitement !== 0) {
      this.excitement *= Math.pow(CROWD.decayPerTick, dt);
      if (Math.abs(this.excitement) < 0.001) this.excitement = 0;
    }
  }

  private situationBase(state: Readonly<GameState>): number {
    let v = CROWD.base;
    if (this.isRedZone(state)) v += CROWD.redZoneBoost;
    if (this.isTwoMinute(state)) v += CROWD.twoMinuteBoost;
    if (this.isCloseLate(state)) v += CROWD.closeQ4Boost;
    return v;
  }

  private isRedZone(state: Readonly<GameState>): boolean {
    const dir = state.attackDir[state.possession];
    const toGoal = dir === 1 ? GOAL_AWAY_Y - state.ballOnY : state.ballOnY - GOAL_HOME_Y;
    return toGoal >= 0 && toGoal <= CROWD.redZoneYd;
  }

  private isTwoMinute(state: Readonly<GameState>): boolean {
    const endOfHalf = state.quarter === 2 || state.quarter >= 4;
    return endOfHalf && state.clockSec <= TWO_MINUTE_SEC;
  }

  private isCloseLate(state: Readonly<GameState>): boolean {
    if (state.quarter < 4) return false;
    const margin = Math.abs(state.score[0] - state.score[1]);
    return margin <= CROWD.closeQ4Margin && state.clockSec <= CROWD.closeQ4ClockSec;
  }

  /** The crowd belongs to the user's team (home stands when CPU vs CPU). */
  private crowdTeam(state: Readonly<GameState>): TeamSide {
    return state.config.userTeam ?? 0;
  }

  /**
   * Something good happened for `team`: cheer + lift, or groan + dip when it
   * was the other side. The engine turns crowdCheer/crowdGroan into the
   * swell/deflate automation on its ambient bed.
   */
  private react(team: TeamSide, magnitude: number, state: Readonly<GameState>): void {
    if (team === this.crowdTeam(state)) {
      this.excitement = clamp(this.excitement + magnitude, CROWD.excitementMin, CROWD.excitementMax);
      this.engine.play('crowdCheer', { volume: clamp(0.5 + magnitude, 0.5, 1) });
    } else {
      this.excitement = clamp(
        this.excitement - magnitude * CROWD.negativeScale,
        CROWD.excitementMin,
        CROWD.excitementMax,
      );
      this.engine.play('crowdGroan', { volume: clamp(0.5 + magnitude, 0.5, 1) });
    }
  }

  private impact(big: boolean): void {
    if (this.hitThisBatch) return;
    this.hitThisBatch = true;
    this.engine.play(big ? 'hitBig' : 'hitLight');
  }

  // --- Event mapping --------------------------------------------------------

  private dispatch(ev: SimEvent, state: Readonly<GameState>): void {
    // The tackling side is the team not in possession at the time of the hit.
    const defense = other(state.possession);

    switch (ev.type) {
      case 'WHISTLE':
        this.engine.play('whistle');
        break;

      case 'PASS_THROWN':
        this.engine.play('throw', { pitch: ev.bullet ? 1.1 : 1 });
        break;

      case 'CATCH':
        this.engine.play('catch', { volume: ev.contested ? 1 : 0.85 });
        break;

      case 'TACKLE':
        this.impact(ev.bigHit);
        if (ev.bigHit) this.react(defense, REACT.bigHit, state);
        break;

      case 'SACK':
        this.impact(true);
        this.react(defense, REACT.sack, state);
        break;

      case 'INTERCEPTION':
        this.engine.play('turnoverSting');
        this.react(defense, REACT.interception, state);
        break;

      case 'FUMBLE':
        this.engine.play('turnoverSting');
        this.react(defense, REACT.fumble, state);
        break;

      case 'FUMBLE_RECOVERED':
        this.react(ev.team, REACT.fumbleRecovered, state);
        break;

      case 'TOUCHDOWN':
        this.engine.play('touchdownFanfare');
        this.react(ev.team, REACT.touchdown, state);
        break;

      case 'FIELD_GOAL_RESULT':
        if (ev.good) {
          this.engine.play('fgGood');
          this.react(ev.team, REACT.fieldGoalGood, state);
        } else {
          this.react(other(ev.team), REACT.fieldGoalMiss, state);
        }
        break;

      case 'XP_RESULT':
        if (ev.good) this.engine.play('fgGood', { volume: 0.6 });
        else this.react(other(ev.team), REACT.patMiss, state);
        break;

      case 'TWO_POINT_RESULT':
        if (ev.good) {
          this.engine.play('firstDownChime');
          this.react(ev.team, REACT.twoPointGood, state);
        } else {
          this.react(other(ev.team), REACT.patMiss, state);
        }
        break;

      case 'SAFETY':
        this.engine.play('turnoverSting');
        this.react(ev.scoringTeam, REACT.safety, state);
        break;

      case 'FIRST_DOWN':
        this.engine.play('firstDownChime');
        this.react(ev.team, REACT.firstDown, state);
        break;

      // `team` on TURNOVER_ON_DOWNS is side-ambiguous in the contract, so this
      // one gets the sting without a directional crowd reaction.
      case 'TURNOVER_ON_DOWNS':
        this.engine.play('turnoverSting');
        break;

      case 'FLAG':
        this.engine.play('flag');
        this.react(other(ev.flag.team), REACT.flag, state);
        break;

      case 'TIMEOUT':
        this.engine.play('timeoutHorn');
        break;

      case 'KICK_LAUNCHED':
        this.engine.play(ev.style === 'punt' ? 'puntThump' : 'kickThump');
        break;

      case 'KICK_BLOCKED':
        this.impact(true);
        this.react(defense, REACT.kickBlocked, state);
        break;

      case 'TWO_MINUTE_WARNING':
        this.engine.play('clockWarning');
        break;

      case 'PLAY_CLOCK_WARNING':
        this.engine.play('clockWarning', { volume: 0.5 });
        break;

      case 'BIG_PLAY':
        this.excitement = clamp(
          this.excitement + REACT.bigPlay,
          CROWD.excitementMin,
          CROWD.excitementMax,
        );
        break;

      case 'GAME_OVER': {
        this.engine.play('whistle');
        const [home, away] = ev.finalScore;
        if (home !== away) this.react(home > away ? 0 : 1, REACT.gameOver, state);
        break;
      }

      default:
        break;
    }
  }
}
