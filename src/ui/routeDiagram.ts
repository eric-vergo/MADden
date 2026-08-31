// Procedural mini play diagrams drawn FROM the play data (no art assets).
// buildPlayDiagram is pure geometry (unit tested); drawPlayDiagram paints it
// onto a small canvas inside a play card.

import type {
  FormationDef, OffAssignment, DefAssignment, OffensivePlayDef, RoleId, RouteWaypoint, Vec2,
} from '../sim/types';

export type MarkKind = 'skill' | 'line' | 'qb' | 'back' | 'kicker';
export type PathStyle = 'route' | 'run' | 'block' | 'motion';

export interface DiagramDot {
  role: RoleId;
  x: number;
  y: number;
  kind: MarkKind;
  /** 'O' = circle mark, 'X' = cross mark. */
  glyph: 'O' | 'X';
}

export interface DiagramPath {
  role: RoleId;
  points: Vec2[];
  style: PathStyle;
  /** Arrowhead at the last point (routes and runs) vs a T-bar (blocks). */
  head: 'arrow' | 'tbar' | 'none';
  dashed: boolean;
}

export interface PlayDiagram {
  width: number;
  height: number;
  /** Canvas y of the line of scrimmage. */
  losY: number;
  ballX: number;
  dots: DiagramDot[];
  paths: DiagramPath[];
}

export interface DiagramOptions {
  padding?: number;
  /** Fraction of the height the line of scrimmage sits at (0 = top). */
  losFraction?: number;
}

// TODO(balance): purely cosmetic diagram framing constants.
const DEFAULT_PADDING = 4;
const DEFAULT_LOS_FRACTION = 0.62;
const MIN_X_SPAN = 26; // yards — keeps tight formations from ballooning
const MIN_Y_SPAN = 16;
const BLOCK_STUB_YD = 1.6;

const LINE_ROLES: ReadonlySet<string> = new Set(['LT', 'LG', 'C', 'RG', 'RT']);

function markKind(role: RoleId): MarkKind {
  if (LINE_ROLES.has(role)) return 'line';
  if (role === 'QB') return 'qb';
  if (role === 'RB' || role === 'FB') return 'back';
  if (role === 'K' || role === 'P' || role === 'H') return 'kicker';
  return 'skill';
}

function waypointPoints(align: Vec2, waypoints: readonly RouteWaypoint[]): Vec2[] {
  // Waypoints are offsets from the ALIGNMENT spot, not cumulative deltas.
  const pts: Vec2[] = [{ x: align.x, y: align.y }];
  for (const w of waypoints) pts.push({ x: align.x + w.dx, y: align.y + w.dy });
  return pts;
}

interface RawPath {
  role: RoleId;
  pts: Vec2[];
  style: PathStyle;
  head: 'arrow' | 'tbar' | 'none';
  dashed: boolean;
}

function assignmentPaths(
  role: RoleId,
  align: Vec2,
  a: OffAssignment | DefAssignment,
): RawPath[] {
  switch (a.kind) {
    case 'route': {
      const pts = waypointPoints(align, a.route.waypoints);
      const last = a.route.waypoints[a.route.waypoints.length - 1];
      const blocking = last?.thenAction === 'blockNearest';
      return [{ role, pts, style: blocking ? 'block' : 'route', head: blocking ? 'tbar' : 'arrow', dashed: false }];
    }
    case 'passProScan': {
      if (!a.checkRoute) return [stub(role, align, 'block')];
      return [
        stub(role, align, 'block'),
        { role, pts: waypointPoints(align, a.checkRoute.waypoints), style: 'route', head: 'arrow', dashed: true },
      ];
    }
    case 'carry': {
      const pts = waypointPoints(align, a.path);
      // Extend the last leg through the line so the run reads as an attack.
      const tail = pts[pts.length - 1] ?? align;
      pts.push({ x: tail.x, y: tail.y + 3.5 });
      return [{ role, pts, style: 'run', head: 'arrow', dashed: false }];
    }
    case 'runBlock':
    case 'passBlock':
      return [stub(role, align, 'block')];
    case 'leadBlock':
      return [{ role, pts: [align, { x: align.x, y: align.y + 3 }], style: 'block', head: 'tbar', dashed: false }];
    case 'qb': {
      const depth = a.drop.depth;
      if (a.drop.type === 'sneak' || a.drop.type === 'spike' || a.drop.type === 'kneel') {
        return [{ role, pts: [align, { x: align.x, y: align.y + 1.2 }], style: 'run', head: 'arrow', dashed: false }];
      }
      if (a.drop.type === 'gunSet') return [];
      const dx = a.drop.type === 'bootLeft' ? -4 : a.drop.type === 'bootRight' ? 4 : 0;
      return [{
        role,
        pts: [align, { x: align.x + dx, y: align.y - Math.max(0, depth - Math.abs(align.y)) - 0.5 }],
        style: 'motion', head: 'arrow', dashed: true,
      }];
    }
    case 'kick':
      return [{ role, pts: [align, { x: align.x, y: align.y + 4 }], style: 'motion', head: 'arrow', dashed: true }];
    case 'coverLane':
      return [{ role, pts: [align, { x: align.x, y: align.y + 5 }], style: 'run', head: 'arrow', dashed: false }];
    default:
      return [];
  }
}

function stub(role: RoleId, align: Vec2, style: PathStyle): RawPath {
  return {
    role,
    pts: [align, { x: align.x, y: align.y + BLOCK_STUB_YD }],
    style,
    head: 'tbar',
    dashed: false,
  };
}

/**
 * Project a play + its formation into canvas space. Roles without an alignment
 * in the formation are skipped (starter formations do not field every role).
 */
export function buildPlayDiagram(
  play: OffensivePlayDef,
  formation: FormationDef | undefined,
  width: number,
  height: number,
  opts: DiagramOptions = {},
): PlayDiagram {
  const pad = opts.padding ?? DEFAULT_PADDING;
  const losFrac = opts.losFraction ?? DEFAULT_LOS_FRACTION;
  const alignments = formation?.alignments ?? {};

  const roles = (Object.keys(play.assignments) as RoleId[]).sort();
  const rawDots: Array<{ role: RoleId; p: Vec2 }> = [];
  const rawPaths: RawPath[] = [];

  for (const role of roles) {
    const align = alignments[role];
    const assignment = play.assignments[role];
    if (!align || !assignment) continue;
    rawDots.push({ role, p: align });
    for (const path of assignmentPaths(role, align, assignment)) rawPaths.push(path);
  }

  // World bounds over every point we intend to draw.
  let minX = 0; let maxX = 0; let minY = 0; let maxY = 0;
  const visit = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };
  for (const d of rawDots) visit(d.p);
  for (const path of rawPaths) for (const p of path.pts) visit(p);

  const halfX = Math.max(MIN_X_SPAN / 2, Math.abs(minX), Math.abs(maxX));
  const spanY = Math.max(MIN_Y_SPAN, maxY - minY);
  const usableW = Math.max(1, width - pad * 2);
  const usableH = Math.max(1, height - pad * 2);
  const sx = usableW / (halfX * 2);
  const sy = usableH / spanY;
  const losY = pad + usableH * losFrac;
  const cx = width / 2;

  const toCanvas = (p: Vec2): Vec2 => ({
    x: clamp(cx + p.x * sx, pad, width - pad),
    y: clamp(losY - p.y * sy, pad, height - pad),
  });

  return {
    width,
    height,
    losY,
    ballX: cx,
    dots: rawDots.map(({ role, p }) => {
      const c = toCanvas(p);
      const kind = markKind(role);
      return { role, x: c.x, y: c.y, kind, glyph: kind === 'line' ? 'X' : 'O' };
    }),
    paths: rawPaths.map((path) => ({
      role: path.role,
      points: path.pts.map(toCanvas),
      style: path.style,
      head: path.head,
      dashed: path.dashed,
    })),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Canvas painting
// ---------------------------------------------------------------------------

export interface DiagramPaint {
  background: string;
  losColor: string;
  playerColor: string;
  routeColor: string;
  runColor: string;
  blockColor: string;
}

export const DEFAULT_PAINT: DiagramPaint = {
  background: 'transparent',
  losColor: 'rgba(220,228,240,0.35)',
  playerColor: '#e6edf6',
  routeColor: '#8fd0ff',
  runColor: '#ffd45e',
  blockColor: 'rgba(190,200,214,0.55)',
};

export function drawPlayDiagram(
  ctx: CanvasRenderingContext2D,
  diagram: PlayDiagram,
  paint: DiagramPaint = DEFAULT_PAINT,
): void {
  const { width, height } = diagram;
  ctx.clearRect(0, 0, width, height);
  if (paint.background !== 'transparent') {
    ctx.fillStyle = paint.background;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = paint.losColor;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(1, diagram.losY);
  ctx.lineTo(width - 1, diagram.losY);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const path of diagram.paths) {
    if (path.points.length < 2) continue;
    ctx.strokeStyle =
      path.style === 'run' ? paint.runColor
        : path.style === 'block' ? paint.blockColor
          : paint.routeColor;
    ctx.lineWidth = path.style === 'run' ? 1.8 : 1.2;
    ctx.setLineDash(path.dashed ? [2, 2] : []);
    ctx.beginPath();
    const first = path.points[0];
    if (!first) continue;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const end = path.points[path.points.length - 1];
    const prev = path.points[path.points.length - 2];
    if (!end || !prev) continue;
    if (path.head === 'arrow') drawArrowHead(ctx, prev, end, path.style === 'run' ? 4.5 : 3.5);
    else if (path.head === 'tbar') drawTBar(ctx, prev, end, 3);
  }

  for (const dot of diagram.dots) {
    ctx.strokeStyle = paint.playerColor;
    ctx.fillStyle = paint.playerColor;
    ctx.lineWidth = 1.2;
    if (dot.glyph === 'X') {
      const r = 2.2;
      ctx.beginPath();
      ctx.moveTo(dot.x - r, dot.y - r); ctx.lineTo(dot.x + r, dot.y + r);
      ctx.moveTo(dot.x + r, dot.y - r); ctx.lineTo(dot.x - r, dot.y + r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.kind === 'qb' ? 2.8 : 2.3, 0, Math.PI * 2);
      if (dot.kind === 'qb' || dot.kind === 'back') ctx.fill();
      else ctx.stroke();
    }
  }
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, size: number): void {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = 0.42;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang - spread), to.y - size * Math.sin(ang - spread));
  ctx.lineTo(to.x - size * Math.cos(ang + spread), to.y - size * Math.sin(ang + spread));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawTBar(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, half: number): void {
  const ang = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(to.x - half * Math.cos(ang), to.y - half * Math.sin(ang));
  ctx.lineTo(to.x + half * Math.cos(ang), to.y + half * Math.sin(ang));
  ctx.stroke();
}
