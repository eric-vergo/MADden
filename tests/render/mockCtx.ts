// A recording stand-in for CanvasRenderingContext2D. Implements the Ctx2D
// subset the renderers use and logs every command + style change, so drawing
// routines can be asserted on without a DOM.

import type { Ctx2DImage, PaintStyle } from '../../src/render/ctx';

function n(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 100000) / 100000) : String(v);
}

export class RecordingCtx implements Ctx2DImage {
  readonly log: string[] = [];

  private _fillStyle: PaintStyle = '#000000';
  private _strokeStyle: PaintStyle = '#000000';
  private _lineWidth = 1;
  private _globalAlpha = 1;
  private _font = '10px sans-serif';

  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  get fillStyle(): PaintStyle {
    return this._fillStyle;
  }

  set fillStyle(v: PaintStyle) {
    this._fillStyle = v;
    this.log.push(`fillStyle=${String(v)}`);
  }

  get strokeStyle(): PaintStyle {
    return this._strokeStyle;
  }

  set strokeStyle(v: PaintStyle) {
    this._strokeStyle = v;
    this.log.push(`strokeStyle=${String(v)}`);
  }

  get lineWidth(): number {
    return this._lineWidth;
  }

  set lineWidth(v: number) {
    this._lineWidth = v;
    this.log.push(`lineWidth=${n(v)}`);
  }

  get globalAlpha(): number {
    return this._globalAlpha;
  }

  set globalAlpha(v: number) {
    this._globalAlpha = v;
    this.log.push(`globalAlpha=${n(v)}`);
  }

  get font(): string {
    return this._font;
  }

  set font(v: string) {
    this._font = v;
    this.log.push(`font=${v}`);
  }

  save(): void {
    this.log.push('save');
  }

  restore(): void {
    this.log.push('restore');
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.log.push(`setTransform(${n(a)},${n(b)},${n(c)},${n(d)},${n(e)},${n(f)})`);
  }

  translate(x: number, y: number): void {
    this.log.push(`translate(${n(x)},${n(y)})`);
  }

  rotate(angle: number): void {
    this.log.push(`rotate(${n(angle)})`);
  }

  scale(x: number, y: number): void {
    this.log.push(`scale(${n(x)},${n(y)})`);
  }

  beginPath(): void {
    this.log.push('beginPath');
  }

  closePath(): void {
    this.log.push('closePath');
  }

  moveTo(x: number, y: number): void {
    this.log.push(`moveTo(${n(x)},${n(y)})`);
  }

  lineTo(x: number, y: number): void {
    this.log.push(`lineTo(${n(x)},${n(y)})`);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.log.push(`quadraticCurveTo(${n(cpx)},${n(cpy)},${n(x)},${n(y)})`);
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.log.push(`bezierCurveTo(${n(cp1x)},${n(cp1y)},${n(cp2x)},${n(cp2y)},${n(x)},${n(y)})`);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.log.push(
      `arc(${n(x)},${n(y)},${n(radius)},${n(startAngle)},${n(endAngle)},${String(counterclockwise ?? false)})`,
    );
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.log.push(
      `ellipse(${n(x)},${n(y)},${n(radiusX)},${n(radiusY)},${n(rotation)},${n(startAngle)},${n(endAngle)},${String(counterclockwise ?? false)})`,
    );
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.log.push(`rect(${n(x)},${n(y)},${n(w)},${n(h)})`);
  }

  fill(): void {
    this.log.push(`fill[${String(this._fillStyle)}]`);
  }

  stroke(): void {
    this.log.push(`stroke[${String(this._strokeStyle)}:${n(this._lineWidth)}]`);
  }

  clip(): void {
    this.log.push('clip');
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`fillRect(${n(x)},${n(y)},${n(w)},${n(h)})[${String(this._fillStyle)}]`);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`strokeRect(${n(x)},${n(y)},${n(w)},${n(h)})`);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.log.push(`clearRect(${n(x)},${n(y)},${n(w)},${n(h)})`);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.log.push(`fillText(${text},${n(x)},${n(y)}${maxWidth === undefined ? '' : `,${n(maxWidth)}`})`);
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.log.push(`strokeText(${text},${n(x)},${n(y)}${maxWidth === undefined ? '' : `,${n(maxWidth)}`})`);
  }

  drawImage(
    _image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.log.push(
      `drawImage(${n(sx)},${n(sy)},${n(sw)},${n(sh)},${n(dx)},${n(dy)},${n(dw)},${n(dh)})`,
    );
  }

  /** Count of a given command name in the log. */
  count(prefix: string): number {
    let c = 0;
    for (const entry of this.log) if (entry.startsWith(prefix)) c++;
    return c;
  }

  reset(): void {
    this.log.length = 0;
  }
}
