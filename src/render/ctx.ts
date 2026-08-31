// The narrow structural view of CanvasRenderingContext2D that every drawing
// routine in src/render codes against. A real CanvasRenderingContext2D is
// structurally assignable to Ctx2D / Ctx2DImage; tests substitute a recording
// mock so drawing logic stays verifiable without a DOM.

export type PaintStyle = string | CanvasGradient | CanvasPattern;

export interface Ctx2D {
  fillStyle: PaintStyle;
  strokeStyle: PaintStyle;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
}

/** Ctx2D plus the blit used for the pre-rendered field and cached logos. */
export interface Ctx2DImage extends Ctx2D {
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export const UI_FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

/** Bold/regular font shorthand so call sites never hand-assemble font strings. */
export function font(sizePx: number, weight: 'normal' | 'bold' = 'normal', italic = false): string {
  return `${italic ? 'italic ' : ''}${weight === 'bold' ? 'bold ' : ''}${sizePx.toFixed(1)}px ${UI_FONT}`;
}
