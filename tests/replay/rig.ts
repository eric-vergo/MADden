// A recording RenderTarget for the replay specs: keeps the exact (prev, curr,
// alpha, extras) tuple the session hands the renderer, plus the camera cuts and
// zoom changes a replay is supposed to make.

import type { RenderTarget } from '../../src/game/GameSession';
import type { RendererExtras } from '../../src/render/types';
import type { GameState, TickSnapshot } from '../../src/sim/types';

export interface DrawCall {
  prev: TickSnapshot;
  curr: TickSnapshot;
  alpha: number;
  extras: RendererExtras;
}

export interface RecordingRenderer extends RenderTarget {
  draws: DrawCall[];
  camSnaps: number[];
  zooms: number[];
  last(): DrawCall | undefined;
}

export function recordingRenderer(): RecordingRenderer {
  const draws: DrawCall[] = [];
  const camSnaps: number[] = [];
  const zooms: number[] = [];
  return {
    draws,
    camSnaps,
    zooms,
    camera: {
      setZoom(zoom: number): void {
        zooms.push(zoom);
      },
    },
    draw(
      prev: TickSnapshot,
      curr: TickSnapshot,
      alpha: number,
      _state: Readonly<GameState>,
      extras: RendererExtras,
    ): void {
      draws.push({ prev, curr, alpha, extras });
    },
    snapCamera(worldY: number): void {
      camSnaps.push(worldY);
    },
    last(): DrawCall | undefined {
      return draws[draws.length - 1];
    },
  };
}
