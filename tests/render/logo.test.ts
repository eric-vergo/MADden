import { describe, expect, it } from 'vitest';
import type { LogoSpec } from '../../src/meta/types';
import { LogoCache, createLogoCanvas, drawLogo, drawLogoBadge } from '../../src/render/logo';
import { RecordingCtx } from './mockCtx';

const FRAMES: LogoSpec['frame'][] = ['shield', 'circle', 'hexagon', 'diamond', 'roundel'];
const MOTIFS: LogoSpec['motif'][] = [
  'bolt', 'star', 'chevron', 'wing', 'fang', 'claw',
  'peak', 'orbit', 'crest-stripes', 'initial', 'shield-in-shield',
];

function spec(over: Partial<LogoSpec> = {}): LogoSpec {
  return {
    frame: 'shield',
    motif: 'bolt',
    motifCount: 1,
    rotationDeg: 0,
    frameColor: '#1B3A6B',
    motifColor: '#E8B93E',
    accentColor: '#FFFFFF',
    ...over,
  };
}

function render(s: LogoSpec, letter = 'A'): string[] {
  const ctx = new RecordingCtx();
  drawLogo(ctx, s, 64, 32, 32, { letter });
  return ctx.log;
}

describe('logo determinism', () => {
  it('same spec produces an identical command log', () => {
    const s = spec({ frame: 'hexagon', motif: 'wing', motifCount: 2, rotationDeg: 15 });
    expect(render(s)).toEqual(render(s));
  });

  it('a separately constructed but equal spec matches', () => {
    const a = spec({ motif: 'orbit', motifCount: 3, rotationDeg: -20 });
    const b = spec({ motif: 'orbit', motifCount: 3, rotationDeg: -20 });
    expect(render(a)).toEqual(render(b));
  });

  it('every frame x motif pair draws and stays balanced', () => {
    for (const frame of FRAMES) {
      for (const motif of MOTIFS) {
        const log = render(spec({ frame, motif }));
        expect(log.length, `${frame}/${motif}`).toBeGreaterThan(6);
        const ctx = new RecordingCtx();
        drawLogo(ctx, spec({ frame, motif }), 64, 32, 32, { letter: 'A' });
        const saves = ctx.count('save');
        const restores = ctx.count('restore');
        expect(saves, `${frame}/${motif} save/restore`).toBe(restores);
      }
    }
  });

  it('is scale-invariant apart from the outer transform', () => {
    const s = spec({ motif: 'star' });
    const small = new RecordingCtx();
    const big = new RecordingCtx();
    drawLogo(small, s, 64, 0, 0);
    drawLogo(big, s, 128, 0, 0);
    expect(small.log.filter((l) => !l.startsWith('scale'))).toEqual(
      big.log.filter((l) => !l.startsWith('scale')),
    );
    expect(small.log).toContain('scale(1,1)');
    expect(big.log).toContain('scale(2,2)');
  });
});

describe('logo spec sensitivity', () => {
  const base = spec();

  it('reacts to every spec field', () => {
    const variants: LogoSpec[] = [
      spec({ frame: 'circle' }),
      spec({ motif: 'claw' }),
      spec({ motifCount: 2 }),
      spec({ rotationDeg: 30 }),
      spec({ frameColor: '#123456' }),
      spec({ motifColor: '#654321' }),
      spec({ accentColor: '#00FF00' }),
    ];
    const baseline = render(base).join('\n');
    for (const v of variants) {
      expect(render(v).join('\n'), JSON.stringify(v)).not.toEqual(baseline);
    }
  });

  it('repeats the motif motifCount times', () => {
    const one = new RecordingCtx();
    const three = new RecordingCtx();
    drawLogo(one, spec({ motif: 'star', motifCount: 1 }), 64, 0, 0);
    drawLogo(three, spec({ motif: 'star', motifCount: 3 }), 64, 0, 0);
    // The star body is one closePath per repeat.
    expect(three.count('closePath')).toBe(one.count('closePath') + 2);
  });

  it('uses the supplied letter for the initial motif', () => {
    const ctx = new RecordingCtx();
    drawLogo(ctx, spec({ motif: 'initial' }), 64, 0, 0, { letter: 'grandview' });
    expect(ctx.log.some((l) => l.startsWith('fillText(G,'))).toBe(true);
  });

  it('falls back to a default letter when none is given', () => {
    const ctx = new RecordingCtx();
    drawLogo(ctx, spec({ motif: 'initial' }), 64, 0, 0);
    expect(ctx.log.some((l) => l.startsWith('fillText('))).toBe(true);
  });

  it('rotates the motif group only, not the frame', () => {
    const rotated = render(spec({ rotationDeg: 45 }))
      .filter((l) => l.startsWith('rotate('))
      .map((l) => Number(l.slice('rotate('.length, -1)));
    expect(rotated.some((v) => Math.abs(v - Math.PI / 4) < 1e-4)).toBe(true);
    const unrotated = render(spec({ rotationDeg: 0 }))
      .filter((l) => l.startsWith('rotate('))
      .map((l) => Number(l.slice('rotate('.length, -1)));
    expect(unrotated.every((v) => v === 0)).toBe(true);
  });

  it('draws a base disc under a badge', () => {
    const plain = new RecordingCtx();
    const badge = new RecordingCtx();
    drawLogo(plain, spec(), 32, 0, 0);
    drawLogoBadge(badge, spec(), 32, 0, 0);
    expect(badge.count('arc')).toBe(plain.count('arc') + 1);
  });
});

describe('LogoCache without a DOM', () => {
  it('creates no canvas and falls back to vector drawing', () => {
    const cache = new LogoCache();
    expect(createLogoCanvas(spec(), 64, 1)).toBeNull();
    expect(cache.get(spec(), 64, 1)).toBeNull();
    const ctx = new RecordingCtx();
    cache.draw(ctx, spec(), 26, 10, 10, 1);
    expect(ctx.count('drawImage')).toBe(0);
    expect(ctx.log.length).toBeGreaterThan(6);
  });

  it('memoizes lookups per spec+size bucket', () => {
    const cache = new LogoCache();
    cache.get(spec(), 26, 1);
    cache.get(spec(), 26, 1);
    cache.get(spec(), 96, 1);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
