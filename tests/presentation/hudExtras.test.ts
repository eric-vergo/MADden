// End-to-end presentation: a real GameSession feeding a real Renderer through a
// recording 2D context. Everything asserted here starts as a SimEvent and has to
// survive the whole chain — PlayByPlay/GameSession → RendererExtras → HUD and
// effect overlays — to show up as a draw command.

import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT_FRAME, GamePhase } from '../../src/sim/types';
import { InputContext } from '../../src/input/types';
import { TICK_DT } from '../../src/sim/constants';
import { Camera } from '../../src/render/Camera';
import { Renderer } from '../../src/render/Renderer';
import { EFFECT_STYLE } from '../../src/render/EffectsRenderer';
import { HUD_STYLE, HudRenderer, uiScale } from '../../src/render/HudRenderer';
import { typewriterSlice } from '../../src/render/format';
import type { GameSession } from '../../src/game/GameSession';
import { autoAnswer, makeHarness, type Harness } from '../integration/harness';
import { RecordingCtx } from '../render/mockCtx';

const SEARCH_TICKS = 60 * 60 * 12;

function fakeCanvas(ctx: RecordingCtx): HTMLCanvasElement {
  return {
    getContext: () => ctx,
    width: 0,
    height: 0,
    style: {},
  } as unknown as HTMLCanvasElement;
}

interface Rig {
  h: Harness;
  ctx: RecordingCtx;
  renderer: Renderer;
  /** Draw the current frame the way GameSession.render would. */
  drawNow(): string;
}

/**
 * The session keeps no renderer of its own so the live HUD path is what gets
 * exercised (replays never arm without one); the draw is issued by hand with
 * exactly the arguments GameSession.render passes.
 */
function rig(seed = 90210): Rig {
  const ctx = new RecordingCtx();
  const renderer = new Renderer(fakeCanvas(ctx));
  renderer.resize(1280, 720, 1);
  const h = makeHarness({
    userTeam: 0,
    quarterLengthSec: 60,
    seed,
    renderer: null,
    onPrompt: autoAnswer,
  });
  return {
    h,
    ctx,
    renderer,
    drawNow(): string {
      ctx.reset();
      const [prev, curr] = h.session.snapshots;
      renderer.draw(prev, curr, 0.5, h.session.state, h.session.buildExtras(TICK_DT));
      return ctx.log.join('\n');
    },
  };
}

/** Step until `stop` holds; returns false when the search ran out. */
function runUntil(h: Harness, stop: (s: GameSession) => boolean, cap = SEARCH_TICKS): boolean {
  for (let i = 0; i < cap; i++) {
    if (stop(h.session)) return true;
    if (h.session.state.phase === GamePhase.GAME_OVER) return false;
    h.session.stepOneTick();
  }
  return false;
}

describe('HUD extras end to end', () => {
  it('types the play-by-play ticker line onto the canvas', () => {
    const r = rig();
    expect(runUntil(r.h, (s) => s.buildExtras(TICK_DT).ticker !== null)).toBe(true);

    const line = r.h.session.buildExtras(TICK_DT).ticker;
    expect(line?.text.length).toBeGreaterThan(0);
    expect(line?.text).toBe(r.h.session.playByPlay.lastLine);

    const tick = r.h.session.snapshots[1].tick;
    const shown = typewriterSlice(line?.text ?? '', line?.startTick ?? 0, tick, HUD_STYLE.tickerCharsPerSec);
    const log = r.drawNow();
    if (shown.length > 0) expect(log).toContain(`fillText(${shown},`);
    expect(log).not.toContain(`fillText(${(line?.text ?? '') + 'x'},`);

    // A few seconds later the whole line has revealed.
    for (let i = 0; i < 60 * 3 && r.h.session.state.phase !== GamePhase.GAME_OVER; i++) {
      r.h.session.stepOneTick();
    }
    const later = r.h.session.buildExtras(TICK_DT).ticker;
    if (later !== null && later.startTick === line?.startTick) {
      expect(r.drawNow()).toContain(`fillText(${later.text},`);
    }
  });

  it('paints the scoreboard strip from live game state', () => {
    const r = rig();
    r.h.run(400);
    const log = r.drawNow();
    const s = r.h.session.state;
    expect(log).toContain(`fillText(${s.rosters[0].abbrev},`);
    expect(log).toContain(`fillText(${s.rosters[1].abbrev},`);
    expect(log).toContain(`fillText(${s.score[0]},`);
    expect(log).toContain('BALL ON');
    expect(r.ctx.count('save')).toBe(r.ctx.count('restore'));
  });

  it('slabs a big-play banner across the screen', () => {
    const r = rig();
    expect(runUntil(r.h, (s) => s.buildExtras(TICK_DT).banner !== null)).toBe(true);
    const banner = r.h.session.buildExtras(TICK_DT).banner;
    expect(banner?.text.length).toBeGreaterThan(0);
    expect(r.drawNow()).toContain(`fillText(${banner?.text.toUpperCase()},`);
  });

  it('raises the FLAG banner off a penalty event', () => {
    const r = rig();
    r.h.run(300);
    r.h.session.playByPlay.handle(
      [{
        type: 'FLAG',
        tick: r.h.session.state.tick,
        flag: { kind: 'holding', team: 1, playerIdx: 3, spotY: 45, preSnap: false },
      }],
      r.h.session.state,
    );

    const banner = r.h.session.buildExtras(TICK_DT).banner;
    expect(banner?.kind).toBe('flag');
    expect(banner?.team).toBe(1);
    expect(r.drawNow()).toContain('fillText(FLAG ON THE PLAY,');
  });

  it('pops the yardage up over the spot — but only for plays from scrimmage', () => {
    const r = rig();
    // The opening kickoff resolves first: a 60-yard kick is not a 60-yard gain.
    expect(runUntil(r.h, (s) => s.state.playLog.length === 1)).toBe(true);
    r.h.run(3);
    expect(r.h.session.buildExtras(TICK_DT).yardagePopup).toBeNull();

    expect(runUntil(r.h, (s) => s.buildExtras(TICK_DT).yardagePopup !== null)).toBe(true);
    const popup = r.h.session.buildExtras(TICK_DT).yardagePopup;
    expect(popup).toBeTruthy();
    const yards = Math.round(popup?.yards ?? 0);
    const label = yards === 0 ? 'NO GAIN' : yards > 0 ? `+${yards}` : `${yards}`;
    expect(r.drawNow()).toContain(`fillText(${label},`);
  });

  it('shows the settings-gated coverage hint before the snap', () => {
    const r = rig();
    // The hint is a read at the line: the auto-pilot's instant snap never earns
    // one, so this quarterback stands over the ball for a few seconds first.
    const autoFrame = r.h.input.autoFrame;
    let held = 0;
    r.h.input.autoFrame = (context) => {
      if (context === InputContext.PRE_SNAP_OFF && held < 200) {
        held++;
        return EMPTY_INPUT_FRAME;
      }
      return autoFrame?.(context) ?? null;
    };

    // Default settings ('auto') plus the 'pro' difficulty: the hint is on.
    expect(runUntil(r.h, (s) => s.buildExtras(TICK_DT).coverageHint !== null)).toBe(true);
    const hint = r.h.session.buildExtras(TICK_DT).coverageHint;
    expect(hint).toMatch(/^COVERAGE: (MAN|ZONE)\?$/);
    expect(r.h.session.state.phase).toBe(GamePhase.PRE_SNAP);
    expect(r.drawNow()).toContain(`fillText(${hint},`);

    // Turning it off in settings takes it off the screen immediately.
    r.h.session.setSettings({
      volMaster: 7, volSfx: 8, volCrowd: 6, defaultDifficulty: 'pro',
      quarterMinutes: 5, coverageHints: 'off', bindings: {},
    });
    expect(r.h.session.buildExtras(TICK_DT).coverageHint).toBeNull();
    expect(r.drawNow()).not.toContain('COVERAGE:');
  });

  it('draws the kick meter while the kicking team owns it', () => {
    const r = rig();
    expect(runUntil(r.h, (s) => s.snapshots[1].kickMeter !== null)).toBe(true);
    const meter = r.h.session.snapshots[1].kickMeter;
    expect(meter?.active).toBe(true);
    const log = r.drawNow();
    expect(log.includes('fillText(POWER,') || log.includes('fillText(ACCURACY,')).toBe(true);
  });

  it('keeps the kick meter clear of the ticker line', () => {
    // The meter and the ticker are drawn by different renderers over the same
    // corner of the screen; the last kick of a drive lands while the previous
    // play's line is still typing.
    const cam = new Camera(1280, 720, 1);
    const s = uiScale(cam);
    const strip = new HudRenderer().layout(cam);
    const tickerTop = strip.y - HUD_STYLE.tickerOffset * s;
    // Meter baseline plus its bar height and the aim arrow hanging below it.
    const meterBottom = cam.heightCss - EFFECT_STYLE.kickMeterBottomOffset * s + 34 * s;
    expect(meterBottom).toBeLessThan(tickerTop);
  });
});

describe('replay chrome end to end', () => {
  it('letterboxes the field and offers the skip', () => {
    const ctx = new RecordingCtx();
    const renderer = new Renderer(fakeCanvas(ctx));
    renderer.resize(1280, 720, 1);
    const h = makeHarness({
      userTeam: 0,
      quarterLengthSec: 60,
      seed: 90210,
      renderer: null,
      onPrompt: autoAnswer,
    });
    h.session.setRenderer(renderer);

    expect(runUntil(h, (s) => s.replaying)).toBe(true);
    for (let i = 0; i < 12; i++) h.session.stepOneTick();

    ctx.reset();
    h.session.render(0.5, TICK_DT);
    const log = ctx.log.join('\n');

    // Two full-width black bars, top and bottom.
    const bar = 720 * 0.08;
    expect(log).toContain(`fillRect(0,0,1280,${bar})[#000000]`);
    expect(log).toContain(`fillRect(0,${720 - bar},1280,${bar})[#000000]`);
    expect(log).toContain('fillText(ANY KEY TO SKIP,');
    // No scoreboard behind the letterbox.
    expect(log).not.toContain('BALL ON');

    const tick = h.session.replayController?.view()?.curr.tick ?? 0;
    if (tick % 60 < 40) expect(log).toContain('fillText(REPLAY,');
  });
});
