import { describe, expect, it } from 'vitest';
import { GamePhase, type GameState, type KickMeterState } from '../../src/sim/types';
import { KICK } from '../../src/data/balance';
import { makeTestRoster } from '../harness/fixtures';
import { Camera } from '../../src/render/Camera';
import { HudRenderer, HUD_STYLE, uiScale } from '../../src/render/HudRenderer';
import { computeKickMeter } from '../../src/render/EffectsRenderer';
import {
  ballOnText, downAndDistanceText, formatClock, formatPlayClock, isGoalToGo, ordinal,
  quarterLabel, scoreText, situationText, territoryTeam, typewriterSlice, yardLineNumber,
  yardageDeltaText, yardsToOpponentGoal,
} from '../../src/render/format';
import { defaultExtras, teamPresentation } from '../../src/render/types';
import { RecordingCtx } from './mockCtx';

describe('clock formatting', () => {
  it('renders MM:SS zero padded', () => {
    expect(formatClock(272)).toBe('04:32');
    expect(formatClock(900)).toBe('15:00');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('rounds up partial seconds so :00 only shows at zero', () => {
    expect(formatClock(0.4)).toBe('00:01');
    expect(formatClock(59.9)).toBe('01:00');
  });

  it('is defensive about junk input', () => {
    expect(formatClock(-12)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });

  it('formats the play clock as whole seconds', () => {
    expect(formatPlayClock(25)).toBe('25');
    expect(formatPlayClock(4.2)).toBe('5');
    expect(formatPlayClock(-3)).toBe('0');
  });

  it('labels quarters and overtime', () => {
    expect(quarterLabel(1)).toBe('Q1');
    expect(quarterLabel(4)).toBe('Q4');
    expect(quarterLabel(5)).toBe('OT');
    expect(quarterLabel(6)).toBe('2OT');
  });
});

describe('down and distance', () => {
  it('ordinalizes downs', () => {
    expect([1, 2, 3, 4].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th']);
    expect(ordinal(11)).toBe('11th');
  });

  it('formats the standard cases', () => {
    expect(downAndDistanceText(2, 7, false)).toBe('2nd & 7');
    expect(downAndDistanceText(1, 10, false)).toBe('1st & 10');
    expect(downAndDistanceText(1, 6, true)).toBe('1st & Goal');
    expect(downAndDistanceText(3, 0.5, false)).toBe('3rd & inches');
  });

  it('detects goal-to-go from the attack direction', () => {
    // Team 0 attacks +y: ball on the away 4 (y=106), 4 yards to the goal line.
    expect(isGoalToGo(106, 0, [1, -1], 10)).toBe(true);
    expect(isGoalToGo(106, 0, [1, -1], 3)).toBe(false);
    // Team 1 attacks -y: ball on the home 4 (y=14).
    expect(isGoalToGo(14, 1, [1, -1], 10)).toBe(true);
    expect(yardsToOpponentGoal(14, 1, [1, -1])).toBeCloseTo(4, 9);
    expect(yardsToOpponentGoal(14, 0, [1, -1])).toBeCloseTo(96, 9);
  });
});

describe('ball-on text', () => {
  const abbrevs: [string, string] = ['HOM', 'AWY'];

  it('numbers yard lines from either goal line', () => {
    expect(yardLineNumber(10)).toBe(0);
    expect(yardLineNumber(44)).toBe(34);
    expect(yardLineNumber(60)).toBe(50);
    expect(yardLineNumber(76)).toBe(34);
    expect(yardLineNumber(110)).toBe(0);
  });

  it('names the territory by which end zone each team defends', () => {
    // Team 0 attacks +y, so team 0 defends the low-y half.
    expect(territoryTeam(44, [1, -1])).toBe(0);
    expect(territoryTeam(76, [1, -1])).toBe(1);
    expect(territoryTeam(60, [1, -1])).toBeNull();
    // After the halftime flip the halves swap owners.
    expect(territoryTeam(44, [-1, 1])).toBe(1);
  });

  it('renders the broadcast string', () => {
    expect(ballOnText(44, [1, -1], abbrevs)).toBe('HOM 34');
    expect(ballOnText(76, [1, -1], abbrevs)).toBe('AWY 34');
    expect(ballOnText(60, [1, -1], abbrevs)).toBe('MID 50');
    expect(ballOnText(10, [1, -1], abbrevs)).toBe('HOM GL');
  });
});

describe('misc HUD text', () => {
  it('formats the yardage popup', () => {
    expect(yardageDeltaText(7)).toBe('+7');
    expect(yardageDeltaText(-3)).toBe('-3');
    expect(yardageDeltaText(0)).toBe('NO GAIN');
    expect(yardageDeltaText(0.4)).toBe('NO GAIN');
  });

  it('reveals the ticker at ~40 chars/sec', () => {
    const text = 'M. Vance finds T. Reyes down the sideline for 65 yards!';
    expect(typewriterSlice(text, 100, 100)).toBe('');
    expect(typewriterSlice(text, 100, 130)).toBe(text.slice(0, 20));
    expect(typewriterSlice(text, 100, 100 + 60 * 10)).toBe(text);
    // Never runs backwards or past the end.
    expect(typewriterSlice(text, 100, 50)).toBe('');
  });

  it('formats a compact score line', () => {
    expect(scoreText(['ASH', 'MER'], [14, 21])).toBe('ASH 14 — MER 21');
  });
});

// ---------------------------------------------------------------------------

function makeState(over: Partial<GameState> = {}): GameState {
  const home = makeTestRoster('HOM', 1);
  const away = makeTestRoster('AWY', 2);
  return {
    seed: 7,
    tick: 600,
    phase: GamePhase.PLAY_CALL,
    config: {
      quarterLengthSec: 300,
      difficulty: 'pro',
      userTeam: 0,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: true,
    },
    rosters: [home, away],
    score: [14, 21],
    quarter: 2,
    clockSec: 272,
    playClockSec: 25,
    clockRunning: false,
    possession: 0,
    down: 2,
    toGo: 7,
    ballOnY: 44,
    attackDir: [1, -1],
    timeouts: [3, 2],
    twoMinuteFired: [false, false],
    nextPlayKind: 'normal',
    play: null,
    coin: null,
    pendingPenalty: null,
    selectedOffensePlayId: null,
    selectedDefensePlayId: null,
    otPossessions: [false, false],
    stats: {
      teams: [
        {
          teamId: 'HOM', points: 14, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
          thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0, penaltyYds: 0,
          topSeconds: 0, sacksAllowed: 0,
        },
        {
          teamId: 'AWY', points: 21, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
          thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0, penaltyYds: 0,
          topSeconds: 0, sacksAllowed: 0,
        },
      ],
      players: {},
      scoringByQuarter: [[], []],
    },
    playLog: [],
    ...over,
  };
}

describe('situationText', () => {
  it('joins down-and-distance with the spot', () => {
    expect(situationText(makeState())).toBe('2nd & 7 · BALL ON HOM 34');
  });
});

describe('HudRenderer layout', () => {
  it('anchors the strip to the bottom at ~55% width', () => {
    const cam = new Camera(1280, 720, 1);
    const hud = new HudRenderer();
    const box = hud.layout(cam);
    expect(box.w).toBeCloseTo(1280 * HUD_STYLE.stripWidthFrac, 6);
    expect(box.x).toBeCloseTo((1280 - box.w) / 2, 6);
    expect(box.y + box.h).toBeCloseTo(720 - HUD_STYLE.stripBottomMargin, 6);
  });

  it('keeps the strip on screen on a narrow viewport', () => {
    const cam = new Camera(480, 640, 1);
    const box = new HudRenderer().layout(cam);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(480);
  });

  it('scales UI with viewport height, within limits', () => {
    expect(uiScale(new Camera(1280, 720, 1))).toBeCloseTo(1, 6);
    expect(uiScale(new Camera(1280, 300, 1))).toBe(0.8);
    expect(uiScale(new Camera(3840, 2160, 1))).toBe(1.5);
  });
});

describe('HudRenderer draw', () => {
  const teams = [
    teamPresentation('HOM', 'Homeville', 'Homers', { primary: '#1B3A6B', secondary: '#E8B93E' }),
    teamPresentation('AWY', 'Awaytown', 'Aways', { primary: '#8A1C1C', secondary: '#EEEEEE' }),
  ] as const;

  it('paints scores, clock, situation and play clock', () => {
    const ctx = new RecordingCtx();
    const cam = new Camera(1280, 720, 1);
    const hud = new HudRenderer();
    const extras = defaultExtras(teams);
    hud.draw(ctx, cam, makeState(), extras, 600);
    const log = ctx.log.join('\n');
    expect(log).toContain('fillText(HOM,');
    expect(log).toContain('fillText(AWY,');
    expect(log).toContain('fillText(14,');
    expect(log).toContain('fillText(21,');
    expect(log).toContain('fillText(04:32,');
    expect(log).toContain('fillText(Q2,');
    expect(log).toContain('2nd & 7  ·  BALL ON HOM 34');
    expect(log).toContain('fillText(:25,');
    expect(ctx.count('save')).toBe(ctx.count('restore'));
  });

  it('hides the play clock outside play call / pre-snap', () => {
    const ctx = new RecordingCtx();
    const hud = new HudRenderer();
    hud.draw(
      ctx,
      new Camera(1280, 720, 1),
      makeState({ phase: GamePhase.PLAY_LIVE }),
      defaultExtras(teams),
      600,
    );
    expect(ctx.log.join('\n')).not.toContain('fillText(:25,');
  });

  it('types out the ticker and shows the coverage hint', () => {
    const ctx = new RecordingCtx();
    const hud = new HudRenderer();
    const extras = {
      ...defaultExtras(teams),
      ticker: { text: 'SACK! Blitzer drops the QB.', startTick: 600 },
      coverageHint: 'COVERAGE: MAN?',
    };
    hud.draw(ctx, new Camera(1280, 720, 1), makeState(), extras, 615);
    const log = ctx.log.join('\n');
    expect(log).toContain('COVERAGE: MAN?');
    expect(log).toContain('fillText(SACK! Blit,'); // 15 ticks at 40 chars/s
    expect(log).not.toContain('fillText(SACK! Blitzer drops the QB.,');
  });
});

describe('kick meter visual', () => {
  const base: KickMeterState = {
    active: true,
    startTick: 100,
    powerLockTick: null,
    accuracyLockTick: null,
    aimOffset: 0,
  };

  it('fills the power bar over meterFillTicks and clamps', () => {
    expect(computeKickMeter(base, 100).power01).toBe(0);
    expect(computeKickMeter(base, 100 + KICK.meterFillTicks / 2).power01).toBeCloseTo(0.5, 6);
    expect(computeKickMeter(base, 100 + KICK.meterFillTicks).power01).toBe(1);
    expect(computeKickMeter(base, 100 + KICK.meterFillTicks * 3).power01).toBe(1);
  });

  it('freezes power and starts the accuracy sweep at the lock', () => {
    const locked: KickMeterState = { ...base, powerLockTick: 100 + KICK.meterFillTicks / 2 };
    const atLock = computeKickMeter(locked, locked.powerLockTick as number);
    expect(atLock.power01).toBeCloseTo(0.5, 6);
    expect(atLock.markerPos01).toBeCloseTo(0.5, 6);

    const later = computeKickMeter(locked, (locked.powerLockTick as number) + KICK.meterSweepTicks / 2);
    expect(later.power01).toBeCloseTo(0.5, 6);
    expect(later.markerPos01 ?? 1).toBeCloseTo(0.25, 6);

    const done = computeKickMeter(locked, (locked.powerLockTick as number) + KICK.meterSweepTicks * 2);
    expect(done.markerPos01).toBe(0);
  });

  it('freezes the marker once accuracy is locked', () => {
    const powerLockTick = 100 + KICK.meterFillTicks;
    const locked: KickMeterState = {
      ...base,
      powerLockTick,
      accuracyLockTick: powerLockTick + KICK.meterSweepTicks / 4,
    };
    const a = computeKickMeter(locked, powerLockTick + KICK.meterSweepTicks / 4);
    const b = computeKickMeter(locked, powerLockTick + KICK.meterSweepTicks * 5);
    expect(b.markerPos01).toBe(a.markerPos01);
    expect(b.accuracyLocked).toBe(true);
    expect(b.accuracyError01).toBeCloseTo(0.75, 6);
  });

  it('reports no marker before the power lock', () => {
    expect(computeKickMeter(base, 120).markerPos01).toBeNull();
  });
});
