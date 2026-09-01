// Presentation regressions in the renderer: stadium paint that must not move,
// a field cache that must survive the replay zoom, an input affordance that
// must not appear for kicks nobody can control, a scoreboard strip that must
// not print a series that no longer exists, and a skip hint that must not
// promise keys the input layer does not honour.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GamePhase, type GameState, type KickMeterState, type PlayState, type SimPlayer } from '../../src/sim/types';
import { Camera } from '../../src/render/Camera';
import { EffectsRenderer, EFFECT_STYLE } from '../../src/render/EffectsRenderer';
import { FieldRenderer, fieldThemeFromTeams } from '../../src/render/FieldRenderer';
import { situationStripText } from '../../src/render/format';
import { userKickMeter } from '../../src/render/Renderer';
import { teamPresentation, type TeamPresentation } from '../../src/render/types';
import { RecordingCtx } from '../render/mockCtx';
import { makeState } from '../audio/gameStateFixture';

const TEAMS: readonly [TeamPresentation, TeamPresentation] = [
  teamPresentation('HOM', 'Homeville', 'Homers', { primary: '#1B3A6B', secondary: '#E8B93E' }, {
    frame: 'circle', motif: 'bolt', motifCount: 1, rotationDeg: 0,
    frameColor: '#1B3A6B', motifColor: '#E8B93E', accentColor: '#FFFFFF',
  }),
  teamPresentation('AWY', 'Awaytown', 'Aways', { primary: '#8A1C1C', secondary: '#EEEEEE' }, {
    frame: 'shield', motif: 'star', motifCount: 3, rotationDeg: 12,
    frameColor: '#8A1C1C', motifColor: '#EEEEEE', accentColor: '#000000',
  }),
];

// ---------------------------------------------------------------------------
// Midfield paint
// ---------------------------------------------------------------------------

describe('midfield logo is stadium paint', () => {
  it('stays with the home team when the teams swap ends', () => {
    const q1 = fieldThemeFromTeams(TEAMS, [1, -1]);
    const q2 = fieldThemeFromTeams(TEAMS, [-1, 1]);

    expect(q1.midfieldLogo).toEqual(TEAMS[0].logo);
    expect(q1.midfieldLetter).toBe('H');
    expect(q2.midfieldLogo).toEqual(q1.midfieldLogo);
    expect(q2.midfieldLetter).toBe(q1.midfieldLetter);
  });

  it('still swaps the end zones, which really do change hands', () => {
    const q1 = fieldThemeFromTeams(TEAMS, [1, -1]);
    const q2 = fieldThemeFromTeams(TEAMS, [-1, 1]);
    expect(q1.low.text).toBe('HOMERS');
    expect(q2.low.text).toBe('AWAYS');
    expect(q1.high.text).toBe('AWAYS');
    expect(q2.high.text).toBe('HOMERS');
  });
});

// ---------------------------------------------------------------------------
// Field surface cache
// ---------------------------------------------------------------------------

class FakeCanvas {
  width = 0;
  height = 0;
  readonly ctx = new RecordingCtx();

  getContext(kind: string): RecordingCtx | null {
    return kind === '2d' ? this.ctx : null;
  }
}

describe('field surface survives the replay zoom', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let canvases: FakeCanvas[] = [];

  beforeEach(() => {
    canvases = [];
    globals.document = {
      createElement: (): FakeCanvas => {
        const c = new FakeCanvas();
        canvases.push(c);
        return c;
      },
    };
  });

  afterEach(() => {
    delete globals.document;
  });

  it('does not repaint the field when only the zoom changes', () => {
    const field = new FieldRenderer();
    const cam = new Camera(1280, 720, 1);
    const theme = fieldThemeFromTeams(TEAMS, [1, -1]);

    field.ensure(cam, theme);
    expect(canvases).toHaveLength(1);

    // startReplay: zoom in. endReplay: back to 1. Neither changes the paint.
    cam.setZoom(1.15);
    field.ensure(cam, theme);
    cam.setZoom(1);
    field.ensure(cam, theme);
    expect(canvases).toHaveLength(1);

    // A second replay reuses it too.
    cam.setZoom(1.15);
    field.ensure(cam, theme);
    cam.setZoom(1);
    field.ensure(cam, theme);
    expect(canvases).toHaveLength(1);
  });

  it('still repaints when the teams change', () => {
    const field = new FieldRenderer();
    const cam = new Camera(1280, 720, 1);
    field.ensure(cam, fieldThemeFromTeams(TEAMS, [1, -1]));
    expect(canvases).toHaveLength(1);

    const other: readonly [TeamPresentation, TeamPresentation] = [
      teamPresentation('GRA', 'Granite', 'Miners', { primary: '#2E5A2E', secondary: '#DDDDDD' }),
      TEAMS[1],
    ];
    field.ensure(cam, fieldThemeFromTeams(other, [1, -1]));
    expect(canvases).toHaveLength(2);
  });

  it('still repaints when the viewport grows past what the surface holds', () => {
    const field = new FieldRenderer();
    const cam = new Camera(1280, 720, 1);
    const theme = fieldThemeFromTeams(TEAMS, [1, -1]);
    field.ensure(cam, theme);
    expect(canvases).toHaveLength(1);

    cam.resize(2560, 1440, 1);
    field.ensure(cam, theme);
    expect(canvases).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Kick meter visibility
// ---------------------------------------------------------------------------

function meter(over: Partial<KickMeterState> = {}): KickMeterState {
  return {
    active: true, startTick: 10, powerLockTick: null, accuracyLockTick: null, aimOffset: 0, ...over,
  };
}

function stateWithControlled(role: string | null): GameState {
  const players: SimPlayer[] = [];
  for (let i = 0; i < 22; i++) players.push({ role: `slot${i}` } as unknown as SimPlayer);
  if (role !== null) players[3] = { role } as unknown as SimPlayer;
  return {
    ...makeState(),
    play: { players, controlledIdx: role === null ? -1 : 3 } as unknown as PlayState,
  };
}

describe('kick meter is only drawn for the viewer who works it', () => {
  it('shows for the user kicking', () => {
    const km = meter();
    expect(userKickMeter(km, stateWithControlled('K'))).toBe(km);
    expect(userKickMeter(km, stateWithControlled('P'))).toBe(km);
  });

  it('hides while the other team kicks (the user is on the return unit)', () => {
    expect(userKickMeter(meter(), stateWithControlled('PR'))).toBeNull();
    expect(userKickMeter(meter(), stateWithControlled('MLB1'))).toBeNull();
  });

  it('hides in a CPU-vs-CPU game and when no play is live', () => {
    expect(userKickMeter(meter(), stateWithControlled(null))).toBeNull();
    expect(userKickMeter(meter(), makeState())).toBeNull();
  });

  it('hides an inactive meter regardless of control', () => {
    expect(userKickMeter(meter({ active: false }), stateWithControlled('K'))).toBeNull();
    expect(userKickMeter(null, stateWithControlled('K'))).toBeNull();
  });

  it('draws nothing when the overlay is handed a null meter', () => {
    const ctx = new RecordingCtx();
    const cam = new Camera(1280, 720, 1);
    const effects = new EffectsRenderer();
    effects.drawOverlay(ctx, cam, {
      tick: 30, uiScale: 1, teams: TEAMS, kickMeter: null,
      yardagePopup: null, banner: null, replay: false,
    });
    const log = ctx.log.join('\n');
    expect(log).not.toContain('POWER');
    expect(log).not.toContain('ACCURACY');

    ctx.reset();
    effects.drawOverlay(ctx, cam, {
      tick: 30, uiScale: 1, teams: TEAMS, kickMeter: meter(),
      yardagePopup: null, banner: null, replay: false,
    });
    expect(ctx.log.join('\n')).toContain('POWER');
  });
});

// ---------------------------------------------------------------------------
// Scoreboard strip through the try
// ---------------------------------------------------------------------------

describe('scoreboard strip never prints a series that no longer exists', () => {
  const abbrevs: [string, string] = ['HOM', 'AWY'];

  it('labels the point-after choice instead of the play that scored', () => {
    const scored = makeState({
      phase: GamePhase.POINT_AFTER_CHOICE,
      nextPlayKind: 'pat',
      down: 3,
      toGo: 11,
      ballOnY: 39,
    });
    const text = situationStripText(scored, abbrevs);
    expect(text).toBe('POINT AFTER TRY');
    expect(text).not.toContain('3rd & 11');
    expect(text).not.toContain('BALL ON');
  });

  it('labels the try snap and the kickoff, keeping the spot they do have', () => {
    const tryPlay = makeState({
      phase: GamePhase.PRE_SNAP, nextPlayKind: 'pat', down: 1, toGo: 10, ballOnY: 108,
    });
    expect(situationStripText(tryPlay, abbrevs)).toBe('TRY  ·  BALL ON AWY 2');

    const kickoff = makeState({
      phase: GamePhase.PLAY_CALL, nextPlayKind: 'kickoff', down: 1, toGo: 10, ballOnY: 45,
    });
    expect(situationStripText(kickoff, abbrevs)).toBe('KICKOFF  ·  BALL ON HOM 35');

    const freeKick = makeState({ phase: GamePhase.PLAY_CALL, nextPlayKind: 'freeKick', ballOnY: 30 });
    expect(situationStripText(freeKick, abbrevs)).toBe('FREE KICK  ·  BALL ON HOM 20');
  });

  it('prints down and distance on a normal snap, and nothing once the game is over', () => {
    const normal = makeState({
      phase: GamePhase.PLAY_CALL, nextPlayKind: 'normal', down: 2, toGo: 7, ballOnY: 44,
    });
    expect(situationStripText(normal, abbrevs)).toBe('2nd & 7  ·  BALL ON HOM 34');
    expect(situationStripText(makeState({ phase: GamePhase.GAME_OVER }), abbrevs)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Replay skip hint
// ---------------------------------------------------------------------------

describe('replay skip hint names keys that actually skip', () => {
  it('does not promise that any key works', () => {
    const ctx = new RecordingCtx();
    const cam = new Camera(1280, 720, 1);
    new EffectsRenderer().drawOverlay(ctx, cam, {
      tick: 0, uiScale: 1, teams: TEAMS, kickMeter: null,
      yardagePopup: null, banner: null, replay: true,
    });
    const log = ctx.log.join('\n');
    expect(log).not.toContain('ANY KEY TO SKIP');
    expect(log).toContain(`fillText(${EFFECT_STYLE.replaySkipHint},`);
    expect(EFFECT_STYLE.replaySkipHint).toMatch(/ENTER|ESC/);
  });
});
