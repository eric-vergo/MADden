import { describe, expect, it } from 'vitest';
import { FORMATIONS } from '../../src/data/plays/formations';
import { OFFENSIVE_PLAYS } from '../../src/data/plays/offense';
import type { OffensivePlayDef } from '../../src/sim/types';
import { buildPlayDiagram } from '../../src/ui/routeDiagram';

const W = 120;
const H = 96;

function play(id: string): OffensivePlayDef {
  const found = OFFENSIVE_PLAYS.find((p) => p.id === id);
  if (!found) throw new Error(`missing fixture play ${id}`);
  return found;
}

function formationFor(p: OffensivePlayDef) {
  return FORMATIONS.find((f) => f.id === p.formationId);
}

describe('buildPlayDiagram', () => {
  it('places one mark per assigned role that the formation aligns', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    expect(diagram.dots).toHaveLength(11);
    expect(new Set(diagram.dots.map((d) => d.role)).size).toBe(11);
  });

  it('keeps every mark and path point inside the canvas', () => {
    for (const p of OFFENSIVE_PLAYS) {
      const diagram = buildPlayDiagram(p, formationFor(p), W, H);
      for (const dot of diagram.dots) {
        expect(dot.x).toBeGreaterThanOrEqual(0);
        expect(dot.x).toBeLessThanOrEqual(W);
        expect(dot.y).toBeGreaterThanOrEqual(0);
        expect(dot.y).toBeLessThanOrEqual(H);
      }
      for (const path of diagram.paths) {
        for (const pt of path.points) {
          expect(pt.x).toBeGreaterThanOrEqual(0);
          expect(pt.x).toBeLessThanOrEqual(W);
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(H);
        }
      }
    }
  });

  it('marks linemen with X and skill players with O', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    const byRole = new Map(diagram.dots.map((d) => [d.role, d]));
    expect(byRole.get('C')?.glyph).toBe('X');
    expect(byRole.get('LT')?.glyph).toBe('X');
    expect(byRole.get('WR1')?.glyph).toBe('O');
    expect(byRole.get('QB')?.kind).toBe('qb');
  });

  it('draws routes upfield with an arrowhead', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    const wr1 = diagram.paths.find((path) => path.role === 'WR1');
    expect(wr1?.style).toBe('route');
    expect(wr1?.head).toBe('arrow');
    // Offense drives +y, which is UP the canvas: the route must end above its start.
    const first = wr1?.points[0];
    const last = wr1?.points[(wr1?.points.length ?? 1) - 1];
    expect(last && first && last.y).toBeLessThan(first?.y ?? 0);
    expect(wr1?.points).toHaveLength(3); // alignment + two waypoints
  });

  it('gives blockers short stubs with a T-bar', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    const lt = diagram.paths.find((path) => path.role === 'LT');
    expect(lt?.style).toBe('block');
    expect(lt?.head).toBe('tbar');
    expect(lt?.points).toHaveLength(2);
  });

  it('draws the ball carrier path as a run arrow', () => {
    const p = play('gun-inside-zone');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    const run = diagram.paths.filter((path) => path.style === 'run');
    expect(run.length).toBeGreaterThanOrEqual(1);
    expect(run[0]?.head).toBe('arrow');
    // Blocking receivers on a run play read as blocks, not routes.
    expect(diagram.paths.find((path) => path.role === 'WR1')?.style).toBe('block');
  });

  it('dashes the RB check-release on a drop-back pass', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    const rbPaths = diagram.paths.filter((path) => path.role === 'RB');
    expect(rbPaths).toHaveLength(2);
    expect(rbPaths.some((path) => path.dashed)).toBe(true);
  });

  it('puts the line of scrimmage inside the canvas and centres the ball', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    expect(diagram.losY).toBeGreaterThan(0);
    expect(diagram.losY).toBeLessThan(H);
    expect(diagram.ballX).toBeCloseTo(W / 2);
  });

  it('survives a missing formation without throwing', () => {
    const p = play('gun-slants');
    const diagram = buildPlayDiagram(p, undefined, W, H);
    expect(diagram.dots).toHaveLength(0);
    expect(diagram.paths).toHaveLength(0);
  });

  it('handles special-teams plays with coverage lanes', () => {
    const p = play('kickoff-deep');
    const diagram = buildPlayDiagram(p, formationFor(p), W, H);
    expect(diagram.dots.length).toBeGreaterThan(5);
    expect(diagram.paths.some((path) => path.style === 'run')).toBe(true);
  });
});
