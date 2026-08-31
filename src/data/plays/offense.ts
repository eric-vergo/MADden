// The offensive playbook: 36 called plays (10 runs / 7 quick / 8 medium /
// 5 deep / 3 play-action-boot / 3 screens) plus the special-teams and
// clock-management plays. Everything here is DATA — the AI reads waypoints,
// it never reads play ids.
//
// Frame: offense drives +y, x is offset from the ball (+x = offense's right).
// Route/carry waypoints are offsets from the runner's ALIGNMENT spot (not from
// the previous waypoint), so a waypoint's dy is "yards gained from where I
// lined up". atTick is the target arrival tick post-snap; it paces the route.

import type {
  OffAssignment, OffensivePlayDef, RoleId, Route, RouteWaypoint,
  RunBlockTarget, RunScheme,
} from '../../sim/types';

/** +1 = break toward the offense's right, -1 = toward its left. */
type Side = 1 | -1;

type Assignments = Partial<Record<RoleId, OffAssignment>>;

function wp(
  dx: number,
  dy: number,
  breakStyle: 'sharp' | 'rounded',
  atTick: number,
  thenAction?: 'settle' | 'lookForBall' | 'blockNearest',
): RouteWaypoint {
  return thenAction === undefined
    ? { dx, dy, breakStyle, atTick }
    : { dx, dy, breakStyle, atTick, thenAction };
}

function route(r: Route): OffAssignment {
  return { kind: 'route', route: r };
}

function primaryRoute(r: Route): OffAssignment {
  return { kind: 'route', route: r, primary: true };
}

// ---------------------------------------------------------------------------
// Route library. Depths are the concept's real depths; the pacing ticks assume
// ~7.5 yd/s so a 12-yard stem lands around tick 40.
// ---------------------------------------------------------------------------

/** 3-yard sharp break inside; the standard hot answer to a blitz. */
function slant(side: Side): Route {
  return {
    waypoints: [wp(0, 3, 'sharp', 14), wp(side * 6.5, 7.5, 'sharp', 30, 'lookForBall')],
    hot: true,
  };
}

/** Stem to depth, snap back toward the QB and sit. */
function hitch(depth = 5.5): Route {
  return {
    waypoints: [
      wp(0, depth, 'sharp', 18 + Math.round(depth * 1.6)),
      wp(0, depth - 1.3, 'sharp', 26 + Math.round(depth * 1.6), 'settle'),
    ],
    vsZoneSettle: true,
  };
}

function quickOut(side: Side, depth = 5.5): Route {
  return {
    waypoints: [wp(0, depth, 'sharp', 22), wp(side * 5.5, depth + 0.6, 'sharp', 32, 'lookForBall')],
  };
}

/** 12-yard curl: rounded stem, settle back inside into the soft spot. */
function curl(side: Side, depth = 12): Route {
  return {
    waypoints: [
      wp(0, depth, 'rounded', 40),
      wp(side * -1.5, depth - 1.5, 'sharp', 48, 'settle'),
    ],
    vsZoneSettle: true,
  };
}

/** In-breaking dig at 12-13. */
function dig(side: Side, depth = 12.5): Route {
  return {
    waypoints: [wp(0, depth, 'sharp', 42), wp(side * 13, depth + 0.8, 'sharp', 64, 'lookForBall')],
  };
}

/** Rounded post breaking at 12-15. */
function post(side: Side, breakDepth = 13): Route {
  return {
    waypoints: [
      wp(0, breakDepth, 'rounded', 42),
      wp(side * 10, breakDepth + 13, 'rounded', 68, 'lookForBall'),
    ],
  };
}

function corner(side: Side, breakDepth = 11): Route {
  return {
    waypoints: [
      wp(0, breakDepth, 'sharp', 38),
      wp(side * 9, breakDepth + 9, 'rounded', 60, 'lookForBall'),
    ],
  };
}

/** Straight vertical; drift is the lateral offset at the top of the stem. */
function go(drift = 0): Route {
  return {
    waypoints: [wp(drift * 0.4, 12, 'rounded', 34), wp(drift, 26, 'rounded', 62, 'lookForBall')],
  };
}

/** Shallow crosser: 4-6 yards deep, all the way across the formation. */
function shallowCross(side: Side, depth = 4.5): Route {
  return {
    waypoints: [wp(0, depth, 'sharp', 16), wp(side * 15, depth + 1.5, 'rounded', 46, 'lookForBall')],
  };
}

/** Deep crosser: climbs to 9-15 while working across. */
function deepCross(side: Side, depth = 9): Route {
  return {
    waypoints: [wp(0, depth, 'rounded', 26), wp(side * 19, depth + 6, 'rounded', 62, 'lookForBall')],
  };
}

function flatRoute(side: Side): Route {
  return {
    waypoints: [wp(side * 5, 1.5, 'rounded', 12), wp(side * 12, 3.2, 'rounded', 28, 'lookForBall')],
  };
}

/** Push to depth, snap back downhill toward the sideline. */
function comeback(side: Side, depth = 15): Route {
  return {
    waypoints: [
      wp(0, depth, 'rounded', 46),
      wp(side * 2.2, depth - 3.5, 'sharp', 58, 'lookForBall'),
    ],
  };
}

/** Sail/out-and-up-the-boundary at 12-15. */
function sail(side: Side, depth = 12): Route {
  return {
    waypoints: [wp(0, depth, 'rounded', 38), wp(side * 10, depth + 3, 'rounded', 58, 'lookForBall')],
  };
}

/** 5-6 yard sit route with an inside snap — the Stick concept's #2. */
function stick(side: Side): Route {
  return {
    waypoints: [wp(0, 5.5, 'sharp', 22), wp(side * 2.2, 6.2, 'sharp', 30, 'settle')],
    vsZoneSettle: true,
  };
}

/** Spacing: get to a landmark at 5-6 and sit down in the zone hole. */
function spacingSit(side: Side, width: number, depth = 6): Route {
  return {
    waypoints: [wp(side * width, depth, 'rounded', 24, 'settle')],
    vsZoneSettle: true,
  };
}

function fade(side: Side): Route {
  return {
    waypoints: [wp(side * 1.5, 6, 'rounded', 22), wp(side * 3.2, 15, 'rounded', 48, 'lookForBall')],
  };
}

/** Slant-and-go: sell the 3-yard break, then climb. */
function sluggo(side: Side): Route {
  return {
    waypoints: [
      wp(0, 3, 'sharp', 14),
      wp(side * 4, 6.5, 'sharp', 24),
      wp(side * 3, 22, 'rounded', 60, 'lookForBall'),
    ],
  };
}

/** Switch release under the outside vertical, then run the seam. */
function switchVert(side: Side): Route {
  return {
    waypoints: [wp(side * 2.5, 4, 'rounded', 14), wp(side * 4, 26, 'rounded', 64, 'lookForBall')],
  };
}

/** Receiver stalk-blocks on a run: get to the DB's face, then block. */
function stalk(): Route {
  return { waypoints: [wp(0, 6, 'rounded', 20, 'blockNearest')] };
}

/** Clear-out: run the coverage off, then block if the ball comes underneath. */
function clearout(): Route {
  return { waypoints: [wp(0, 11, 'rounded', 32, 'blockNearest')] };
}

/** Perimeter blocker on a screen — no stem, straight to the near defender. */
function screenBlock(side: Side): Route {
  return { waypoints: [wp(side * 1.8, 1.2, 'rounded', 10, 'blockNearest')] };
}

function bubble(side: Side): Route {
  return {
    waypoints: [wp(side * 3.5, -1.5, 'rounded', 8), wp(side * 8, -0.5, 'rounded', 20, 'lookForBall')],
  };
}

/** Tunnel: work back inside behind the releasing linemen. */
function tunnel(side: Side): Route {
  return {
    waypoints: [wp(side * 2.5, 0.2, 'rounded', 12), wp(side * 8, 1.8, 'rounded', 26, 'lookForBall')],
  };
}

/** Slip screen: sell protection, then leak out late (delayed release). */
function slipScreen(side: Side): Route {
  return {
    waypoints: [wp(side * 2, -1.2, 'rounded', 18), wp(side * 7, -0.8, 'rounded', 32, 'lookForBall')],
  };
}

function swing(side: Side): Route {
  return {
    waypoints: [wp(side * 4, -1, 'rounded', 14), wp(side * 10, 1.5, 'rounded', 30, 'lookForBall')],
  };
}

/** RB check-release: scan first, then out into the flat as the checkdown. */
function checkFlat(side: Side): Route {
  return { waypoints: [wp(side * 4, 1.5, 'rounded', 26, 'lookForBall')] };
}

/** FB sells the lead block, then leaks into the flat behind the linebackers. */
function leak(side: Side): Route {
  return {
    waypoints: [wp(side * 2, 1, 'rounded', 26), wp(side * 10, 4, 'rounded', 48, 'lookForBall')],
  };
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

function olPass(): Assignments {
  return {
    LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' },
    RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' },
  };
}

/** Targets in fixed order: LT, LG, C, RG, RT. */
function olRun(
  scheme: RunScheme,
  targets: readonly [RunBlockTarget, RunBlockTarget, RunBlockTarget, RunBlockTarget, RunBlockTarget],
): Assignments {
  return {
    LT: { kind: 'runBlock', scheme, target: targets[0] },
    LG: { kind: 'runBlock', scheme, target: targets[1] },
    C: { kind: 'runBlock', scheme, target: targets[2] },
    RG: { kind: 'runBlock', scheme, target: targets[3] },
    RT: { kind: 'runBlock', scheme, target: targets[4] },
  };
}

export const OFFENSIVE_PLAYS: readonly OffensivePlayDef[] = [
  // =========================================================================
  // RUNS (10)
  // =========================================================================
  {
    id: 'i-form-hb-dive',
    name: 'HB Dive',
    formationId: 'i-form',
    type: 'run',
    tags: ['run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      FB: { kind: 'leadBlock', throughGap: 'A-right' },
      RB: {
        kind: 'carry', mesh: 'handoff', meshTick: 24, aimGap: 'A-right',
        path: [
          wp(0.4, 4.5, 'rounded', 16),
          wp(1.0, 8.2, 'rounded', 28),
          wp(1.6, 13.0, 'rounded', 44),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      ...olRun('gap', ['backside', 'playside-gap', 'playside-gap', 'playside-gap', 'climb']),
    },
  },
  {
    id: 'i-form-hb-iso',
    name: 'HB Iso',
    formationId: 'i-form',
    type: 'run',
    tags: ['run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      FB: { kind: 'leadBlock', throughGap: 'B-right' },
      RB: {
        kind: 'carry', mesh: 'handoff', meshTick: 26, aimGap: 'B-right',
        path: [
          wp(0.6, 4.4, 'rounded', 16),
          wp(1.8, 8.4, 'rounded', 30),
          wp(2.8, 13.0, 'rounded', 46),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      ...olRun('gap', ['backside', 'playside-gap', 'playside-gap', 'playside-gap', 'climb']),
    },
  },
  {
    id: 'i-form-hb-toss',
    name: 'HB Toss',
    formationId: 'i-form',
    type: 'run',
    tags: ['run-outside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 2 } },
      FB: { kind: 'leadBlock', throughGap: 'D-right' },
      RB: {
        kind: 'carry', mesh: 'pitch', meshTick: 34, aimGap: 'D-right',
        path: [
          wp(4.5, 1.5, 'rounded', 18),
          wp(9.0, 5.0, 'rounded', 34),
          wp(11.0, 11.0, 'rounded', 52),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      // Backside tackle cuts, playside guard pulls around the edge.
      ...olRun('gap', ['climb', 'pull-lead', 'playside-gap', 'playside-gap', 'playside-gap']),
    },
  },
  {
    id: 'i-form-fb-dive',
    name: 'FB Dive',
    formationId: 'i-form',
    type: 'run',
    tags: ['run-inside', 'goal-line'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      FB: {
        kind: 'carry', mesh: 'handoff', meshTick: 20, aimGap: 'A-left',
        path: [
          wp(-0.5, 3.0, 'rounded', 14),
          wp(-1.0, 7.0, 'rounded', 26),
          wp(-1.5, 11.0, 'rounded', 42),
        ],
      },
      RB: { kind: 'leadBlock', throughGap: 'A-left' },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'climb' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      ...olRun('gap', ['playside-gap', 'playside-gap', 'playside-gap', 'backside', 'climb']),
    },
  },
  {
    id: 'single-inside-zone',
    name: 'Inside Zone',
    formationId: 'singleback',
    type: 'run',
    tags: ['run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      RB: {
        kind: 'carry', mesh: 'handoff', meshTick: 24, aimGap: 'A-right',
        path: [
          wp(1.2, 3.5, 'rounded', 16),
          wp(2.2, 7.5, 'rounded', 30),
          wp(2.6, 12.0, 'rounded', 46),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'zone-right', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      WR3: route(stalk()),
      ...olRun('zone-right', ['backside', 'playside-gap', 'playside-gap', 'playside-gap', 'climb']),
    },
  },
  {
    id: 'single-outside-zone',
    name: 'Outside Zone Stretch',
    formationId: 'singleback',
    type: 'run',
    tags: ['run-outside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      RB: {
        kind: 'carry', mesh: 'handoff', meshTick: 28, aimGap: 'C-right',
        path: [
          wp(3.5, 2.5, 'rounded', 18),
          wp(7.0, 6.0, 'rounded', 34),
          wp(8.0, 11.0, 'rounded', 52),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'zone-right', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      WR3: route(stalk()),
      ...olRun('zone-right', ['backside', 'climb', 'playside-gap', 'playside-gap', 'playside-gap']),
    },
  },
  {
    id: 'single-hb-counter',
    name: 'HB Counter',
    formationId: 'singleback',
    type: 'run',
    tags: ['run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 1 } },
      RB: {
        // Counter step to the right, then cut back behind the pulling guard.
        kind: 'carry', mesh: 'handoff', meshTick: 28, aimGap: 'B-left',
        path: [
          wp(2.0, 1.2, 'sharp', 14),
          wp(-1.5, 4.5, 'rounded', 28),
          wp(-3.5, 9.0, 'rounded', 44),
          wp(-4.0, 13.0, 'rounded', 58),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'backside' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      WR3: route(stalk()),
      ...olRun('gap', ['playside-gap', 'playside-gap', 'playside-gap', 'pull-lead', 'backside']),
    },
  },
  {
    id: 'gun-inside-zone',
    name: 'Gun Inside Zone',
    formationId: 'gun-2x2',
    type: 'run',
    tags: ['run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: {
        kind: 'carry', mesh: 'handoff', meshTick: 24, aimGap: 'A-left',
        path: [
          wp(-2.5, 1.2, 'rounded', 14),
          wp(-2.0, 5.0, 'rounded', 28),
          wp(-1.5, 10.0, 'rounded', 44),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'zone-left', target: 'playside-gap' },
      WR1: route(stalk()),
      WR2: route(stalk()),
      WR3: route(stalk()),
      ...olRun('zone-left', ['playside-gap', 'playside-gap', 'playside-gap', 'backside', 'climb']),
    },
  },
  {
    id: 'gun-hb-draw',
    name: 'Gun HB Draw',
    formationId: 'gun-2x2',
    type: 'run',
    tags: ['draw', 'run-inside'],
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: {
        // Late mesh: the back sells protection before taking the ball.
        kind: 'carry', mesh: 'handoff', meshTick: 32, aimGap: 'B-left',
        path: [
          wp(-1.5, -0.5, 'rounded', 18),
          wp(-2.5, 3.5, 'rounded', 34),
          wp(-3.5, 9.0, 'rounded', 50),
        ],
      },
      TE1: { kind: 'runBlock', scheme: 'zone-left', target: 'climb' },
      WR1: route(clearout()),
      WR2: route(clearout()),
      WR3: route(clearout()),
      ...olRun('zone-left', ['playside-gap', 'playside-gap', 'playside-gap', 'backside', 'climb']),
    },
  },
  {
    id: 'gl-qb-sneak',
    name: 'QB Sneak',
    formationId: 'goal-line',
    type: 'run',
    tags: ['run-inside', 'goal-line'],
    // The sneak has no handoff: the QB's 'sneak' drop IS the carry.
    assignments: {
      QB: { kind: 'qb', drop: { type: 'sneak', depth: 0 } },
      FB: { kind: 'leadBlock', throughGap: 'A-right' },
      RB: { kind: 'leadBlock', throughGap: 'A-left' },
      TE1: { kind: 'runBlock', scheme: 'gap', target: 'playside-gap' },
      TE2: { kind: 'runBlock', scheme: 'gap', target: 'playside-gap' },
      WR1: route(stalk()),
      ...olRun('gap', ['playside-gap', 'playside-gap', 'playside-gap', 'playside-gap', 'playside-gap']),
    },
  },

  // =========================================================================
  // QUICK GAME (7)
  // =========================================================================
  {
    id: 'gun-slants',
    name: 'Gun Slants',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['WR2', 'WR1', 'WR3'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(slant(1)),
      WR2: primaryRoute(slant(1)),
      WR3: route(slant(-1)),
      TE1: route(slant(-1)),
      ...olPass(),
    },
  },
  {
    id: 'single-double-hitches',
    name: 'Double Hitches',
    formationId: 'singleback',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['WR1', 'WR3', 'TE1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '3step', depth: 4 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: primaryRoute(hitch(6)),
      WR2: route(slant(1)),
      WR3: route(hitch(6)),
      TE1: route(stick(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-quick-outs',
    name: 'Quick Outs',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['WR3', 'WR1', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(quickOut(-1)),
      WR2: route(slant(1)),
      WR3: primaryRoute(quickOut(1)),
      TE1: route(quickOut(1)),
      ...olPass(),
    },
  },
  {
    id: 'trips-gun-stick',
    name: 'Gun Stick',
    formationId: 'gun-trips-right',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['WR3', 'TE1', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(slant(1)),
      WR2: route(comeback(1, 14)),
      WR3: primaryRoute(stick(1)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-spacing',
    name: 'Gun Spacing',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['TE1', 'WR2', 'WR3'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: route(swing(1)),
      WR1: route(hitch(5)),
      WR2: route(spacingSit(1, 3, 6)),
      WR3: route(hitch(5)),
      TE1: primaryRoute(spacingSit(-1, 3, 5.5)),
      ...olPass(),
    },
  },
  {
    id: 'empty-quick-flood',
    name: 'Empty Quick Flood',
    formationId: 'gun-empty',
    type: 'pass',
    tags: ['quick'],
    qbProgression: ['TE1', 'WR3', 'WR4'],
    checkdown: 'WR1',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      WR1: route(hitch(6)),
      WR2: route(dig(1, 12)),
      WR3: route(shallowCross(1)),
      TE1: primaryRoute(quickOut(1)),
      WR4: route(go(0)),
      ...olPass(),
    },
  },
  {
    id: 'gl-fade',
    name: 'Goal Line Fade',
    formationId: 'goal-line',
    type: 'pass',
    tags: ['quick', 'goal-line'],
    qbProgression: ['WR1', 'TE2', 'TE1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '3step', depth: 4 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      TE1: route(flatRoute(-1)),
      TE2: route(corner(1, 6)),
      WR1: primaryRoute(fade(1)),
      ...olPass(),
    },
  },

  // =========================================================================
  // MEDIUM (8)
  // =========================================================================
  {
    id: 'single-curl-flat',
    name: 'Curl-Flat',
    formationId: 'singleback',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR3', 'TE1', 'WR1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(curl(1, 12)),
      WR2: route(flatRoute(-1)),
      WR3: primaryRoute(curl(-1, 12)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-mesh',
    name: 'Gun Mesh',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR2', 'TE1', 'WR1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      // The two crossers rub at 4.5/5.5 yards — same mesh point, split depth.
      RB: route(swing(1)),
      WR1: route(dig(1, 12)),
      WR2: primaryRoute(shallowCross(1, 4.5)),
      WR3: route(go(0)),
      TE1: route(shallowCross(-1, 5.5)),
      ...olPass(),
    },
  },
  {
    id: 'single-levels',
    name: 'Levels',
    formationId: 'singleback',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR2', 'WR1', 'TE1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(dig(1, 12)),
      WR2: primaryRoute(shallowCross(1, 5)),
      WR3: route(go(0)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-smash',
    name: 'Smash',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['TE1', 'WR3', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(hitch(6)),
      WR2: route(corner(-1, 11)),
      WR3: route(hitch(6)),
      TE1: primaryRoute(corner(1, 11)),
      ...olPass(),
    },
  },
  {
    id: 'trips-sail',
    name: 'Trips Sail',
    formationId: 'gun-trips-right',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR3', 'TE1', 'WR1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(dig(1, 13)),
      WR2: route(go(0)),
      WR3: primaryRoute(sail(1, 12)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-drive',
    name: 'Drive',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR2', 'WR1', 'TE1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(dig(1, 12)),
      WR2: primaryRoute(shallowCross(1, 5)),
      WR3: route(go(0)),
      TE1: route(curl(-1, 10)),
      ...olPass(),
    },
  },
  {
    id: 'single-y-cross',
    name: 'Y-Cross',
    formationId: 'singleback',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['TE1', 'WR3', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(post(1, 13)),
      WR2: route(flatRoute(-1)),
      WR3: route(comeback(-1, 15)),
      TE1: primaryRoute(deepCross(-1, 9)),
      ...olPass(),
    },
  },
  {
    id: 'empty-digs',
    name: 'Empty Digs',
    formationId: 'gun-empty',
    type: 'pass',
    tags: ['medium'],
    qbProgression: ['WR1', 'WR4', 'WR3'],
    checkdown: 'TE1',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      WR1: primaryRoute(dig(1, 13)),
      WR2: route(go(-1.5)),
      WR3: route(shallowCross(1)),
      TE1: route(stick(-1)),
      WR4: route(dig(-1, 13)),
      ...olPass(),
    },
  },

  // =========================================================================
  // DEEP (5)
  // =========================================================================
  {
    id: 'gun-four-verticals',
    name: 'Four Verticals',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['deep'],
    qbProgression: ['WR2', 'TE1', 'WR3', 'WR1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(go(0)),
      WR2: primaryRoute(go(-1.5)),
      WR3: route(go(0)),
      TE1: route(go(1.5)),
      ...olPass(),
    },
  },
  {
    id: 'trips-verts-switch',
    name: 'Trips Verts Switch',
    formationId: 'gun-trips-right',
    type: 'pass',
    tags: ['deep'],
    qbProgression: ['WR3', 'TE1', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(post(1, 14)),
      WR2: route(go(-2)),
      WR3: primaryRoute(switchVert(1)),
      TE1: route(go(0)),
      ...olPass(),
    },
  },
  {
    id: 'pa-deep-post',
    name: 'PA Deep Post',
    formationId: 'i-form',
    type: 'playAction',
    tags: ['deep', 'play-action'],
    playAction: { fakeTo: 'RB', fakeTicks: 22 },
    qbProgression: ['WR1', 'TE1', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      TE1: route(go(1.5)),
      WR1: primaryRoute(post(1, 14)),
      WR2: route(comeback(-1, 16)),
      ...olPass(),
    },
  },
  {
    id: 'pa-deep-cross-max',
    name: 'PA Deep Cross',
    formationId: 'i-form',
    type: 'playAction',
    tags: ['deep', 'play-action'],
    playAction: { fakeTo: 'RB', fakeTicks: 24 },
    // Max protect: seven in, two out.
    qbProgression: ['WR1', 'WR2'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 8 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' },
      WR1: primaryRoute(deepCross(1, 10)),
      WR2: route(post(-1, 14)),
      ...olPass(),
    },
  },
  {
    id: 'gun-sluggo-shot',
    name: 'Sluggo Shot',
    formationId: 'gun-2x2',
    type: 'pass',
    tags: ['deep'],
    qbProgression: ['WR1', 'WR3', 'WR2'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: primaryRoute(sluggo(1)),
      WR2: route(dig(1, 12)),
      WR3: route(comeback(-1, 15)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },

  // =========================================================================
  // PLAY-ACTION BOOTS (3)
  // =========================================================================
  {
    id: 'pa-boot-right',
    name: 'PA Boot Right',
    formationId: 'singleback',
    type: 'playAction',
    tags: ['play-action', 'medium'],
    playAction: { fakeTo: 'RB', fakeTicks: 20 },
    qbProgression: ['TE1', 'WR2', 'WR3'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'bootRight', depth: 6 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      WR1: route(post(1, 14)),
      WR2: primaryRoute(deepCross(1, 8)),
      WR3: route(comeback(-1, 14)),
      TE1: route(flatRoute(1)),
      ...olPass(),
    },
  },
  {
    id: 'pa-fb-leak',
    name: 'PA FB Leak',
    formationId: 'i-form',
    type: 'playAction',
    tags: ['play-action', 'medium'],
    playAction: { fakeTo: 'RB', fakeTicks: 24 },
    qbProgression: ['FB', 'TE1', 'WR1'],
    checkdown: 'WR2',
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      FB: primaryRoute(leak(1)),
      RB: { kind: 'passProScan' },
      TE1: route(go(1.5)),
      WR1: route(post(1, 14)),
      WR2: route(comeback(-1, 15)),
      ...olPass(),
    },
  },
  {
    id: 'pa-toss-shot',
    name: 'PA Toss Shot',
    formationId: 'i-form',
    type: 'playAction',
    tags: ['deep', 'play-action'],
    playAction: { fakeTo: 'RB', fakeTicks: 26 },
    qbProgression: ['WR2', 'TE1', 'WR1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'bootRight', depth: 7 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      TE1: route(corner(1, 10)),
      WR1: route(deepCross(1, 10)),
      WR2: primaryRoute(go(-1.5)),
      ...olPass(),
    },
  },

  // =========================================================================
  // SCREENS (3) — releasing linemen use pull-lead; the screen route's first
  // waypoint is late on purpose (sell the protection, then leak).
  // =========================================================================
  {
    id: 'gun-hb-slip-screen',
    name: 'HB Slip Screen',
    formationId: 'gun-2x2',
    type: 'screen',
    tags: ['screen'],
    screenTo: 'RB',
    qbProgression: ['RB', 'WR1'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '5step', depth: 7 } },
      RB: primaryRoute(slipScreen(-1)),
      WR1: route(clearout()),
      WR2: route(clearout()),
      WR3: route(clearout()),
      TE1: route(clearout()),
      LT: { kind: 'runBlock', scheme: 'gap', target: 'pull-lead' },
      LG: { kind: 'runBlock', scheme: 'gap', target: 'pull-lead' },
      C: { kind: 'runBlock', scheme: 'gap', target: 'pull-lead' },
      RG: { kind: 'passBlock' },
      RT: { kind: 'passBlock' },
    },
  },
  {
    id: 'trips-wr-bubble',
    name: 'WR Bubble',
    formationId: 'gun-trips-right',
    type: 'screen',
    tags: ['screen', 'quick'],
    screenTo: 'WR3',
    qbProgression: ['WR3', 'WR1'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '1step', depth: 5 } },
      RB: { kind: 'passProScan' },
      WR1: route(slant(1)),
      WR2: route(screenBlock(1)),
      WR3: primaryRoute(bubble(1)),
      TE1: route(screenBlock(1)),
      ...olPass(),
    },
  },
  {
    id: 'gun-wr-tunnel',
    name: 'WR Tunnel',
    formationId: 'gun-2x2',
    type: 'screen',
    tags: ['screen'],
    screenTo: 'WR1',
    qbProgression: ['WR1', 'WR3'],
    assignments: {
      QB: { kind: 'qb', drop: { type: '3step', depth: 5 } },
      RB: { kind: 'passProScan' },
      WR1: primaryRoute(tunnel(1)),
      WR2: route(screenBlock(-1)),
      WR3: route(clearout()),
      TE1: route(clearout()),
      LT: { kind: 'runBlock', scheme: 'gap', target: 'pull-lead' },
      LG: { kind: 'runBlock', scheme: 'gap', target: 'pull-lead' },
      C: { kind: 'passBlock' },
      RG: { kind: 'passBlock' },
      RT: { kind: 'passBlock' },
    },
  },

  // =========================================================================
  // SPECIAL TEAMS + CLOCK PLAYS
  // =========================================================================
  {
    id: 'kickoff-deep',
    name: 'Kickoff',
    formationId: 'st-kickoff',
    type: 'kickoff',
    tags: [],
    assignments: {
      K: { kind: 'kick', style: 'kickoff' },
      WR1: { kind: 'coverLane', laneIndex: 0, contain: true },
      WR2: { kind: 'coverLane', laneIndex: 1 },
      WR3: { kind: 'coverLane', laneIndex: 2 },
      TE1: { kind: 'coverLane', laneIndex: 3 },
      RB: { kind: 'coverLane', laneIndex: 4 },
      FB: { kind: 'coverLane', laneIndex: 5 },
      TE2: { kind: 'coverLane', laneIndex: 6 },
      WR4: { kind: 'coverLane', laneIndex: 7 },
      WR5: { kind: 'coverLane', laneIndex: 8 },
      QB: { kind: 'coverLane', laneIndex: 9, contain: true },
    },
  },
  {
    id: 'punt-deep',
    name: 'Punt',
    formationId: 'st-punt',
    type: 'punt',
    tags: [],
    assignments: {
      P: { kind: 'kick', style: 'punt' },
      FB: { kind: 'passBlock' },
      LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' },
      RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' }, TE2: { kind: 'passBlock' },
      WR1: { kind: 'coverLane', laneIndex: 0, contain: true },
      WR2: { kind: 'coverLane', laneIndex: 9, contain: true },
    },
  },
  {
    id: 'fg-attempt',
    name: 'Field Goal',
    formationId: 'st-field-goal',
    type: 'fieldGoal',
    tags: [],
    assignments: {
      K: { kind: 'kick', style: 'placekick' },
      H: { kind: 'hold' },
      LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' },
      RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' }, TE2: { kind: 'passBlock' },
      WR1: { kind: 'passBlock' }, WR2: { kind: 'passBlock' },
    },
  },
  {
    id: 'xp-attempt',
    name: 'Extra Point',
    formationId: 'st-field-goal',
    type: 'extraPoint',
    tags: [],
    assignments: {
      K: { kind: 'kick', style: 'placekick' },
      H: { kind: 'hold' },
      LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' },
      RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' }, TE2: { kind: 'passBlock' },
      WR1: { kind: 'passBlock' }, WR2: { kind: 'passBlock' },
    },
  },
  {
    id: 'two-point-slants',
    name: 'Two-Point Slants',
    formationId: 'gun-2x2',
    type: 'twoPoint',
    tags: ['quick', 'goal-line'],
    qbProgression: ['WR2', 'WR1', 'WR3'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
      RB: { kind: 'passProScan', checkRoute: checkFlat(1) },
      WR1: route(slant(1)),
      WR2: primaryRoute(slant(1)),
      WR3: route(slant(-1)),
      TE1: route(slant(-1)),
      ...olPass(),
    },
  },
  {
    id: 'two-point-fade',
    name: 'Two-Point Fade',
    formationId: 'goal-line',
    type: 'twoPoint',
    tags: ['quick', 'goal-line'],
    qbProgression: ['WR1', 'TE2', 'TE1'],
    checkdown: 'RB',
    assignments: {
      QB: { kind: 'qb', drop: { type: '3step', depth: 4 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passProScan', checkRoute: checkFlat(-1) },
      TE1: route(flatRoute(-1)),
      TE2: route(corner(1, 6)),
      WR1: primaryRoute(fade(1)),
      ...olPass(),
    },
  },
  {
    id: 'qb-kneel',
    name: 'QB Kneel',
    formationId: 'i-form',
    type: 'kneel',
    tags: ['clock-kill'],
    assignments: {
      QB: { kind: 'qb', drop: { type: 'kneel', depth: 2 } },
      FB: { kind: 'passBlock' },
      RB: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' },
      WR1: { kind: 'passBlock' },
      WR2: { kind: 'passBlock' },
      ...olPass(),
    },
  },
  {
    id: 'qb-spike',
    name: 'Spike',
    formationId: 'singleback',
    type: 'spike',
    tags: ['clock-save'],
    assignments: {
      QB: { kind: 'qb', drop: { type: 'spike', depth: 0 } },
      RB: { kind: 'passBlock' },
      TE1: { kind: 'passBlock' },
      WR1: { kind: 'passBlock' },
      WR2: { kind: 'passBlock' },
      WR3: { kind: 'passBlock' },
      ...olPass(),
    },
  },
];

/** Play ids in fixed order — for deterministic iteration by callers. */
export const OFFENSIVE_PLAY_IDS: readonly string[] = OFFENSIVE_PLAYS.map((p) => p.id);
