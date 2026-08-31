// Base class for every screen + the DOM-side focus ring that wraps the pure
// grid math in focus.ts.

import type { SfxName } from '../audio/AudioEngine';
import type { ScreenManager } from './ScreenManager';
import type { UiServices } from './UiServices';
import { type FocusDir, moveSkippingDisabled } from './focus';

export abstract class Screen {
  abstract readonly name: string;
  /** Overlay screens leave the screen underneath visible (pause, penalty…). */
  readonly overlay: boolean = false;

  protected manager!: ScreenManager;
  protected services!: UiServices;
  private node: HTMLElement | null = null;

  get el(): HTMLElement {
    if (!this.node) throw new Error(`screen "${this.name}" is not mounted`);
    return this.node;
  }

  get isMounted(): boolean {
    return this.node !== null;
  }

  /** Called by ScreenManager only. */
  mountInto(manager: ScreenManager, services: UiServices): HTMLElement {
    this.manager = manager;
    this.services = services;
    const node = this.build();
    node.classList.add('screen');
    if (this.overlay) node.classList.add('overlay');
    node.dataset.screen = this.name;
    this.node = node;
    return node;
  }

  /** Called by ScreenManager only. */
  unmount(): void {
    this.onDispose();
    this.node?.remove();
    this.node = null;
  }

  /** Build the screen's DOM subtree. Called once per push. */
  protected abstract build(): HTMLElement;

  /** Becomes the top of the stack (first push and after a pop above it). */
  onEnter(): void {}
  /** Stops being the top of the stack (covered or popped). */
  onExit(): void {}
  /** Return true when the key was consumed. */
  onKey(_e: KeyboardEvent): boolean {
    return false;
  }

  protected onDispose(): void {}

  protected blip(name: SfxName): void {
    this.services.audio.play(name);
  }
}

export interface FocusEntry {
  el: HTMLElement;
  /** Disabled entries are skipped by moves and reject Confirm. */
  enabled?: boolean;
  /** Optional payload the screen reads on confirm. */
  key?: string;
}

export interface FocusRingOptions {
  wrapX?: boolean;
  wrapY?: boolean;
  className?: string;
  onChange?: (index: number) => void;
}

/** Applies `.focused` to the current entry and moves with arrow/WASD input. */
export class FocusRing {
  private entries: FocusEntry[] = [];
  private rows: number[] = [];
  private idx = 0;

  constructor(private readonly opts: FocusRingOptions = {}) {}

  get index(): number {
    return this.idx;
  }

  get count(): number {
    return this.entries.length;
  }

  current(): FocusEntry | undefined {
    return this.entries[this.idx];
  }

  currentKey(): string | undefined {
    return this.entries[this.idx]?.key;
  }

  setList(entries: FocusEntry[], keepIndex = false): void {
    this.setRows(entries, entries.map(() => 1), keepIndex);
  }

  setGrid(entries: FocusEntry[], cols: number, keepIndex = false): void {
    const rows: number[] = [];
    for (let left = entries.length; left > 0; left -= cols) rows.push(Math.min(cols, left));
    this.setRows(entries, rows, keepIndex);
  }

  setRows(entries: FocusEntry[], rowSizes: number[], keepIndex = false): void {
    this.entries = entries;
    this.rows = rowSizes;
    const max = Math.max(0, entries.length - 1);
    this.idx = keepIndex ? Math.min(this.idx, max) : 0;
    if (!this.isEnabled(this.idx)) {
      const firstEnabled = entries.findIndex((e) => e.enabled !== false);
      if (firstEnabled >= 0) this.idx = firstEnabled;
    }
    this.refresh();
  }

  private isEnabled(i: number): boolean {
    return this.entries[i]?.enabled !== false;
  }

  /** Returns true when focus actually moved. */
  move(dir: FocusDir): boolean {
    if (this.entries.length === 0) return false;
    const next = moveSkippingDisabled(
      this.idx, dir, this.rows, (i) => this.isEnabled(i),
      { wrapX: this.opts.wrapX, wrapY: this.opts.wrapY },
    );
    if (next === this.idx) return false;
    this.idx = next;
    this.refresh();
    this.opts.onChange?.(next);
    return true;
  }

  focus(index: number, notify = false): void {
    if (index < 0 || index >= this.entries.length) return;
    this.idx = index;
    this.refresh();
    if (notify) this.opts.onChange?.(index);
  }

  focusKey(key: string, notify = false): void {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i >= 0) this.focus(i, notify);
  }

  refresh(): void {
    const cls = this.opts.className ?? 'focused';
    this.entries.forEach((entry, i) => {
      const on = i === this.idx;
      entry.el.classList.toggle(cls, on);
      entry.el.classList.toggle('disabled', entry.enabled === false);
      if (on) scrollIntoView(entry.el);
    });
  }

  clearFocusClass(): void {
    const cls = this.opts.className ?? 'focused';
    for (const entry of this.entries) entry.el.classList.remove(cls);
  }
}

function scrollIntoView(node: HTMLElement): void {
  const fn = (node as Partial<HTMLElement>).scrollIntoView;
  if (typeof fn === 'function') fn.call(node, { block: 'nearest', inline: 'nearest' });
}
