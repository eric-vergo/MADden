// The broadcast booth: turns the SimEvent stream into the HUD ticker line and
// the big-play banner. Templates are the 18 authored in meta-design section 9;
// the variant for a given play is picked with a seeded Rng so the same game
// replays with the same call. Pure presentation — nothing here touches the sim.

import type { SimEvent } from '../sim/events';
import { Rng, hashSeed } from '../sim/rng';
import { spotLabel } from '../sim/rules/downs';
import type { GameState, TeamSide } from '../sim/types';
import type { BannerKind, BannerSpec, TickerLine } from '../render/types';

/** Ticks a banner stays on screen (matches EFFECT_STYLE.bannerTicks). */
const BANNER_TICKS = 84;

/** Ticks a ticker line stays on screen before it clears. */
const TICKER_TICKS = 60 * 7;

export interface TickerTemplate {
  /** 1-based id from meta-design section 9. */
  id: number;
  text: string;
}

/** The authored ticker copy, in design order. `{}` slots are filled per play. */
export const TICKER_TEMPLATES: readonly TickerTemplate[] = [
  { id: 1, text: '{carrier} up the middle for {yds} yards.' },
  { id: 2, text: '{carrier} bounces it outside for {yds}.' },
  { id: 3, text: '{carrier} stuffed at the line by {defender}.' },
  { id: 4, text: '{qb} hits {receiver} over the middle for {yds}.' },
  { id: 5, text: '{qb} finds {receiver} down the sideline for {yds} yards!' },
  { id: 6, text: "{qb}'s pass falls incomplete, intended for {receiver}." },
  { id: 7, text: '{qb} throws it away under pressure.' },
  { id: 8, text: '{qb} scrambles for {yds} yards.' },
  { id: 9, text: 'SACK! {defender} drops {qb} for a loss of {yds}.' },
  { id: 10, text: 'INTERCEPTED! {defender} picks off {qb} at the {spot}.' },
  { id: 11, text: 'FUMBLE! {defender} comes up with it for {team}.' },
  { id: 12, text: 'TOUCHDOWN {team}! {scorer} from {yds} yards out!' },
  { id: 13, text: "{kicker}'s {dist}-yard field goal attempt is GOOD." },
  { id: 14, text: "{kicker}'s {dist}-yarder is NO GOOD, wide {side}." },
  { id: 15, text: '{punter} booms it {dist} yards, downed at the {spot}.' },
  { id: 16, text: '{returner} brings the kick out {yds} yards to the {spot}.' },
  { id: 17, text: 'Flag down: {penalty} on {team}, {yds} yards.' },
  { id: 18, text: '{team} burns a timeout. {n} remaining.' },
];

const TEMPLATE_BY_ID = new Map<number, string>(
  TICKER_TEMPLATES.map((t) => [t.id, t.text]),
);

const PENALTY_WORDS: Readonly<Record<string, string>> = {
  falseStart: 'false start',
  offside: 'offside',
  encroachment: 'encroachment',
  delayOfGame: 'delay of game',
  holding: 'holding',
  dpi: 'pass interference',
  opi: 'offensive pass interference',
};

type Slots = Readonly<Record<string, string | number>>;

function fill(template: string, slots: Slots): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = slots[key];
    return v === undefined ? whole : `${v}`;
  });
}

export class PlayByPlay {
  private text = '';
  private textTick = -1;
  private lineExpired = false;
  private bannerSpec: BannerSpec | null = null;
  /** Scratch collected across one tick's event batch before PLAY_RESULT. */
  private lastFgDistance = 0;
  private lastFgSide: 'left' | 'right' | 'short' | null = null;
  private lastKickStyle: 'kickoff' | 'punt' | 'placekick' | null = null;
  private lastInterceptorIdx: number | null = null;
  private lastFumbleRecovererIdx: number | null = null;
  private lastFumbleTeam: TeamSide | null = null;
  private lastThrowaway = false;
  private lastReturnYds = 0;
  private lastPuntSpotY: number | null = null;

  reset(): void {
    this.text = '';
    this.textTick = -1;
    this.lineExpired = false;
    this.bannerSpec = null;
    this.clearScratch();
  }

  /** Current ticker copy for RendererExtras (null once it has aged out). */
  get ticker(): TickerLine | null {
    if (this.text === '' || this.lineExpired) return null;
    return { text: this.text, startTick: this.textTick };
  }

  get banner(): BannerSpec | null {
    return this.bannerSpec;
  }

  /** Newest line without the age gate — handy for tests and debugging. */
  get lastLine(): string {
    return this.text;
  }

  /** Drop stale presentation state; call once per tick after `handle`. */
  expire(tick: number): void {
    if (this.bannerSpec !== null && tick - this.bannerSpec.startTick > BANNER_TICKS) {
      this.bannerSpec = null;
    }
    if (this.text !== '' && tick - this.textTick > TICKER_TICKS) {
      this.lineExpired = true;
    }
  }

  handle(events: readonly SimEvent[], state: Readonly<GameState>): void {
    for (const ev of events) this.dispatch(ev, state);
    this.expire(state.tick);
  }

  // --- naming ---------------------------------------------------------------

  private nameOf(state: Readonly<GameState>, idx: number | null): string {
    if (idx === null || idx < 0) return 'the runner';
    const player = state.play?.players[idx];
    if (player === undefined) return 'the runner';
    for (const roster of state.rosters) {
      for (const a of roster.athletes) {
        if (a.id === player.athleteId) {
          return `${a.firstName.charAt(0)}. ${a.lastName}`;
        }
      }
    }
    return `#${player.jersey}`;
  }

  private teamName(state: Readonly<GameState>, team: TeamSide): string {
    return state.rosters[team].nickname;
  }

  private spot(state: Readonly<GameState>, ballOnY: number): string {
    return spotLabel(ballOnY, state.rosters[0].abbrev, state.rosters[1].abbrev);
  }

  private rngFor(state: Readonly<GameState>, label: string): Rng {
    return new Rng(hashSeed(state.seed, label, state.playLog.length, state.tick));
  }

  private post(state: Readonly<GameState>, id: number, slots: Slots): void {
    const template = TEMPLATE_BY_ID.get(id);
    if (template === undefined) return;
    this.text = fill(template, slots);
    this.textTick = state.tick;
    this.lineExpired = false;
  }

  private setBanner(state: Readonly<GameState>, kind: BannerKind, text: string, team: TeamSide | null): void {
    this.bannerSpec = { kind, text, startTick: state.tick, team };
  }

  private clearScratch(): void {
    this.lastFgDistance = 0;
    this.lastFgSide = null;
    this.lastKickStyle = null;
    this.lastInterceptorIdx = null;
    this.lastFumbleRecovererIdx = null;
    this.lastFumbleTeam = null;
    this.lastThrowaway = false;
    this.lastReturnYds = 0;
    this.lastPuntSpotY = null;
  }

  // --- event mapping --------------------------------------------------------

  private dispatch(ev: SimEvent, state: Readonly<GameState>): void {
    switch (ev.type) {
      case 'INTERCEPTION':
        this.lastInterceptorIdx = ev.defenderIdx;
        break;

      case 'FUMBLE_RECOVERED':
        this.lastFumbleRecovererIdx = ev.recovererIdx;
        this.lastFumbleTeam = ev.team;
        break;

      case 'INCOMPLETE':
        this.lastThrowaway = ev.throwaway;
        break;

      case 'KICK_LAUNCHED':
        this.lastKickStyle = ev.style;
        break;

      case 'PUNT_DOWNED':
        this.lastPuntSpotY = ev.atY;
        break;

      case 'FIELD_GOAL_RESULT':
        this.lastFgDistance = ev.distanceYds;
        this.lastFgSide = ev.missSide;
        this.setBanner(
          state,
          'fieldGoal',
          ev.good ? 'Field goal is good' : 'No good',
          ev.team,
        );
        break;

      case 'TOUCHDOWN':
        this.setBanner(state, 'touchdown', `Touchdown ${this.teamName(state, ev.team)}!`, ev.team);
        break;

      case 'SAFETY':
        this.setBanner(state, 'generic', 'Safety!', ev.scoringTeam);
        break;

      case 'FIRST_DOWN':
        this.setBanner(state, 'firstDown', 'First down', ev.team);
        break;

      case 'SACK':
        this.setBanner(state, 'sack', 'Sack!', null);
        break;

      case 'TWO_MINUTE_WARNING':
        this.setBanner(state, 'twoMinute', 'Two-minute warning', null);
        break;

      case 'HALFTIME':
        this.setBanner(state, 'halftime', 'Halftime', null);
        break;

      case 'GAME_OVER':
        this.setBanner(state, 'final', 'Final', null);
        break;

      case 'FLAG':
        this.setBanner(state, 'flag', 'Flag on the play', ev.flag.team);
        break;

      case 'PENALTY_ENFORCED':
        this.post(state, 17, {
          penalty: PENALTY_WORDS[ev.kind] ?? ev.kind,
          team: this.teamName(state, ev.team),
          yds: Math.round(ev.yards),
        });
        break;

      case 'TIMEOUT':
        this.post(state, 18, {
          team: this.teamName(state, ev.team),
          n: ev.remaining,
        });
        break;

      case 'XP_RESULT':
        if (!ev.good) this.setBanner(state, 'generic', 'Extra point is no good', ev.team);
        break;

      case 'TWO_POINT_RESULT':
        this.setBanner(
          state,
          'generic',
          ev.good ? 'Two-point conversion is good' : 'Two-point try fails',
          ev.team,
        );
        break;

      case 'PLAY_RESULT':
        this.describePlay(ev, state);
        this.clearScratch();
        break;

      default:
        break;
    }
  }

  private describePlay(
    ev: Extract<SimEvent, { type: 'PLAY_RESULT' }>,
    state: Readonly<GameState>,
  ): void {
    const rng = this.rngFor(state, 'ticker');
    const yds = Math.round(ev.yards);
    const carrier = this.nameOf(state, ev.carrierIdx);
    const qb = this.nameOf(state, ev.passerIdx ?? ev.carrierIdx);
    const receiver = this.nameOf(state, ev.targetIdx);
    const tackler = this.nameOf(state, ev.tacklerIdx);
    const offenseName = this.teamName(state, ev.offense);

    // Turnovers and scores speak first — they override the play-type copy.
    if (ev.turnover === 'int' && this.lastInterceptorIdx !== null) {
      this.setBanner(state, 'turnover', 'Turnover', null);
      this.post(state, 10, {
        defender: this.nameOf(state, this.lastInterceptorIdx),
        qb,
        spot: this.spot(state, state.ballOnY),
      });
      return;
    }
    if (ev.turnover === 'fumble' && this.lastFumbleRecovererIdx !== null) {
      this.setBanner(state, 'turnover', 'Turnover', null);
      this.post(state, 11, {
        defender: this.nameOf(state, this.lastFumbleRecovererIdx),
        team: this.teamName(state, this.lastFumbleTeam ?? ev.offense),
      });
      return;
    }
    if (ev.touchdown) {
      this.post(state, 12, {
        team: offenseName.toUpperCase(),
        scorer: carrier,
        yds: Math.abs(yds),
      });
      return;
    }

    switch (ev.playType) {
      case 'run': {
        if (yds <= 0) {
          this.post(state, 3, { carrier, defender: tackler });
        } else {
          this.post(state, rng.chance(0.5) ? 1 : 2, { carrier, yds });
        }
        return;
      }
      case 'pass': {
        if (this.lastThrowaway) {
          this.post(state, 7, { qb });
          return;
        }
        if (ev.deadReason === 'incomplete') {
          this.post(state, 6, { qb, receiver });
          return;
        }
        this.post(state, rng.chance(0.5) ? 4 : 5, { qb, receiver, yds });
        return;
      }
      case 'sack':
        this.post(state, 9, { defender: tackler, qb, yds: Math.abs(yds) });
        return;
      case 'scramble':
        this.post(state, 8, { qb: carrier, yds });
        return;
      case 'fieldGoal':
        if (this.lastFgSide === null) {
          this.post(state, 13, {
            kicker: carrier,
            dist: Math.round(this.lastFgDistance),
          });
        } else {
          this.post(state, 14, {
            kicker: carrier,
            dist: Math.round(this.lastFgDistance),
            side: this.lastFgSide === 'short' ? 'and short' : this.lastFgSide,
          });
        }
        return;
      case 'punt':
        this.post(state, 15, {
          punter: carrier,
          dist: Math.max(0, Math.round(Math.abs(ev.yards))),
          spot: this.spot(state, this.lastPuntSpotY ?? state.ballOnY),
        });
        return;
      case 'kickoff':
        this.post(state, 16, {
          returner: carrier,
          yds: Math.max(0, Math.round(this.lastReturnYds || Math.abs(ev.yards))),
          spot: this.spot(state, state.ballOnY),
        });
        return;
      case 'kneel':
        this.post(state, 8, { qb: carrier, yds });
        return;
      case 'spike':
        this.post(state, 7, { qb: carrier });
        return;
      case 'extraPoint':
      case 'twoPoint':
      case 'penaltyOnly':
      default:
        return;
    }
  }
}
