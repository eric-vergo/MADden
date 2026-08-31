// Pure display formatting for every screen. No DOM, no state — safe to unit
// test. Numeric output here is meant to be rendered in the `.num` monospace
// class so columns line up.

import type {
  PendingPenaltyDecision, PenaltyKind, PenaltyOutcome, TeamSide,
} from '../sim/types';

export function pad2(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return v < 10 ? `0${v}` : `${v}`;
}

/** Game clock, broadcast style: 04:32 (minutes are not zero-trimmed). */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** Time of possession / elapsed style: 31:07 */
export function formatDuration(sec: number): string {
  return formatClock(sec);
}

export function ordinal(n: number): string {
  const abs = Math.abs(Math.floor(n));
  const rem100 = abs % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatDownDistance(down: number, toGo: number, goalToGo = false): string {
  const d = ordinal(down);
  if (goalToGo) return `${d} & Goal`;
  if (toGo < 1) return `${d} & Inches`;
  return `${d} & ${Math.round(toGo)}`;
}

/**
 * World y → broadcast spot label ("HOM 34", "MID 50", "ASH 8").
 * Field: y=10 is the home goal line, y=110 the away goal line.
 */
export function formatSpot(ballOnY: number, homeAbbrev: string, awayAbbrev: string): string {
  const y = Math.max(10, Math.min(110, ballOnY));
  const fromHomeGoal = y - 10;
  const yardLine = Math.round(Math.min(fromHomeGoal, 100 - fromHomeGoal));
  if (yardLine >= 50) return 'MID 50';
  return `${fromHomeGoal < 50 ? homeAbbrev : awayAbbrev} ${yardLine}`;
}

export function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** Win percentage without the leading zero: .714 (ties count as half a win). */
export function formatPct(w: number, l: number, t: number): string {
  const games = w + l + t;
  if (games === 0) return '.000';
  const p = (w + t * 0.5) / games;
  if (p >= 1) return '1.000';
  return p.toFixed(3).slice(1);
}

export function winPct(w: number, l: number, t: number): number {
  const games = w + l + t;
  return games === 0 ? 0 : (w + t * 0.5) / games;
}

export function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** "Marcus Ellsworth" → "M. Ellsworth" (ticker / table style). */
export function shortName(firstName: string, lastName: string): string {
  const initial = firstName.length > 0 ? `${firstName[0]}. ` : '';
  return `${initial}${lastName}`;
}

export function formatAvg(total: number, count: number, digits = 1): string {
  if (count <= 0) return '0.0';
  return (total / count).toFixed(digits);
}

/** "12/18" style completion or conversion pair. */
export function formatOfPair(made: number, attempted: number): string {
  return `${made}/${attempted}`;
}

export function formatConvPct(made: number, attempted: number): string {
  if (attempted <= 0) return '0%';
  return `${Math.round((made / attempted) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

const PENALTY_LABELS: Record<PenaltyKind, string> = {
  falseStart: 'False Start',
  offside: 'Offside',
  encroachment: 'Encroachment',
  delayOfGame: 'Delay of Game',
  holding: 'Holding',
  dpi: 'Defensive Pass Interference',
  opi: 'Offensive Pass Interference',
};

export function penaltyLabel(kind: PenaltyKind): string {
  return PENALTY_LABELS[kind];
}

export interface PenaltyPromptText {
  /** "FLAG — FALSE START, ASH" */
  headline: string;
  /** "#12 J. Rivera" or '' when the flag names no player. */
  offender: string;
  acceptLine: string;
  declineLine: string;
  /** Which side is on the clock to choose. */
  decidingLabel: string;
}

export interface PenaltyPromptContext {
  /** Abbrevs indexed by TeamSide (0 = home, 1 = away). */
  abbrevs: readonly [string, string];
  /** Optional jersey/name for the flagged player. */
  offenderName?: string;
  offenderJersey?: number;
}

export function buildPenaltyPrompt(
  decision: PendingPenaltyDecision,
  ctx: PenaltyPromptContext,
): PenaltyPromptText {
  const offending = ctx.abbrevs[decision.flag.team] ?? '';
  const deciding = ctx.abbrevs[decision.decidingTeam] ?? '';
  const jersey = ctx.offenderJersey !== undefined ? `#${ctx.offenderJersey} ` : '';
  const offender = ctx.offenderName !== undefined ? `${jersey}${ctx.offenderName}` : '';
  return {
    headline: `FLAG — ${penaltyLabel(decision.flag.kind).toUpperCase()}, ${offending}`,
    offender,
    acceptLine: outcomeLine(decision.acceptOutcome, 'ACCEPT'),
    declineLine: outcomeLine(decision.declineOutcome, 'DECLINE'),
    decidingLabel: `${deciding} DECISION`,
  };
}

function outcomeLine(o: PenaltyOutcome, verb: string): string {
  const first = o.firstDown ? ' · AUTOMATIC FIRST DOWN' : '';
  return `${verb}: ${o.description}${first}`;
}

export interface PenaltyChoiceContext {
  /** Per-team attack direction from GameState; enables field-position tiebreaks. */
  attackDir?: readonly [1 | -1, 1 | -1];
}

/** Yards from the ball spot to the goal line the possessing team attacks. */
function yardsToGoal(ballOnY: number, dir: 1 | -1): number {
  return dir === 1 ? 110 - ballOnY : ballOnY - 10;
}

/**
 * Value of an outcome to `decidingTeam`, higher = better. Deliberately coarse:
 * possession dominates, then automatic first down, then down/distance, then
 * field position when attack directions are supplied.
 */
export function scorePenaltyOutcome(
  o: PenaltyOutcome,
  decidingTeam: TeamSide,
  ctx: PenaltyChoiceContext = {},
): number {
  const own = o.possession === decidingTeam;
  let s = own ? 100 : -100;
  let detail = 0;
  detail += o.firstDown ? 20 : 0;
  detail += (4 - o.down) * 4;
  detail -= o.toGo * 0.6;
  const dir = ctx.attackDir?.[o.possession];
  if (dir !== undefined) detail += (100 - yardsToGoal(o.ballOnY, dir)) * 0.4;
  return s + (own ? detail : -detail);
}

/** CPU / 8-second auto-pick: whichever outcome the deciding team prefers. */
export function preferredPenaltyChoice(
  decision: PendingPenaltyDecision,
  ctx: PenaltyChoiceContext = {},
): 'accept' | 'decline' {
  const a = scorePenaltyOutcome(decision.acceptOutcome, decision.decidingTeam, ctx);
  const d = scorePenaltyOutcome(decision.declineOutcome, decision.decidingTeam, ctx);
  return a > d ? 'accept' : 'decline';
}

// ---------------------------------------------------------------------------
// Difficulty / settings labels
// ---------------------------------------------------------------------------

export const DIFFICULTY_LABEL: Record<string, string> = {
  rookie: 'ROOKIE',
  pro: 'PRO',
  allPro: 'ALL-PRO',
  allMadden: 'ALL-MADDEN',
};

export const DIFFICULTY_BLURB: Record<string, string> = {
  rookie: 'Slow reads, soft coverage, forgiving kick meter. Learn the controls.',
  pro: 'Balanced. CPU plays honest football and punishes obvious mistakes.',
  allPro: 'Tight coverage, fast recognition, analytic 4th-down calls.',
  allMadden: 'Instant reads, no kick error, aggressive everything. Good luck.',
};

export function ratingTier(v: number): 'elite' | 'good' | 'ok' | 'weak' {
  if (v >= 85) return 'elite';
  if (v >= 78) return 'good';
  if (v >= 70) return 'ok';
  return 'weak';
}
