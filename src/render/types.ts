// Renderer-owned presentation types. These are the things the HUD/effects need
// that GameState deliberately does not carry (ticker copy, banners, replay
// flag, control context, team look). Owned by the render stream: the app layer
// assembles a RendererExtras each frame.

import type { TeamColors, TeamSide } from '../sim/types';
import type { LogoSpec } from '../meta/types';
import { readableOn, shade } from './shapes';

/** Palette a single team's players are drawn with. */
export interface TeamVisual {
  jersey: string;
  helmet: string;
  numberColor: string;
  outline: string;
  accent: string;
}

/** Everything the renderer needs to know about one team's identity. */
export interface TeamPresentation {
  abbrev: string;
  city: string;
  nickname: string;
  colors: TeamColors;
  logo: LogoSpec | null;
  visual: TeamVisual;
}

export interface TickerLine {
  text: string;
  /** Tick the line was posted — drives the typewriter reveal. */
  startTick: number;
}

export type BannerKind =
  | 'touchdown' | 'turnover' | 'flag' | 'fieldGoal' | 'sack'
  | 'firstDown' | 'twoMinute' | 'halftime' | 'final' | 'generic';

export interface BannerSpec {
  kind: BannerKind;
  text: string;
  startTick: number;
  /** Team whose colors tint the slab; null uses a neutral slab. */
  team: TeamSide | null;
}

export interface YardagePopup {
  yards: number;
  /** World position the popup rises from. */
  x: number;
  y: number;
  startTick: number;
}

/** A 1–5 throw key floating above an eligible receiver. */
export interface ReceiverKey {
  /** Index into TickSnapshot.players. */
  idx: number;
  /** 1..5, matching GameAction.Throw1..Throw5. */
  key: number;
}

export interface RendererExtras {
  /** Real seconds since the previous draw — drives the camera spring only. */
  frameDtSec: number;
  teams: readonly [TeamPresentation, TeamPresentation];
  /** Ticker copy under the scoreboard; null hides the line. */
  ticker: TickerLine | null;
  banner: BannerSpec | null;
  /** e.g. "COVERAGE: MAN?" — already localized//decided by the caller. */
  coverageHint: string | null;
  yardagePopup: YardagePopup | null;
  receiverKeys: readonly ReceiverKey[];
  /** True while the QB holds the ball pre-throw (keys are drawn). */
  showReceiverKeys: boolean;
  /** Landing spot marker while a pass is in the air. */
  passLanding: { x: number; y: number } | null;
  /** Letterbox + REPLAY banner. */
  replay: boolean;
  showHud: boolean;
  /** Overrides the automatic camera target (world y) when non-null. */
  cameraTargetY: number | null;
  /** Which way the viewer's team attacks; flips the camera when -1. */
  viewAttackDir: 1 | -1;
  debug: boolean;
}

const NEUTRAL_LIGHT = '#E9EDF2';
const NEUTRAL_DARK = '#12161C';

/** Derive a player palette from team colors (dark jerseys get light trim). */
export function teamVisualFromColors(colors: TeamColors): TeamVisual {
  const jersey = colors.primary;
  const light = readableOn(jersey) === '#F5F7FA';
  return {
    jersey,
    helmet: light ? shade(jersey, 0.22) : shade(jersey, -0.22),
    numberColor: light ? NEUTRAL_LIGHT : NEUTRAL_DARK,
    outline: light ? shade(jersey, -0.45) : shade(jersey, -0.3),
    accent: colors.secondary,
  };
}

export function teamPresentation(
  abbrev: string,
  city: string,
  nickname: string,
  colors: TeamColors,
  logo: LogoSpec | null = null,
): TeamPresentation {
  return { abbrev, city, nickname, colors, logo, visual: teamVisualFromColors(colors) };
}

const PLACEHOLDER_COLORS: TeamColors = { primary: '#1B3A6B', secondary: '#E8B93E' };

export function defaultExtras(
  teams: readonly [TeamPresentation, TeamPresentation],
): RendererExtras {
  return {
    frameDtSec: 1 / 60,
    teams,
    ticker: null,
    banner: null,
    coverageHint: null,
    yardagePopup: null,
    receiverKeys: [],
    showReceiverKeys: false,
    passLanding: null,
    replay: false,
    showHud: true,
    cameraTargetY: null,
    viewAttackDir: 1,
    debug: false,
  };
}

export function placeholderTeams(): [TeamPresentation, TeamPresentation] {
  return [
    teamPresentation('HOM', 'Home', 'Home', PLACEHOLDER_COLORS),
    teamPresentation('AWY', 'Away', 'Away', { primary: '#8A1C1C', secondary: '#E8E8E8' }),
  ];
}
