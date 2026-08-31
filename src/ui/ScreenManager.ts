// Screen stack + keyboard routing. The DOM overlay owns nothing else: the
// canvas game world underneath is somebody else's problem.
//
// Lifecycle per screen: mountInto() → onEnter() → [onExit() / onEnter() as the
// stack grows and shrinks] → onExit() → unmount().

import type { Screen } from './Screen';
import type { UiServices } from './UiServices';
import { injectStyles } from './styles';

const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Home', 'End',
]);

export class ScreenManager {
  private readonly stack: Screen[] = [];
  private keyTarget: EventTarget | null = null;

  private readonly onKeyDown = (ev: Event): void => {
    this.handleKey(ev as KeyboardEvent);
  };

  constructor(
    private readonly root: HTMLElement,
    readonly services: UiServices,
  ) {
    const doc = root.ownerDocument;
    if (doc) injectStyles(doc);
    root.classList.add('mad-ui');
  }

  get top(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get size(): number {
    return this.stack.length;
  }

  /** Screen names bottom-to-top; handy for tests and debugging. */
  get names(): string[] {
    return this.stack.map((s) => s.name);
  }

  has(name: string): boolean {
    return this.stack.some((s) => s.name === name);
  }

  push(screen: Screen): void {
    const prev = this.top;
    prev?.onExit();
    const node = screen.mountInto(this, this.services);
    this.root.appendChild(node);
    this.stack.push(screen);
    this.updateVisibility();
    screen.onEnter();
  }

  /** Pops the top screen (never empties the stack — use clearAll for that). */
  pop(): Screen | null {
    if (this.stack.length <= 1) return null;
    const screen = this.stack.pop();
    if (!screen) return null;
    screen.onExit();
    screen.unmount();
    this.updateVisibility();
    this.top?.onEnter();
    return screen;
  }

  /** Swap the top screen for another (no lifecycle event on the one below). */
  replace(screen: Screen): void {
    const old = this.stack.pop();
    if (old) {
      old.onExit();
      old.unmount();
    }
    const node = screen.mountInto(this, this.services);
    this.root.appendChild(node);
    this.stack.push(screen);
    this.updateVisibility();
    screen.onEnter();
  }

  /** Tear the stack down to a single screen. */
  reset(screen: Screen): void {
    this.clearAll();
    this.push(screen);
  }

  /** Pop until `name` is on top. No-op when it is not in the stack. */
  popTo(name: string): void {
    if (!this.has(name)) return;
    while (this.stack.length > 1 && this.top?.name !== name) this.pop();
  }

  clearAll(): void {
    while (this.stack.length > 0) {
      const screen = this.stack.pop();
      if (!screen) break;
      screen.onExit();
      screen.unmount();
    }
  }

  /** Route keydown from `target` (default: the root's document). */
  attachKeyboard(target?: EventTarget): void {
    this.detachKeyboard();
    const fallback: EventTarget | null = this.root.ownerDocument ?? null;
    const t = target ?? fallback;
    if (!t) return;
    this.keyTarget = t;
    t.addEventListener('keydown', this.onKeyDown);
  }

  detachKeyboard(): void {
    this.keyTarget?.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget = null;
  }

  /** Public so an external input router can feed the stack synthetic events. */
  handleKey(e: KeyboardEvent): boolean {
    const top = this.top;
    if (!top) return false;
    const handled = top.onKey(e);
    if (handled || SCROLL_KEYS.has(e.code)) e.preventDefault();
    return handled;
  }

  private updateVisibility(): void {
    let visible = true;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const screen = this.stack[i];
      if (!screen || !screen.isMounted) continue;
      const isTop = i === this.stack.length - 1;
      screen.el.hidden = !visible;
      screen.el.classList.toggle('behind', visible && !isTop);
      if (visible && !screen.overlay) visible = false;
    }
  }
}
