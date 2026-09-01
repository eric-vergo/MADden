// Pure keyboard-focus math. No DOM here — screens map these indices onto
// their own element arrays. Rows may be ragged (last row shorter): vertical
// moves keep the column and clamp into the destination row.

export type FocusDir = 'up' | 'down' | 'left' | 'right';

export interface FocusOptions {
  /** Horizontal move past a row edge wraps to the other end of the SAME row. */
  wrapX?: boolean;
  /** Vertical move past the first/last row wraps to the other end. */
  wrapY?: boolean;
}

export interface RowCol {
  row: number;
  col: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function total(rowSizes: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < rowSizes.length; i++) n += rowSizes[i] ?? 0;
  return n;
}

/** Flat index → {row, col} over rows of the given sizes. */
export function rowColOf(index: number, rowSizes: readonly number[]): RowCol {
  const n = total(rowSizes);
  if (n === 0) return { row: 0, col: 0 };
  let i = clamp(index, 0, n - 1);
  for (let row = 0; row < rowSizes.length; row++) {
    const size = rowSizes[row] ?? 0;
    if (i < size) return { row, col: i };
    i -= size;
  }
  return { row: rowSizes.length - 1, col: Math.max(0, (rowSizes[rowSizes.length - 1] ?? 1) - 1) };
}

/** {row, col} → flat index (col clamped into the row). */
export function flatIndexOf(row: number, col: number, rowSizes: readonly number[]): number {
  if (rowSizes.length === 0) return 0;
  const r = clamp(row, 0, rowSizes.length - 1);
  let base = 0;
  for (let i = 0; i < r; i++) base += rowSizes[i] ?? 0;
  const size = rowSizes[r] ?? 0;
  if (size === 0) return base;
  return base + clamp(col, 0, size - 1);
}

/** Next non-empty row in `step` direction from `row`, or -1 if none. */
function seekRow(row: number, step: number, rowSizes: readonly number[], wrap: boolean): number {
  const rows = rowSizes.length;
  for (let k = 1; k <= rows; k++) {
    let r = row + step * k;
    if (r < 0 || r >= rows) {
      if (!wrap) return -1;
      r = ((r % rows) + rows) % rows;
    }
    if ((rowSizes[r] ?? 0) > 0) return r;
  }
  return -1;
}

/**
 * Move focus over a ragged grid. Returns the new flat index (unchanged when the
 * move is blocked by an edge and wrapping is off).
 */
export function moveRagged(
  index: number,
  dir: FocusDir,
  rowSizes: readonly number[],
  opts: FocusOptions = {},
): number {
  const n = total(rowSizes);
  if (n === 0) return 0;
  const cur = clamp(index, 0, n - 1);
  const { row, col } = rowColOf(cur, rowSizes);
  const size = rowSizes[row] ?? 0;

  if (dir === 'left' || dir === 'right') {
    const next = col + (dir === 'right' ? 1 : -1);
    if (next < 0 || next >= size) {
      if (!opts.wrapX || size === 0) return cur;
      return flatIndexOf(row, ((next % size) + size) % size, rowSizes);
    }
    return flatIndexOf(row, next, rowSizes);
  }

  const target = seekRow(row, dir === 'down' ? 1 : -1, rowSizes, opts.wrapY === true);
  if (target < 0) return cur;
  return flatIndexOf(target, col, rowSizes);
}

/** Uniform grid of `count` items laid out in rows of `cols` (last row ragged). */
export function moveGrid(
  index: number,
  dir: FocusDir,
  count: number,
  cols: number,
  opts: FocusOptions = {},
): number {
  if (count <= 0 || cols <= 0) return 0;
  const rows: number[] = [];
  for (let left = count; left > 0; left -= cols) rows.push(Math.min(cols, left));
  return moveRagged(index, dir, rows, opts);
}

/** Single-column list: up/down move, left/right are no-ops. */
export function moveList(index: number, dir: FocusDir, count: number, opts: FocusOptions = {}): number {
  if (count <= 0) return 0;
  if (dir === 'left' || dir === 'right') return clamp(index, 0, count - 1);
  const rows: number[] = new Array<number>(count).fill(1);
  return moveRagged(index, dir, rows, { wrapY: opts.wrapY !== false });
}

/**
 * Skip over disabled entries in `dir` after a move. Returns `from` when every
 * candidate in that direction is disabled.
 */
export function moveSkippingDisabled(
  from: number,
  dir: FocusDir,
  rowSizes: readonly number[],
  enabled: (i: number) => boolean,
  opts: FocusOptions = {},
): number {
  const n = total(rowSizes);
  if (n === 0) return 0;
  let cur = clamp(from, 0, n - 1);
  for (let step = 0; step < n; step++) {
    const next = moveRagged(cur, dir, rowSizes, opts);
    if (next === cur) return from;
    if (enabled(next)) return next;
    cur = next;
  }
  return from;
}

// ---------------------------------------------------------------------------
// Key code → intent. Arrows + WASD move, Enter/Space confirm, Esc/Backspace
// back, Q/E cycle tabs. Digit keys are surfaced raw for screens that want them.
// ---------------------------------------------------------------------------

/**
 * KeyboardEvent.code, with a fallback derived from .key. Physical keyboards
 * always populate `code`, but synthetic events (automation, some IMEs and
 * on-screen keyboards) often only carry `key`.
 */
export function eventCode(e: { code?: string; key?: string }): string {
  if (e.code !== undefined && e.code !== '') return e.code;
  const key = e.key ?? '';
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return `Key${upper}`;
    if (key >= '0' && key <= '9') return `Digit${key}`;
    return '';
  }
  switch (key) {
    case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
    case 'Enter': case 'Escape': case 'Backspace': case 'Tab':
    case 'Home': case 'End':
      return key;
    default:
      return '';
  }
}

export function dirForCode(code: string): FocusDir | null {
  switch (code) {
    case 'ArrowUp': case 'KeyW': return 'up';
    case 'ArrowDown': case 'KeyS': return 'down';
    case 'ArrowLeft': case 'KeyA': return 'left';
    case 'ArrowRight': case 'KeyD': return 'right';
    default: return null;
  }
}

export function isConfirm(code: string): boolean {
  return code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
}

export function isBack(code: string): boolean {
  return code === 'Escape' || code === 'Backspace';
}

export function tabDeltaForCode(code: string): number {
  if (code === 'KeyQ' || code === 'BracketLeft') return -1;
  if (code === 'KeyE' || code === 'BracketRight') return 1;
  return 0;
}

/** Cycle a tab index by delta with wraparound. */
export function cycle(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return ((index + delta) % count + count) % count;
}
