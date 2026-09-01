import { describe, expect, it } from 'vitest';
import { GamePhase, type TickSnapshot } from '../../src/sim/types';
import { REPLAY_BUFFER_TICKS, TICK_HZ } from '../../src/sim/constants';
import { REPLAY_LEAD_TICKS, ReplayBuffer } from '../../src/replay/ReplayBuffer';

function snap(tick: number, phase: GamePhase = GamePhase.PLAY_LIVE, y = 50): TickSnapshot {
  return {
    tick,
    phase,
    players: [],
    ball: { x: 26.7, y, z: 0, mode: 'held' },
    lineOfScrimmageY: 40,
    firstDownY: 50,
    kickMeter: null,
  };
}

function manifest(startTick = 100) {
  return { startTick, description: 'Slot Cross vs Cover 3', bigPlay: false };
}

describe('ReplayBuffer capacity', () => {
  it('defaults to the frozen REPLAY_BUFFER_TICKS ring and a 1s lead', () => {
    const buf = new ReplayBuffer();
    expect(buf.capacity).toBe(REPLAY_BUFFER_TICKS);
    expect(buf.leadTicks).toBe(REPLAY_LEAD_TICKS);
    expect(REPLAY_LEAD_TICKS).toBe(TICK_HZ);
  });

  it('keeps the newest `capacity` frames and drops the oldest', () => {
    const buf = new ReplayBuffer({ capacity: 8 });
    buf.beginPlay(manifest(0));
    for (let t = 0; t < 20; t++) buf.push(snap(t));

    expect(buf.length).toBe(8);
    expect(buf.at(0)?.tick).toBe(12);
    expect(buf.at(7)?.tick).toBe(19);
    expect(buf.lastTick).toBe(19);
    expect(buf.at(8)).toBeUndefined();
    expect(buf.at(-1)).toBeUndefined();
  });

  it('never records the same tick twice', () => {
    const buf = new ReplayBuffer({ capacity: 8 });
    buf.beginPlay(manifest(0));
    buf.push(snap(5));
    buf.push(snap(5));
    buf.push(snap(4));
    buf.push(snap(6));
    expect(buf.length).toBe(2);
    expect(buf.lastTick).toBe(6);
  });
});

describe('ReplayBuffer pre-snap lead', () => {
  it('holds at most `leadTicks` pre-snap frames', () => {
    const buf = new ReplayBuffer({ capacity: 100, leadTicks: 4 });
    for (let t = 0; t < 30; t++) buf.pushLead(snap(t, GamePhase.PRE_SNAP));
    expect(buf.leadLength).toBe(4);
    expect(buf.length).toBe(0);
  });

  it('flushes the lead in front of the play at beginPlay', () => {
    const buf = new ReplayBuffer({ capacity: 100, leadTicks: 3 });
    for (let t = 0; t < 10; t++) buf.pushLead(snap(t, GamePhase.PRE_SNAP));
    buf.beginPlay(manifest(10));
    for (let t = 10; t < 15; t++) buf.push(snap(t));

    expect(buf.leadLength).toBe(0);
    expect(buf.length).toBe(8);
    expect(buf.at(0)?.tick).toBe(7);
    expect(buf.at(0)?.phase).toBe(GamePhase.PRE_SNAP);
    expect(buf.at(3)?.tick).toBe(10);
  });

  it('ignores the lead entirely when the window is zero', () => {
    const buf = new ReplayBuffer({ capacity: 10, leadTicks: 0 });
    buf.pushLead(snap(1, GamePhase.PRE_SNAP));
    expect(buf.leadLength).toBe(0);
    buf.beginPlay(manifest(2));
    expect(buf.length).toBe(0);
  });
});

describe('ReplayBuffer play lifecycle', () => {
  it('has nothing to hand out before the first play', () => {
    const buf = new ReplayBuffer({ capacity: 10 });
    expect(buf.recording).toBe(false);
    expect(buf.lastPlay()).toBeNull();
    expect(buf.lastTick).toBe(-1);
  });

  it('beginPlay resets the previous play', () => {
    const buf = new ReplayBuffer({ capacity: 10 });
    buf.beginPlay(manifest(0));
    for (let t = 0; t < 6; t++) buf.push(snap(t));
    expect(buf.length).toBe(6);

    buf.beginPlay(manifest(50));
    expect(buf.length).toBe(0);
    expect(buf.lastTick).toBe(-1);
    expect(buf.lastPlay()).toBeNull();
    expect(buf.playManifest?.startTick).toBe(50);

    // A reset ring still records forward from a lower tick than the old play.
    buf.push(snap(50));
    expect(buf.length).toBe(1);
  });

  it('trims lastPlay to the newest frames', () => {
    const buf = new ReplayBuffer({ capacity: 100 });
    buf.beginPlay(manifest(0));
    for (let t = 0; t < 40; t++) buf.push(snap(t));

    const all = buf.lastPlay();
    expect(all?.frames).toHaveLength(40);

    const trimmed = buf.lastPlay(12);
    expect(trimmed?.frames).toHaveLength(12);
    expect(trimmed?.frames[0]?.tick).toBe(28);
    expect(trimmed?.frames[11]?.tick).toBe(39);

    // Degenerate requests clamp instead of throwing.
    expect(buf.lastPlay(0)?.frames).toHaveLength(1);
    expect(buf.lastPlay(1000)?.frames).toHaveLength(40);
  });

  it('annotates the manifest once the result is known', () => {
    const buf = new ReplayBuffer({ capacity: 10 });
    buf.annotate({ bigPlay: true }); // no play yet: no-op, no throw
    buf.beginPlay(manifest(0));
    buf.push(snap(0));
    buf.annotate({ bigPlay: true, description: 'TOUCHDOWN!' });

    const play = buf.lastPlay();
    expect(play?.manifest.bigPlay).toBe(true);
    expect(play?.manifest.description).toBe('TOUCHDOWN!');
    expect(play?.manifest.startTick).toBe(0);
  });

  it('clear drops frames, lead and manifest', () => {
    const buf = new ReplayBuffer({ capacity: 10, leadTicks: 4 });
    buf.pushLead(snap(0, GamePhase.PRE_SNAP));
    buf.beginPlay(manifest(1));
    buf.push(snap(1));
    buf.clear();

    expect(buf.length).toBe(0);
    expect(buf.leadLength).toBe(0);
    expect(buf.recording).toBe(false);
    expect(buf.lastPlay()).toBeNull();
  });
});
