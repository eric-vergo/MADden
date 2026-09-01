import { Screen } from '../Screen';
import { append, div, keyLegend } from '../dom';
import { eventCode } from '../focus';
import { MainMenuScreen } from './MainMenuScreen';

const IGNORED_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab', 'CapsLock',
]);

/** Any key advances; Enter is the advertised one because it unlocks audio. */
export class TitleScreen extends Screen {
  readonly name = 'title';

  protected build(): HTMLElement {
    const root = div('screen-frame');
    const body = div('screen-body title-screen');

    const crest = document.createElement('canvas');
    crest.width = 132;
    crest.height = 132;
    crest.style.width = '110px';
    crest.style.height = '110px';
    drawCrest(crest);

    const mark = div('wordmark', 'MADden');
    const sub = div('wordmark-sub', 'Continental Football Association');
    const rule = div('title-rule');
    const cta = div('title-cta', 'Press Enter');

    append(body, crest, mark, sub, rule, cta);
    append(root, body, keyLegend([{ keys: 'Enter', label: 'Start' }]));
    return root;
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    if (IGNORED_CODES.has(code) || e.repeat) return false;
    this.services.audio.unlock();
    this.blip('menuSelect');
    this.manager.replace(new MainMenuScreen());
    return true;
  }
}

/** Procedural league crest — shield + chevron stack, no image assets. */
function drawCrest(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const s = canvas.width;
  const cx = s / 2;
  ctx.clearRect(0, 0, s, s);

  ctx.beginPath();
  ctx.moveTo(cx - s * 0.34, s * 0.12);
  ctx.lineTo(cx + s * 0.34, s * 0.12);
  ctx.lineTo(cx + s * 0.34, s * 0.52);
  ctx.quadraticCurveTo(cx + s * 0.3, s * 0.82, cx, s * 0.93);
  ctx.quadraticCurveTo(cx - s * 0.3, s * 0.82, cx - s * 0.34, s * 0.52);
  ctx.closePath();
  ctx.fillStyle = '#101c30';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e8b93e';
  ctx.stroke();

  ctx.strokeStyle = '#e8b93e';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    const y = s * (0.34 + i * 0.13);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.17, y);
    ctx.lineTo(cx, y + s * 0.09);
    ctx.lineTo(cx + s * 0.17, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#e8eef7';
  ctx.font = `700 ${Math.round(s * 0.14)}px 'Trebuchet MS', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CFA', cx, s * 0.24);
}
