import { describe, expect, it } from 'vitest';
import type { PendingPenaltyDecision, PenaltyOutcome } from '../../src/sim/types';
import {
  buildPenaltyPrompt, formatClock, formatConvPct, formatDownDistance, formatOfPair,
  formatPct, formatRecord, formatSigned, formatSpot, ordinal, penaltyLabel,
  preferredPenaltyChoice, ratingTier, scorePenaltyOutcome, shortName,
} from '../../src/ui/format';

describe('clock and number formatting', () => {
  it('formats the game clock broadcast style', () => {
    expect(formatClock(272)).toBe('04:32');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatClock(59.2)).toBe('01:00'); // ceil: the clock still reads a minute
    expect(formatClock(3600)).toBe('60:00');
  });

  it('formats ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(21)).toBe('21st');
  });

  it('formats down and distance', () => {
    expect(formatDownDistance(3, 7)).toBe('3rd & 7');
    expect(formatDownDistance(1, 10)).toBe('1st & 10');
    expect(formatDownDistance(4, 0.5)).toBe('4th & Inches');
    expect(formatDownDistance(2, 4, true)).toBe('2nd & Goal');
  });

  it('formats the ball spot relative to the nearer goal line', () => {
    expect(formatSpot(60, 'ASH', 'OAK')).toBe('MID 50');
    expect(formatSpot(44, 'ASH', 'OAK')).toBe('ASH 34');
    expect(formatSpot(90, 'ASH', 'OAK')).toBe('OAK 20');
    expect(formatSpot(10, 'ASH', 'OAK')).toBe('ASH 0');
    expect(formatSpot(200, 'ASH', 'OAK')).toBe('OAK 0');
  });

  it('formats records, percentages, and helpers', () => {
    expect(formatRecord(10, 4, 0)).toBe('10-4');
    expect(formatRecord(10, 3, 1)).toBe('10-3-1');
    expect(formatPct(10, 4, 0)).toBe('.714');
    expect(formatPct(0, 0, 0)).toBe('.000');
    expect(formatPct(2, 0, 0)).toBe('1.000');
    expect(formatSigned(7)).toBe('+7');
    expect(formatSigned(-3)).toBe('-3');
    expect(formatOfPair(12, 18)).toBe('12/18');
    expect(formatConvPct(6, 13)).toBe('46%');
    expect(formatConvPct(0, 0)).toBe('0%');
    expect(shortName('Marcus', 'Ellsworth')).toBe('M. Ellsworth');
    expect(shortName('', 'Ellsworth')).toBe('Ellsworth');
  });

  it('buckets rating tiers per the design ramp', () => {
    expect(ratingTier(88)).toBe('elite');
    expect(ratingTier(80)).toBe('good');
    expect(ratingTier(72)).toBe('ok');
    expect(ratingTier(64)).toBe('weak');
  });
});

// --- penalties --------------------------------------------------------------

function outcome(over: Partial<PenaltyOutcome> = {}): PenaltyOutcome {
  return {
    down: 1, toGo: 10, ballOnY: 50, possession: 0, firstDown: false,
    description: '1st & 10 at MID 50',
    ...over,
  };
}

function decision(over: Partial<PendingPenaltyDecision> = {}): PendingPenaltyDecision {
  return {
    flag: { kind: 'holding', team: 1, playerIdx: 14, spotY: 44, preSnap: false },
    decidingTeam: 0,
    acceptOutcome: outcome(),
    declineOutcome: outcome({ down: 3, toGo: 8, description: '3rd & 8 at ASH 42' }),
    ...over,
  };
}

describe('penalty prompt text', () => {
  it('labels every penalty kind', () => {
    expect(penaltyLabel('falseStart')).toBe('False Start');
    expect(penaltyLabel('dpi')).toBe('Defensive Pass Interference');
    expect(penaltyLabel('delayOfGame')).toBe('Delay of Game');
  });

  it('builds headline and both outcome lines from the decision', () => {
    const text = buildPenaltyPrompt(decision(), {
      abbrevs: ['ASH', 'OAK'],
      offenderName: 'T. Ridley',
      offenderJersey: 74,
    });
    expect(text.headline).toBe('FLAG — HOLDING, OAK');
    expect(text.offender).toBe('#74 T. Ridley');
    expect(text.decidingLabel).toBe('ASH DECISION');
    expect(text.acceptLine).toBe('ACCEPT: 1st & 10 at MID 50');
    expect(text.declineLine).toBe('DECLINE: 3rd & 8 at ASH 42');
  });

  it('flags automatic first downs in the accept line', () => {
    const text = buildPenaltyPrompt(
      decision({ acceptOutcome: outcome({ firstDown: true }) }),
      { abbrevs: ['ASH', 'OAK'] },
    );
    expect(text.acceptLine).toContain('AUTOMATIC FIRST DOWN');
    expect(text.offender).toBe('');
  });
});

describe('penalty auto-pick', () => {
  it('prefers the outcome that keeps possession', () => {
    const d = decision({
      acceptOutcome: outcome({ possession: 0, down: 1 }),
      declineOutcome: outcome({ possession: 1, down: 1, description: 'OAK ball' }),
    });
    expect(preferredPenaltyChoice(d)).toBe('accept');
  });

  it('prefers an automatic first down over 3rd and long', () => {
    expect(preferredPenaltyChoice(decision({
      acceptOutcome: outcome({ firstDown: true }),
      declineOutcome: outcome({ down: 3, toGo: 12 }),
    }))).toBe('accept');
  });

  it('declines when accepting would replay a worse down and distance', () => {
    expect(preferredPenaltyChoice(decision({
      acceptOutcome: outcome({ down: 2, toGo: 15 }),
      declineOutcome: outcome({ down: 1, toGo: 10 }),
    }))).toBe('decline');
  });

  it('evaluates from the deciding team perspective when on defense', () => {
    const d = decision({
      decidingTeam: 1,
      acceptOutcome: outcome({ possession: 0, down: 1, toGo: 10, firstDown: true }),
      declineOutcome: outcome({ possession: 0, down: 4, toGo: 9 }),
    });
    // Team 1 is on defense: 4th & 9 for the offense beats giving a first down.
    expect(preferredPenaltyChoice(d)).toBe('decline');
  });

  it('breaks ties on field position when attack directions are supplied', () => {
    const ctx = { attackDir: [1, -1] as const };
    const near = outcome({ ballOnY: 95 }); // home attacks +y → 15 to go
    const far = outcome({ ballOnY: 30 });
    expect(scorePenaltyOutcome(near, 0, ctx)).toBeGreaterThan(scorePenaltyOutcome(far, 0, ctx));
    expect(preferredPenaltyChoice(decision({ acceptOutcome: near, declineOutcome: far }), ctx)).toBe('accept');
  });
});
