// Browser bootstrap: wire the canvas + DPR + resize, build the App over the
// real WebAudioEngine, and hand it the keyboard. Audio unlocks on the first
// gesture (TitleScreen calls services.audio.unlock() on any key), because
// browsers refuse to start an AudioContext before one.

import { App } from './app/App';
import { WebAudioEngine } from './audio/WebAudioEngine';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui');

if (!canvas) throw new Error('index.html must provide a #game canvas');
if (!uiRoot) throw new Error('index.html must provide a #ui overlay');

const audio = new WebAudioEngine();
const app = new App({ uiRoot, canvas, audio, keySource: window });

function resize(): void {
  app.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// Seasons persist between weeks, never mid-game — this is the last-chance save.
window.addEventListener('beforeunload', () => app.saveNow());
window.addEventListener('pagehide', () => app.saveNow());

app.start();
