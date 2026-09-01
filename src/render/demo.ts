// Standalone visual harness for the render stream (render-demo.html).
// Everything here is hand-written fixture data: a scripted 65-yard touchdown
// pass driven by keyframed TickSnapshots plus a minimal fake GameState. No sim,
// no input system, no app shell — if this page looks right, the renderer is
// right.

import { TICK_DT } from '../sim/constants';
import {
  GamePhase,
  type GameState,
  type KickMeterState,
  type PlayerAnimState,
  type PlayerSnap,
  type Position,
  type TeamRoster,
  type TeamSide,
  type TickSnapshot,
} from '../sim/types';
import type { LogoSpec } from '../meta/types';
import { Renderer } from './Renderer';
import { drawLogo } from './logo';
import { UI_FONT } from './ctx';
import { roundRectPath } from './shapes';
import { teamPresentation, type RendererExtras, type TeamPresentation } from './types';

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const ASH_LOGO: LogoSpec = {
  frame: 'shield', motif: 'wing', motifCount: 1, rotationDeg: 0,
  frameColor: '#1B3A6B', motifColor: '#E8B93E', accentColor: '#FFFFFF',
};

const MER_LOGO: LogoSpec = {
  frame: 'roundel', motif: 'star', motifCount: 1, rotationDeg: 0,
  frameColor: '#5C2D91', motifColor: '#F0A500', accentColor: '#FFFFFF',
};

const TEAMS: readonly [TeamPresentation, TeamPresentation] = [
  teamPresentation('ASH', 'Ashford', 'Aviators', { primary: '#1B3A6B', secondary: '#E8B93E' }, ASH_LOGO),
  teamPresentation('MER', 'Meridian', 'Monarchs', { primary: '#5C2D91', secondary: '#F0A500' }, MER_LOGO),
];

const EMPTY_DEPTH: Record<Position, string[]> = {
  QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], CB: [], S: [], K: [], P: [],
};

function demoRoster(pres: TeamPresentation): TeamRoster {
  return {
    teamId: pres.abbrev,
    city: pres.city,
    nickname: pres.nickname,
    abbrev: pres.abbrev,
    colors: pres.colors,
    athletes: [],
    depth: { ...EMPTY_DEPTH },
    returners: { kr: '', pr: '' },
  };
}

// ---------------------------------------------------------------------------
// Scripted play: keyframed tracks, world yards
// ---------------------------------------------------------------------------

const LOOP_TICKS = 420;
const SNAP_TICK = 60;
const THROW_TICK = 130;
const CATCH_TICK = 175;
const TD_TICK = 300;
const LOS_Y = 45;
const FIRST_DOWN_Y = 55;

type Key = readonly [tick: number, x: number, y: number];

interface Track {
  jersey: number;
  team: TeamSide;
  keys: readonly Key[];
}

const OFFENSE: readonly Track[] = [
  { jersey: 12, team: 0, keys: [[0, 26.7, 43], [60, 26.7, 43], [95, 26.9, 38.2], [130, 27.5, 38.5], [420, 27.5, 38.5]] },
  { jersey: 28, team: 0, keys: [[0, 24.5, 41], [60, 24.5, 41], [100, 25.5, 42.5], [175, 25.8, 42.8], [420, 25.8, 42.8]] },
  { jersey: 74, team: 0, keys: [[0, 21.7, 44.5], [60, 21.7, 44.5], [110, 21.2, 45.6], [175, 21.0, 46.0], [420, 21.0, 46.0]] },
  { jersey: 66, team: 0, keys: [[0, 24.2, 44.5], [60, 24.2, 44.5], [110, 23.9, 45.4], [420, 23.8, 45.8]] },
  { jersey: 55, team: 0, keys: [[0, 26.7, 44.5], [60, 26.7, 44.5], [110, 26.6, 45.3], [420, 26.5, 45.7]] },
  { jersey: 63, team: 0, keys: [[0, 29.2, 44.5], [60, 29.2, 44.5], [110, 29.4, 45.4], [420, 29.5, 45.8]] },
  { jersey: 78, team: 0, keys: [[0, 31.7, 44.5], [60, 31.7, 44.5], [110, 32.2, 45.6], [420, 32.4, 46.0]] },
  { jersey: 85, team: 0, keys: [[0, 34.2, 44.5], [60, 34.2, 44.5], [100, 31, 48], [140, 24, 49], [420, 20, 50]] },
  { jersey: 11, team: 0, keys: [[0, 6, 44.5], [60, 6, 44.5], [105, 10, 52], [150, 16, 56], [420, 22, 60]] },
  { jersey: 83, team: 0, keys: [[0, 40, 43.5], [60, 40, 43.5], [100, 41, 52], [130, 40.5, 55], [175, 39, 55.5], [420, 36, 58]] },
  { jersey: 80, team: 0, keys: [[0, 47, 44.5], [60, 47, 44.5], [130, 46, 58], [175, 45, 64], [230, 43, 86], [300, 40, 110], [420, 40, 113]] },
];

const DEFENSE: readonly Track[] = [
  { jersey: 92, team: 1, keys: [[0, 22.5, 46.2], [60, 22.5, 46.2], [110, 23.5, 44], [175, 25, 42], [420, 25.5, 41]] },
  { jersey: 97, team: 1, keys: [[0, 25.5, 46.2], [60, 25.5, 46.2], [110, 26, 44.5], [420, 26.5, 43]] },
  { jersey: 95, team: 1, keys: [[0, 28.5, 46.2], [60, 28.5, 46.2], [110, 28.8, 44.6], [420, 29, 43.2]] },
  { jersey: 91, team: 1, keys: [[0, 31.5, 46.2], [60, 31.5, 46.2], [110, 31, 44], [175, 29.5, 41.5], [420, 29, 41]] },
  { jersey: 52, team: 1, keys: [[0, 22, 49.5], [60, 22, 49.5], [110, 24, 50], [175, 26, 52], [420, 28, 58]] },
  { jersey: 54, team: 1, keys: [[0, 27, 49.5], [60, 27, 49.5], [110, 28, 51], [175, 30, 53], [420, 33, 62]] },
  { jersey: 58, team: 1, keys: [[0, 32, 49.5], [60, 32, 49.5], [110, 34, 52], [175, 36, 55], [420, 38, 66]] },
  { jersey: 24, team: 1, keys: [[0, 7, 50.5], [60, 7, 50.5], [110, 11, 55], [175, 17, 58], [420, 24, 64]] },
  { jersey: 21, team: 1, keys: [[0, 46, 50.5], [60, 46, 50.5], [130, 45.5, 60], [175, 46, 66], [230, 44.5, 88], [300, 42.5, 108], [420, 42.5, 111]] },
  { jersey: 31, team: 1, keys: [[0, 18, 58], [60, 18, 58], [130, 26, 62], [175, 34, 66], [230, 42, 90], [300, 41, 109], [420, 41, 111]] },
  { jersey: 33, team: 1, keys: [[0, 35, 58], [60, 35, 58], [130, 38, 61], [175, 40, 64], [420, 44, 96]] },
];

const TRACKS: readonly Track[] = [...OFFENSE, ...DEFENSE];
const QB_IDX = 0;
const WR2_IDX = 10;

function samplePos(track: Track, t: number): { x: number; y: number } {
  const keys = track.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return { x: 0, y: 0 };
  if (t <= first[0]) return { x: first[1], y: first[2] };
  if (t >= last[0]) return { x: last[1], y: last[2] };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (!a || !b) continue;
    if (t <= b[0]) {
      const span = Math.max(1e-6, b[0] - a[0]);
      const k = (t - a[0]) / span;
      // Ease slightly so keyframe corners do not read as robotic.
      const e = k * k * (3 - 2 * k);
      return { x: a[1] + (b[1] - a[1]) * e, y: a[2] + (b[2] - a[2]) * e };
    }
  }
  return { x: last[1], y: last[2] };
}

function animFor(idx: number, t: number, speed: number): PlayerAnimState {
  if (t >= TD_TICK && idx === WR2_IDX) return 'celebrating';
  if (t < SNAP_TICK) return 'idle';
  if (speed > 0.5) return 'running';
  return 'idle';
}

interface BallSample {
  x: number;
  y: number;
  z: number;
  mode: 'held' | 'pass';
}

function ballAt(t: number): BallSample {
  if (t < THROW_TICK) {
    const qb = samplePos(TRACKS[QB_IDX] as Track, t);
    return { x: qb.x + 0.5, y: qb.y - 0.4, z: 1.1, mode: 'held' };
  }
  if (t < CATCH_TICK) {
    const from = samplePos(TRACKS[QB_IDX] as Track, THROW_TICK);
    const to = samplePos(TRACKS[WR2_IDX] as Track, CATCH_TICK);
    const k = (t - THROW_TICK) / (CATCH_TICK - THROW_TICK);
    return {
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      z: 1.2 + 4 * 6.0 * k * (1 - k),
      mode: 'pass',
    };
  }
  const wr = samplePos(TRACKS[WR2_IDX] as Track, t);
  return { x: wr.x - 0.4, y: wr.y - 0.3, z: 1.1, mode: 'held' };
}

function phaseAt(t: number): GamePhase {
  if (t < 30) return GamePhase.PLAY_CALL;
  if (t < SNAP_TICK) return GamePhase.PRE_SNAP;
  if (t < TD_TICK) return GamePhase.PLAY_LIVE;
  return GamePhase.PLAY_DEAD;
}

function kickMeterAt(t: number, enabled: boolean): KickMeterState | null {
  if (!enabled) return null;
  const cycle = 150;
  const start = t - (t % cycle);
  const phase = t % cycle;
  return {
    active: true,
    startTick: start,
    powerLockTick: phase > 46 ? start + 46 : null,
    accuracyLockTick: phase > 108 ? start + 108 : null,
    aimOffset: Math.sin(t / 90) * 0.18,
  };
}

/** Build the snapshot for absolute tick `tick` (the script loops every 7s). */
function buildSnapshot(tick: number, kickMeter: boolean): TickSnapshot {
  const t = ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
  const players: PlayerSnap[] = [];
  for (let i = 0; i < TRACKS.length; i++) {
    const track = TRACKS[i];
    if (!track) continue;
    const now = samplePos(track, t);
    const next = samplePos(track, t + 2);
    const dx = next.x - now.x;
    const dy = next.y - now.y;
    const speed = Math.hypot(dx, dy) * 30;
    const defaultFacing = track.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    players.push({
      x: now.x,
      y: now.y,
      facing: speed > 0.2 ? Math.atan2(dy, dx) : defaultFacing,
      anim: animFor(i, t, speed),
      hasBall: (i === QB_IDX && t < THROW_TICK) || (i === WR2_IDX && t >= CATCH_TICK),
      team: track.team,
      jersey: track.jersey,
      controlled: t < THROW_TICK ? i === QB_IDX : i === WR2_IDX,
    });
  }
  const b = ballAt(t);
  return {
    tick,
    phase: phaseAt(t),
    players,
    ball: { x: b.x, y: b.y, z: b.z, mode: b.mode },
    lineOfScrimmageY: LOS_Y,
    firstDownY: FIRST_DOWN_Y,
    kickMeter: kickMeterAt(t, kickMeter),
  };
}

// ---------------------------------------------------------------------------
// Fake game state + extras
// ---------------------------------------------------------------------------

function makeState(): GameState {
  return {
    seed: 1234,
    tick: 0,
    phase: GamePhase.PLAY_CALL,
    config: {
      quarterLengthSec: 300,
      difficulty: 'pro',
      userTeam: 0,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: true,
    },
    rosters: [demoRoster(TEAMS[0]), demoRoster(TEAMS[1])],
    score: [14, 21],
    quarter: 2,
    clockSec: 272,
    playClockSec: 25,
    clockRunning: true,
    possession: 0,
    down: 2,
    toGo: 10,
    ballOnY: LOS_Y,
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
          teamId: 'ASH', points: 14, totalYds: 288, passYds: 190, rushYds: 98, firstDowns: 12,
          thirdDownConv: 4, thirdDownAtt: 9, turnovers: 1, penalties: 3, penaltyYds: 25,
          topSeconds: 840, sacksAllowed: 2,
        },
        {
          teamId: 'MER', points: 21, totalYds: 301, passYds: 214, rushYds: 87, firstDowns: 14,
          thirdDownConv: 5, thirdDownAtt: 10, turnovers: 0, penalties: 4, penaltyYds: 40,
          topSeconds: 960, sacksAllowed: 1,
        },
      ],
      players: {},
      scoringByQuarter: [[7, 7], [14, 7]],
    },
    playLog: [],
  };
}

const TICKER_TEXT = 'M. Vance finds T. Reyes down the right sideline for 65 yards!';

function updateState(state: GameState, tick: number): void {
  const t = ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
  state.tick = tick;
  state.phase = phaseAt(t);
  state.clockSec = Math.max(0, 272 - Math.floor(t / 60));
  state.playClockSec = Math.max(0, 25 - Math.floor(t / 60));
  state.score = [t >= TD_TICK + 2 ? 20 : 14, 21];
  state.down = t >= TD_TICK ? 1 : 2;
  state.toGo = t >= TD_TICK ? 10 : 10;
  state.ballOnY = t >= TD_TICK ? 110 : LOS_Y;
}

interface DemoFlags {
  showHud: boolean;
  kickMeter: boolean;
  flipped: boolean;
  logoSheet: boolean;
  paused: boolean;
}

function buildExtras(tick: number, dt: number, flags: DemoFlags): RendererExtras {
  const t = ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
  const inFlight = t >= THROW_TICK && t < CATCH_TICK;
  const catchSpot = samplePos(TRACKS[WR2_IDX] as Track, CATCH_TICK);
  return {
    frameDtSec: dt,
    teams: TEAMS,
    ticker: t >= TD_TICK + 5 ? { text: TICKER_TEXT, startTick: tick - (t - (TD_TICK + 5)) } : null,
    banner: t >= TD_TICK + 2 && t < TD_TICK + 2 + 84
      ? { kind: 'touchdown', text: 'Touchdown Aviators!', startTick: tick - (t - (TD_TICK + 2)), team: 0 }
      : null,
    coverageHint: t >= 20 && t < SNAP_TICK ? 'COVERAGE: MAN?' : null,
    yardagePopup: t >= TD_TICK && t < TD_TICK + 48
      ? { yards: 65, x: 40, y: 108, startTick: tick - (t - TD_TICK) }
      : null,
    receiverKeys: [
      { idx: 8, key: 1 },
      { idx: 10, key: 2 },
      { idx: 9, key: 3 },
      { idx: 7, key: 4 },
      { idx: 1, key: 5 },
    ],
    showReceiverKeys: t >= SNAP_TICK && t < THROW_TICK,
    passLanding: inFlight ? { x: catchSpot.x, y: catchSpot.y } : null,
    replay: t >= 350,
    showHud: flags.showHud,
    cameraTargetY: null,
    viewAttackDir: flags.flipped ? -1 : 1,
    debug: false,
  };
}

// ---------------------------------------------------------------------------
// Overlays owned by the demo page itself
// ---------------------------------------------------------------------------

const HELP_LINES = [
  'MADden render demo — scripted 65-yard touchdown, looping every 7s',
  '[Space] pause   [R] restart   [F] flip camera   [H] HUD   [K] kick meter   [L] logo sheet',
];

function drawHelp(ctx: CanvasRenderingContext2D, w: number, flags: DemoFlags): void {
  ctx.save();
  roundRectPath(ctx, 12, 12, Math.min(w - 24, 720), 52, 6);
  ctx.fillStyle = 'rgba(9,12,17,0.72)';
  ctx.fill();
  ctx.font = `bold 13px ${UI_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#EFF3F7';
  ctx.fillText(HELP_LINES[0] ?? '', 24, 28);
  ctx.font = `12px ${UI_FONT}`;
  ctx.fillStyle = '#9FB0C0';
  ctx.fillText(HELP_LINES[1] ?? '', 24, 48);
  if (flags.paused) {
    ctx.font = `bold 13px ${UI_FONT}`;
    ctx.fillStyle = '#F2C744';
    ctx.textAlign = 'right';
    ctx.fillText('PAUSED', Math.min(w - 24, 732) - 12, 28);
  }
  ctx.restore();
}

const SHEET_FRAMES: LogoSpec['frame'][] = ['shield', 'circle', 'hexagon', 'diamond', 'roundel'];
const SHEET_MOTIFS: LogoSpec['motif'][] = [
  'bolt', 'star', 'chevron', 'wing', 'fang', 'claw',
  'peak', 'orbit', 'crest-stripes', 'initial', 'shield-in-shield',
];

function drawLogoSheet(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cell = Math.min(58, (w - 120) / SHEET_MOTIFS.length);
  const gridW = cell * SHEET_MOTIFS.length + 60;
  const gridH = cell * SHEET_FRAMES.length + 60;
  const x0 = (w - gridW) / 2;
  const y0 = (h - gridH) / 2;

  ctx.save();
  roundRectPath(ctx, x0, y0, gridW, gridH, 10);
  ctx.fillStyle = 'rgba(9,12,17,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(240,244,248,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = `bold 12px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9FB0C0';
  ctx.fillText('LogoSpec grammar — 5 frames x 11 motifs', x0 + gridW / 2, y0 + 18);

  for (let r = 0; r < SHEET_FRAMES.length; r++) {
    for (let c = 0; c < SHEET_MOTIFS.length; c++) {
      const frame = SHEET_FRAMES[r];
      const motif = SHEET_MOTIFS[c];
      if (!frame || !motif) continue;
      const pres = c % 2 === 0 ? TEAMS[0] : TEAMS[1];
      const spec: LogoSpec = {
        frame,
        motif,
        motifCount: ((c % 3) + 1) as 1 | 2 | 3,
        rotationDeg: 0,
        frameColor: pres.colors.primary,
        motifColor: pres.colors.secondary,
        accentColor: '#FFFFFF',
      };
      drawLogo(
        ctx,
        spec,
        cell * 0.88,
        x0 + 30 + cell * (c + 0.5),
        y0 + 34 + cell * (r + 0.5),
        { letter: 'M' },
      );
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('render-demo: #game canvas missing');
  const overlayCtx = canvas.getContext('2d');
  if (!overlayCtx) throw new Error('render-demo: no 2d context');

  const renderer = new Renderer(canvas);
  const state = makeState();
  const flags: DemoFlags = {
    showHud: true,
    kickMeter: false,
    flipped: false,
    logoSheet: false,
    paused: false,
  };

  const resize = (): void => {
    renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  };
  window.addEventListener('resize', resize);
  resize();

  // Debug seek: render-demo.html#t=302 starts on the touchdown, #paused freezes.
  const hash = window.location.hash;
  const seek = /(?:^|[#&])t=(\d+)/.exec(hash);
  let tick = seek && seek[1] ? Number(seek[1]) : 0;
  if (/(?:^|[#&])paused/.test(hash)) flags.paused = true;
  if (/(?:^|[#&])logos/.test(hash)) flags.logoSheet = true;
  if (/(?:^|[#&])kick/.test(hash)) flags.kickMeter = true;

  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    switch (ev.key.toLowerCase()) {
      case ' ': flags.paused = !flags.paused; ev.preventDefault(); break;
      case 'r': tick = 0; renderer.snapCamera(LOS_Y); renderer.effects.clear(); break;
      case 'f': flags.flipped = !flags.flipped; break;
      case 'h': flags.showHud = !flags.showHud; break;
      case 'k': flags.kickMeter = !flags.kickMeter; break;
      case 'l': flags.logoSheet = !flags.logoSheet; break;
      default: break;
    }
  });

  let last = performance.now();
  let acc = 0;

  const frame = (now: number): void => {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= TICK_DT) {
      if (!flags.paused) {
        const before = ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
        tick++;
        const after = ((tick % LOOP_TICKS) + LOOP_TICKS) % LOOP_TICKS;
        if (after < before) {
          // Loop wrap: cut rather than sweep the camera back down the field.
          renderer.snapCamera(LOS_Y);
          renderer.effects.clear();
        }
        if (after === CATCH_TICK) {
          const spot = samplePos(TRACKS[WR2_IDX] as Track, CATCH_TICK);
          renderer.effects.emit('catchFlash', spot.x, spot.y, tick);
        }
        if (after === TD_TICK) {
          const spot = samplePos(TRACKS[WR2_IDX] as Track, TD_TICK);
          renderer.effects.emit('bigHit', spot.x, spot.y, tick);
          renderer.effects.emit('dust', spot.x - 1, spot.y - 1, tick);
        }
      }
      acc -= TICK_DT;
    }

    updateState(state, tick);
    const curr = buildSnapshot(tick, flags.kickMeter);
    const prev = buildSnapshot(tick - 1, flags.kickMeter);
    renderer.draw(prev, curr, acc / TICK_DT, state, buildExtras(tick, dt, flags));

    drawHelp(overlayCtx, renderer.camera.widthCss, flags);
    if (flags.logoSheet) {
      drawLogoSheet(overlayCtx, renderer.camera.widthCss, renderer.camera.heightCss);
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

boot();
