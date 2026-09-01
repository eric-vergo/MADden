import type { Difficulty } from '../../sim/types';
import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, div, screenFrame, span } from '../dom';
import { dirForCode, eventCode, isBack, isConfirm } from '../focus';
import { DIFFICULTY_BLURB, DIFFICULTY_LABEL } from '../format';

export interface DifficultySelection {
  difficulty: Difficulty;
  quarterMinutes: 3 | 5 | 7;
}

export interface DifficultyOptions {
  title?: string;
  showQuarterLength: boolean;
  initialDifficulty: Difficulty;
  initialQuarterMinutes: 3 | 5 | 7;
  confirmLabel: string;
  onConfirm: (selection: DifficultySelection) => void;
}

const LEVELS: readonly Difficulty[] = ['rookie', 'pro', 'allPro', 'allMadden'];
const QUARTER_OPTIONS: readonly (3 | 5 | 7)[] = [3, 5, 7];

export class DifficultyScreen extends Screen {
  readonly name = 'difficulty';

  private readonly ring = new FocusRing({ wrapY: false });
  private difficulty: Difficulty;
  private quarterMinutes: 3 | 5 | 7;
  private marks: HTMLElement[] = [];
  private quarterValue: HTMLElement | null = null;

  constructor(private readonly opts: DifficultyOptions) {
    super();
    this.difficulty = opts.initialDifficulty;
    this.quarterMinutes = opts.initialQuarterMinutes;
  }

  protected build(): HTMLElement {
    const frame = screenFrame(
      this.opts.title ?? 'Difficulty',
      'CPU skill only — your players are never nerfed',
      [
        { keys: '↑↓', label: 'Move' },
        { keys: '←→', label: 'Adjust' },
        { keys: 'Enter', label: 'Confirm' },
        { keys: 'Esc', label: 'Back' },
      ],
    );

    const wrap = div('menu-wrap');
    const list = div('diff-list');
    wrap.appendChild(list);
    frame.body.appendChild(wrap);

    const entries: FocusEntry[] = [];
    this.marks = [];
    for (const level of LEVELS) {
      const row = div('diff-item focusable');
      const mark = span('diff-mark', level === this.difficulty ? '●' : '');
      append(
        row,
        span('diff-name', DIFFICULTY_LABEL[level] ?? level),
        span('diff-blurb', DIFFICULTY_BLURB[level] ?? ''),
        mark,
      );
      list.appendChild(row);
      this.marks.push(mark);
      entries.push({ el: row, key: level });
    }

    if (this.opts.showQuarterLength) {
      const row = div('option-row focusable');
      const value = div('option-value');
      this.quarterValue = value;
      append(
        row,
        span('option-label', 'Quarter Length'),
        append(value, span('option-arrow', '◀'), span('num', ''), span('option-arrow', '▶')),
      );
      list.appendChild(row);
      entries.push({ el: row, key: 'quarter' });
    }

    const confirm = div('btn primary focusable', this.opts.confirmLabel.toUpperCase());
    list.appendChild(confirm);
    entries.push({ el: confirm, key: 'confirm' });

    this.ring.setList(entries);
    this.ring.focus(Math.max(0, LEVELS.indexOf(this.difficulty)));
    this.renderQuarter();
    return frame.root;
  }

  private renderMarks(): void {
    LEVELS.forEach((level, i) => {
      const mark = this.marks[i];
      if (mark) mark.textContent = level === this.difficulty ? '●' : '';
    });
  }

  private renderQuarter(): void {
    if (!this.quarterValue) return;
    const label = this.quarterValue.querySelector('.num');
    if (label) label.textContent = `${this.quarterMinutes} MIN`;
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const dir = dirForCode(code);
    if (dir === 'up' || dir === 'down') {
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (dir === 'left' || dir === 'right') {
      const key = this.ring.currentKey();
      if (key === 'quarter') {
        const i = QUARTER_OPTIONS.indexOf(this.quarterMinutes);
        const next = QUARTER_OPTIONS[(i + (dir === 'right' ? 1 : QUARTER_OPTIONS.length - 1)) % QUARTER_OPTIONS.length];
        if (next !== undefined) this.quarterMinutes = next;
        this.renderQuarter();
        this.blip('menuMove');
      }
      return true;
    }
    if (isConfirm(code)) {
      const key = this.ring.currentKey();
      if (key === 'confirm') {
        this.blip('menuSelect');
        this.opts.onConfirm({ difficulty: this.difficulty, quarterMinutes: this.quarterMinutes });
        return true;
      }
      if (key === 'quarter') {
        this.ring.move('down');
        this.blip('menuMove');
        return true;
      }
      if (key !== undefined && (LEVELS as readonly string[]).includes(key)) {
        this.difficulty = key as Difficulty;
        this.renderMarks();
        this.blip('menuSelect');
        this.ring.focus(this.ring.count - 1);
        return true;
      }
      return true;
    }
    if (isBack(code)) {
      this.blip('menuBack');
      this.manager.pop();
      return true;
    }
    return false;
  }
}
