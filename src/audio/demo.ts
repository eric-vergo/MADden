// Standalone bench for the audio layer (see audio-demo.html at the repo root:
// `npm run dev` then open /audio-demo.html). Not part of the game bundle.

import type { AudioBusName } from './AudioEngine';
import { WebAudioEngine } from './WebAudioEngine';
import { SFX_NAMES } from './synth';

const engine = new WebAudioEngine();

const statusEl = document.getElementById('status');
function setStatus(text: string, warn = false): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = warn ? 'warn' : '';
}

function ensureUnlocked(): void {
  const was = engine.ready;
  engine.unlock();
  if (!was && engine.ready) setStatus('AudioContext running.');
}

// --- SFX grid ---------------------------------------------------------------

const grid = document.getElementById('grid');
if (grid) {
  for (const name of SFX_NAMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      ensureUnlocked();
      engine.play(name);
      setStatus(`play('${name}')`);
    });
    grid.appendChild(btn);
  }
}

// --- Sliders ----------------------------------------------------------------

function bindSlider(id: string, onChange: (v: number) => void): void {
  const input = document.getElementById(id);
  const out = document.getElementById(`${id}Out`);
  if (!(input instanceof HTMLInputElement)) return;
  const apply = (): void => {
    const v = Number(input.value);
    if (out) out.textContent = v.toFixed(2);
    ensureUnlocked();
    onChange(v);
  };
  input.addEventListener('input', apply);
}

bindSlider('intensity', (v) => {
  engine.setCrowdIntensity(v);
  setStatus(`setCrowdIntensity(${v.toFixed(2)})`);
});

const BUS_SLIDERS: ReadonlyArray<[string, AudioBusName]> = [
  ['volMaster', 'master'],
  ['volSfx', 'sfx'],
  ['volCrowd', 'crowd'],
  ['volUi', 'ui'],
];
for (const [id, bus] of BUS_SLIDERS) {
  bindSlider(id, (v) => engine.setBusVolume(bus, v));
}

// --- Crowd transport --------------------------------------------------------

function bindButton(id: string, fn: () => void, label: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    ensureUnlocked();
    fn();
    setStatus(label);
  });
}

bindButton('swell', () => engine.swell(), 'swell() — 300ms attack, 4s settle');
bindButton('deflate', () => engine.deflate(), 'deflate() — 3s dip to 0.12');
bindButton('stop', () => engine.stopAmbience(), 'stopAmbience()');
