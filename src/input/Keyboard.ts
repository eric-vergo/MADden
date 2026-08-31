// DOM keydown/keyup capture. The event target is injected (constructor takes
// anything with add/removeEventListener) so tests drive it with a fake and the
// app passes `window`.
//
// The queue is drained once per sim tick by InputSystem — nothing is collapsed
// here, so a key tapped and released between two ticks still yields both edges.

/** One physical key transition, in arrival order. */
export interface KeyEvent {
  code: string;
  down: boolean;
  tMs: number;
}

/** Structural subset of KeyboardEvent that this module reads. */
export interface KeyEventLike {
  readonly code: string;
  readonly repeat?: boolean;
  readonly timeStamp?: number;
  preventDefault?: () => void;
}

/**
 * Structural subset of EventTarget. The listener parameter is `unknown` on
 * purpose: that is the only shape a DOM `window` is assignable to without
 * dragging DOM lib types into the signature.
 */
export interface KeyEventSource {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export interface KeyboardOptions {
  /** Fallback clock for events without a timeStamp. Injectable for tests. */
  now?: () => number;
  /** Codes to preventDefault on while active (usually every bound code). */
  captured?: Iterable<string>;
  /** Start listening but ignore events until setActive(true). Default true. */
  active?: boolean;
}

// Safety valve: if nobody drains (tab throttled before blur fires) the queue
// stops growing. Losing the oldest transitions is preferable to unbounded RAM.
const MAX_QUEUED_EVENTS = 512;

const NO_EVENTS: readonly KeyEvent[] = [];

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function asKeyEvent(ev: unknown): KeyEventLike | null {
  if (typeof ev !== 'object' || ev === null) return null;
  const candidate = ev as { code?: unknown };
  return typeof candidate.code === 'string' ? (ev as KeyEventLike) : null;
}

export class Keyboard {
  private readonly source: KeyEventSource;
  private readonly now: () => number;
  private readonly queue: KeyEvent[] = [];
  private readonly downCodes = new Set<string>();
  private captured: Set<string>;
  private activeFlag: boolean;
  private disposed = false;

  constructor(source: KeyEventSource, opts?: KeyboardOptions) {
    this.source = source;
    this.now = opts?.now ?? defaultNow;
    this.captured = new Set(opts?.captured ?? []);
    this.activeFlag = opts?.active ?? true;
    this.source.addEventListener('keydown', this.onKeyDown);
    this.source.addEventListener('keyup', this.onKeyUp);
    this.source.addEventListener('blur', this.onBlur);
  }

  get active(): boolean {
    return this.activeFlag;
  }

  /**
   * Turning capture off releases everything first, so no action can stick down
   * while a DOM text field or modal owns the keyboard.
   */
  setActive(active: boolean): void {
    if (active === this.activeFlag) return;
    if (!active) this.releaseAll();
    this.activeFlag = active;
  }

  /** Codes whose browser default is suppressed while active (Space, Tab, …). */
  setCapturedCodes(codes: Iterable<string>): void {
    this.captured = new Set(codes);
  }

  isDown(code: string): boolean {
    return this.downCodes.has(code);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Take every queued transition and clear the queue. */
  drain(): readonly KeyEvent[] {
    if (this.queue.length === 0) return NO_EVENTS;
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  /** Queue keyups for everything currently held (sorted for determinism). */
  releaseAll(): void {
    if (this.downCodes.size === 0) return;
    const codes = [...this.downCodes].sort();
    const t = this.now();
    this.downCodes.clear();
    for (const code of codes) this.push({ code, down: false, tMs: t });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.source.removeEventListener('keydown', this.onKeyDown);
    this.source.removeEventListener('keyup', this.onKeyUp);
    this.source.removeEventListener('blur', this.onBlur);
    this.downCodes.clear();
    this.queue.length = 0;
  }

  private push(ev: KeyEvent): void {
    if (this.queue.length >= MAX_QUEUED_EVENTS) this.queue.shift();
    this.queue.push(ev);
  }

  private stamp(ev: KeyEventLike): number {
    return typeof ev.timeStamp === 'number' ? ev.timeStamp : this.now();
  }

  private readonly onKeyDown = (raw: unknown): void => {
    if (!this.activeFlag) return;
    const ev = asKeyEvent(raw);
    if (ev === null) return;
    if (this.captured.has(ev.code)) ev.preventDefault?.();
    // OS auto-repeat and duplicate downs (focus weirdness) are not new edges.
    if (ev.repeat === true) return;
    if (this.downCodes.has(ev.code)) return;
    this.downCodes.add(ev.code);
    this.push({ code: ev.code, down: true, tMs: this.stamp(ev) });
  };

  private readonly onKeyUp = (raw: unknown): void => {
    if (!this.activeFlag) return;
    const ev = asKeyEvent(raw);
    if (ev === null) return;
    if (this.captured.has(ev.code)) ev.preventDefault?.();
    if (!this.downCodes.delete(ev.code)) return; // never saw the down
    this.push({ code: ev.code, down: false, tMs: this.stamp(ev) });
  };

  private readonly onBlur = (_raw?: unknown): void => {
    this.releaseAll();
  };
}
