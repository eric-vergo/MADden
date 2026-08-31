// Tiny DOM helpers. Deliberately not a framework: screens build their tree
// once and mutate a handful of nodes on state changes.

import type { TeamColors } from '../sim/types';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function div(className?: string, text?: string): HTMLDivElement {
  return el('div', className, text);
}

export function span(className?: string, text?: string): HTMLSpanElement {
  return el('span', className, text);
}

/** Monospace-numeral span for scores, clocks, and table cells. */
export function num(text: string, className?: string): HTMLSpanElement {
  return span(className === undefined ? 'num' : `num ${className}`, text);
}

export function append<T extends HTMLElement>(parent: T, ...children: (Node | null | undefined)[]): T {
  for (const c of children) if (c) parent.appendChild(c);
  return parent;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setClass(node: HTMLElement, className: string, on: boolean): void {
  node.classList.toggle(className, on);
}

/** Team colors as CSS custom properties consumed by the stylesheet. */
export function applyAccent(node: HTMLElement, colors: TeamColors): void {
  node.style.setProperty('--accent', colors.primary);
  node.style.setProperty('--accent-2', colors.secondary);
}

export interface LegendItem {
  keys: string;
  label: string;
}

/** Bottom key-legend strip. Every screen gets one. */
export function keyLegend(items: readonly LegendItem[]): HTMLElement {
  const strip = div('legend');
  for (const item of items) {
    const chunk = div('legend-item');
    append(chunk, span('legend-key', item.keys), span('legend-label', item.label));
    strip.appendChild(chunk);
  }
  return strip;
}

export interface ScreenFrameParts {
  root: HTMLDivElement;
  head: HTMLDivElement;
  title: HTMLDivElement;
  subtitle: HTMLDivElement;
  body: HTMLDivElement;
}

/** Standard title / body / legend chrome shared by full screens. */
export function screenFrame(title: string, subtitle: string, legend: readonly LegendItem[]): ScreenFrameParts {
  const root = div('screen-frame');
  const head = div('screen-head');
  const titleEl = div('screen-title', title);
  const subEl = div('screen-sub', subtitle);
  append(head, titleEl, subEl);
  const body = div('screen-body');
  append(root, head, body, keyLegend(legend));
  return { root, head, title: titleEl, subtitle: subEl, body };
}

/** Horizontal 0..100 meter used for ratings. */
export function ratingBar(value: number, max = 99): HTMLElement {
  const wrap = div('bar');
  const fill = div('bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(1)}%`;
  wrap.appendChild(fill);
  return wrap;
}

export interface TableSpec {
  columns: readonly string[];
  /** Extra class per column index (e.g. 'right'). */
  columnClasses?: readonly string[];
  rows: readonly {
    cells: readonly (string | HTMLElement)[];
    className?: string;
  }[];
  className?: string;
}

export function table(spec: TableSpec): HTMLElement {
  const t = el('table', spec.className === undefined ? 'tbl' : `tbl ${spec.className}`);
  const thead = el('thead');
  const hr = el('tr');
  spec.columns.forEach((c, i) => {
    const th = el('th', spec.columnClasses?.[i]);
    th.textContent = c;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  const tbody = el('tbody');
  for (const row of spec.rows) {
    const tr = el('tr', row.className);
    row.cells.forEach((cell, i) => {
      const td = el('td', spec.columnClasses?.[i]);
      if (typeof cell === 'string') td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  append(t, thead, tbody);
  const scroller = div('tbl-wrap');
  scroller.appendChild(t);
  return scroller;
}
