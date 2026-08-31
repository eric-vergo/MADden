# MADden — Engine & Architecture Design (authoritative)

Reconciliation note: this is the authoritative module layout. Where the sim-design
doc says `src/core/...`, read `src/sim/...` per this file. The frozen Phase-0
contract files already exist on disk — read them first:
`src/sim/types.ts`, `src/sim/events.ts`, `src/sim/constants.ts`, `src/sim/rng.ts`,
`src/sim/hash.ts`, `src/sim/GameSim.ts`, `src/sim/phases/index.ts`,
`src/input/types.ts`, `src/audio/AudioEngine.ts`, `src/save/schemas.ts`,
`src/save/storage.ts`, `src/meta/types.ts`, `src/data/balance.ts`.

## Stack

Vite 6 + TypeScript strict + raw Canvas 2D + vitest. Zero runtime dependencies.
Scripts: `dev`, `build`, `test`, `test:soak` (vitest --mode soak), `typecheck`
(app tsconfig + DOM-less tsconfig.pure.json over src/sim, src/data, src/meta).
`tests/purity.test.ts` mechanically bans Math.random/Date/performance/DOM in pure dirs.

Determinism: seeded reproducibility on V8 (Chrome + Node/vitest) is the goal, not
cross-engine lockstep. Math.sin/cos/atan2/sqrt are fine.

## Directory / module structure

```
src/
├── main.ts                     # bootstrap: canvas, DPR, App, RAF loop, first-gesture audio init
├── app/
│   ├── App.ts                  # AppScreen state machine; routes screens; owns GameSession lifetime
│   └── GameLoop.ts             # fixed-timestep accumulator + render interpolation (DOM side)
├── sim/                        # ★ PURE. See frozen files. Imports only sim/ and data/.
│   ├── phases/                 # one file per GamePhase tick handler (registry in index.ts)
│   ├── rules/                  # downs.ts clock.ts scoring.ts penalties.ts kickMeter.ts
│   ├── physics/                # movement.ts collisions.ts ballFlight.ts
│   └── ai/                     # coach.ts qb.ts routes.ts coverage.ts blocking.ts tackling.ts
│                               #   pursuit.ts carrier.ts specialTeams.ts steering.ts (entry: index.ts)
├── data/                       # ★ PURE data. plays/{formations,offense,defense}.ts teams.ts
│                               #   names.ts ratings.ts balance.ts zones.ts
├── meta/                       # league.ts schedule.ts standings.ts playoffs.ts quickSim.ts seasonState.ts
├── input/                      # Keyboard.ts Bindings.ts InputSystem.ts (types.ts frozen)
├── render/                     # Renderer.ts Camera.ts FieldRenderer.ts EntityRenderer.ts
│                               #   EffectsRenderer.ts HudRenderer.ts logo.ts
├── audio/                      # WebAudioEngine.ts synth.ts AudioDirector.ts (AudioEngine.ts frozen)
├── ui/                         # ScreenManager.ts screens/*
├── replay/                     # ReplayBuffer.ts ReplayController.ts
├── save/                       # storage.ts schemas.ts (frozen)
└── game/                       # GameSession.ts PlayByPlay.ts
tests/
├── harness/                    # headlessGame.ts fixtures.ts
└── <stream>/*.test.ts          # each workstream owns its own test subdir
```

## Core loop (app/GameLoop.ts — DOM side, the only place performance.now lives)

```ts
class GameLoop {
  private acc = 0; private last = 0;
  frame = (now: number) => {
    this.acc += Math.min((now - this.last) / 1000, 0.25); // tab-restore spiral guard
    this.last = now;
    while (this.acc >= TICK_DT) { this.session.stepOneTick(); this.acc -= TICK_DT; }
    this.session.render(this.acc / TICK_DT);               // alpha ∈ [0,1)
    requestAnimationFrame(this.frame);
  };
}
```

## App-level state machine (app/App.ts)

BOOT → TITLE (any key; unlocks audio) → MAIN_MENU → { EXHIBITION_SETUP → GAME;
SEASON_MENU → TEAM_SELECT → SEASON_HUB; SETTINGS }. SEASON_HUB → GAME | standings |
bracket | sim week | save+exit. GAME → GAME_RESULT → MAIN_MENU or SEASON_HUB.
Screen stack for Esc/back. Transitions driven by UI callbacks + GAME_OVER SimEvent.

## In-game phases

See `GamePhase` in sim/types.ts. Notes:
- Kickoff/punt/FG/XP are OffensivePlayDefs (type field) flowing through the same
  PLAY_CALL → PRE_SNAP → PLAY_LIVE pipeline, with specialTeams AI + kick meter.
- Replay is NOT a sim phase — GameSession pauses ticking and plays back snapshots.
- Two-minute warning is a clock-rule event inside PLAY_DEAD, not a phase.
- Play clock RUNS during PLAY_CALL (40s from end of last play; 25s after admin stops).
  Expiry → delay of game. Both plays selected → PRE_SNAP. In PRE_SNAP players walk to
  alignment then settle; user snaps (or CPU QB auto-snaps at an rng-chosen play-clock
  value). PLAY_LIVE ends on tackle/OOB/incomplete/score/touchback/kick resolved/fumble
  recovered-and-downed → PLAY_DEAD (~1.5s): spot ball, apply downs/clock, emit
  PLAY_RESULT + BIG_PLAY?, then route to PENALTY_DECISION / POINT_AFTER_CHOICE /
  QUARTER_BREAK / HALFTIME / GAME_OVER / PLAY_CALL.

## Rendering

One visible canvas; explicit draw-order layers as functions; one offscreen
pre-rendered field canvas (redraw only on zoom/team change). Menus and modal
overlays are DOM in `#ui`; the in-game HUD is canvas-drawn.

- Camera (render/Camera.ts) is the single yards↔pixels authority: centerY follow
  (critically damped toward ball/carrier), pxPerYard chosen so field WIDTH fits
  + margin, clamped so view never leaves [0,120]. DPR capped at 2;
  ctx.setTransform(dpr…) once per resize; draw code works in CSS pixels.
- FieldRenderer: pre-render 120yd field once — alternating 5-yd green bands,
  yard lines, hash marks, numbers, end zones with team colors/names, midfield disc.
- EntityRenderer (procedural, no assets): shadow ellipse → torso circle (jersey
  color) → helmet circle offset toward facing → jersey number → 2-frame leg
  shuffle (phase from vel magnitude + tick). Ball = brown ellipse scaled by z with
  offset shadow. Controlled player gets a ring; receiver key icons (1–5) above
  eligibles while QB holds ball.
- Interpolation: `Renderer.draw(prev: TickSnapshot, curr: TickSnapshot, alpha,
  state: Readonly<GameState>)` — positions lerped, discrete state from curr.

## Input

Semantic actions (GameAction in sim/types.ts), context-keyed bindings, per-tick
sampled InputFrames with lossless edge detection (event queue drained per tick so
taps within one frame are never lost). Contexts: MENU, PLAY_CALL, PRE_SNAP_OFF,
PRE_SNAP_DEF, QB_PASSING, BALL_CARRIER, DEFENSE, KICK_METER, RETURN_WAIT, REPLAY, PAUSED.

Default bindings: arrows+WASD move; Enter confirm; Esc back/pause.
PLAY_CALL: arrows move cursor, Q/E pages, T timeout. PRE_SNAP_OFF: Space snap,
H hard count, T timeout. PRE_SNAP_DEF: Tab switch (cycle), Space nearest-to-LOS.
QB_PASSING: move scrambles; 1–5 throw (tap = lob, hold ≥180ms/12 ticks = bullet);
Space pump fake; X throwaway; crossing LOS → BALL_CARRIER. BALL_CARRIER: Shift
sprint, Space dive, J juke, K spin, L stiff-arm. DEFENSE: Shift sprint, Space
dive-tackle, Tab switch. KICK_METER: Left/Right aim, Space×3 (start/power/accuracy).
Meter position is a pure function of ticks — deterministic.

## Audio

AudioEngine interface (frozen) + NullAudioEngine for headless. WebAudioEngine:
AudioContext → masterGain → destination; buses sfx/crowd/ui. One shared 2s noise
buffer (Math.random allowed here — presentation layer). Recipes: crowd = looped
noise → lowpass 500–1800Hz, intensity maps to gain AND cutoff via setTargetAtTime;
whistle = two squares 2093/2350Hz + 30Hz LFO warble; hits = noise burst → lowpass
400Hz + 55Hz sine thump; kick = 70→40Hz sine drop + click; TD fanfare = chiptune
square arpeggio. AudioDirector maps SimEvents → play() calls + derives crowd
intensity from game situation (base 0.25; red zone, two-minute, close Q4 boost;
big-play swells; away-team scores deflate).

## Replay

Record real TickSnapshots into a ring buffer every tick during PLAY_LIVE (+1s
pre-snap); ~25s capacity. BIG_PLAY event (touchdown, turnover, sack, 20+ yd gain,
return TD, game-winner) → GameSession pauses sim, ReplayController plays frames
back through the normal Renderer at 0.5× with REPLAY banner; Esc/Enter skips.
Pure presentation; zero determinism impact.

## Save

See frozen save/schemas.ts + storage.ts. Keys `madden:settings`, `madden:season`;
envelope {v, savedAt, data}; migration chain; corruption → quarantine `.corrupt`
+ fresh. Save at settings change, after each played/simmed week, Save+Exit.
No mid-game saves (quit = discard, with confirm).

## Parallelization rules (all workstream agents)

- One directory per agent. Do NOT edit frozen contract files or other streams' dirs.
- New tunables: define locally with `// TODO(balance)` comment; a consolidation
  pass moves them into data/balance.ts later. Do not edit balance.ts concurrently.
- Tests land in tests/<stream>/. Keep `tests/purity.test.ts` green (no
  Math.random/Date/DOM in sim, data, meta).
- Mid-phase, other streams may briefly break global typecheck; ensure YOUR files
  are clean: `npx tsc --noEmit 2>&1 | grep 'src/<yourdir>'` empty, and your scoped
  tests pass: `npx vitest run tests/<stream>`.
```
