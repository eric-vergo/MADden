// Recording stand-in for the frozen AudioEngine interface. Keeps every call in
// order so director specs can assert on sfx names and crowd movement without
// touching WebAudio (vitest runs in the node environment).

import type { AudioBusName, AudioEngine, SfxName } from '../../src/audio/AudioEngine';

export interface PlayCall {
  name: SfxName;
  volume: number | undefined;
  pitch: number | undefined;
}

export class SpyAudioEngine implements AudioEngine {
  readonly plays: PlayCall[] = [];
  readonly intensities: number[] = [];
  readonly busVolumes: Array<[AudioBusName, number]> = [];
  unlockCount = 0;
  stopCount = 0;

  unlock(): void {
    this.unlockCount++;
  }

  play(name: SfxName, opts?: { volume?: number; pitch?: number }): void {
    this.plays.push({ name, volume: opts?.volume, pitch: opts?.pitch });
  }

  setCrowdIntensity(v: number): void {
    this.intensities.push(v);
  }

  setBusVolume(bus: AudioBusName, v: number): void {
    this.busVolumes.push([bus, v]);
  }

  stopAmbience(): void {
    this.stopCount++;
  }

  /** Names in call order. */
  names(): SfxName[] {
    return this.plays.map((p) => p.name);
  }

  played(name: SfxName): boolean {
    return this.plays.some((p) => p.name === name);
  }

  countOf(name: SfxName): number {
    return this.plays.filter((p) => p.name === name).length;
  }

  lastIntensity(): number {
    return this.intensities[this.intensities.length - 1] ?? Number.NaN;
  }

  clear(): void {
    this.plays.length = 0;
    this.intensities.length = 0;
    this.busVolumes.length = 0;
  }
}
