// ★ FROZEN CONTRACT — audio interface. WebAudioEngine implements it for the
// browser; NullAudioEngine is the default in headless tests (zero mocking).

export type SfxName =
  | 'whistle' | 'hitLight' | 'hitBig' | 'catch' | 'throw' | 'kickThump' | 'puntThump'
  | 'crowdCheer' | 'crowdGroan' | 'firstDownChime' | 'touchdownFanfare' | 'fgGood'
  | 'turnoverSting' | 'flag' | 'timeoutHorn'
  | 'menuMove' | 'menuSelect' | 'menuBack' | 'menuError'
  | 'clockWarning';

export type AudioBusName = 'master' | 'sfx' | 'crowd' | 'ui';

export interface AudioEngine {
  /** Call on the first user gesture (browser autoplay policy). Idempotent. */
  unlock(): void;
  play(name: SfxName, opts?: { volume?: number; pitch?: number }): void;
  /** 0..1 target; the engine smooths transitions internally. */
  setCrowdIntensity(v: number): void;
  setBusVolume(bus: AudioBusName, v: number): void;
  /** Stop the crowd loop etc. when leaving a game. */
  stopAmbience(): void;
}

export class NullAudioEngine implements AudioEngine {
  unlock(): void {}
  play(): void {}
  setCrowdIntensity(): void {}
  setBusVolume(): void {}
  stopAmbience(): void {}
}
