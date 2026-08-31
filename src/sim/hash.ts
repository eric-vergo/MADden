// Stable FNV-1a hash over the dynamic parts of GameState, for determinism tests.
// Excludes AI scratch memory (`mind`) — behavior effects appear in positions,
// velocities, score, and clock, which are all hashed.

import type { GameState } from './types';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export class Hasher {
  private h = FNV_OFFSET;

  u32(v: number): this {
    let h = this.h;
    h ^= v & 0xff; h = Math.imul(h, FNV_PRIME);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, FNV_PRIME);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, FNV_PRIME);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, FNV_PRIME);
    this.h = h;
    return this;
  }

  num(v: number): this {
    f64[0] = v;
    // Uint32Array views are always in platform byte order; both lanes hashed.
    return this.u32(u32[0] as number).u32(u32[1] as number);
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i) & 0xffff;
      this.h = Math.imul(this.h, FNV_PRIME);
    }
    return this;
  }

  get value(): number {
    return this.h >>> 0;
  }
}

export function hashGameState(s: GameState): number {
  const h = new Hasher();
  h.u32(s.seed >>> 0)
    .u32(s.tick)
    .str(s.phase)
    .num(s.score[0]).num(s.score[1])
    .u32(s.quarter)
    .num(s.clockSec)
    .num(s.playClockSec)
    .u32(s.clockRunning ? 1 : 0)
    .u32(s.possession)
    .u32(s.down)
    .num(s.toGo)
    .num(s.ballOnY)
    .u32(s.timeouts[0]).u32(s.timeouts[1]);
  const p = s.play;
  if (p) {
    h.num(p.lineOfScrimmageY).num(p.firstDownY).u32(p.snapTick >>> 0);
    for (const pl of p.players) {
      h.num(pl.pos2.x).num(pl.pos2.y).num(pl.vel.x).num(pl.vel.y)
        .num(pl.facing).str(pl.anim).u32(pl.hasBall ? 1 : 0)
        .u32(pl.engagedWith === null ? 0xffff : pl.engagedWith)
        .u32(pl.stateTimer);
    }
    h.num(p.ball.pos2.x).num(p.ball.pos2.y).num(p.ball.z)
      .num(p.ball.vel.x).num(p.ball.vel.y).num(p.ball.vz)
      .str(p.ball.mode)
      .u32(p.ball.carrierIdx === null ? 0xffff : p.ball.carrierIdx);
  }
  return h.value;
}
