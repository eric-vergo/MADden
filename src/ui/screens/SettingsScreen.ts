import type { Difficulty } from '../../sim/types';
import type { SettingsSave } from '../../save/schemas';
import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, div, screenFrame, span } from '../dom';
import { dirForCode, eventCode, isBack, isConfirm } from '../focus';
import { DIFFICULTY_LABEL } from '../format';

const LEVELS: readonly Difficulty[] = ['rookie', 'pro', 'allPro', 'allMadden'];
const QUARTERS: readonly (3 | 5 | 7)[] = [3, 5, 7];
const HINTS: readonly SettingsSave['coverageHints'][] = ['auto', 'on', 'off'];

const KEY_REFERENCE: ReadonlyArray<[string, string]> = [
  ['Arrows / WASD', 'Move · navigate'],
  ['Enter', 'Confirm · snap ready'],
  ['Esc', 'Back · pause'],
  ['Q / E', 'Cycle tabs · play pages'],
  ['Space', 'Snap · dive · kick meter'],
  ['H', 'Hard count'],
  ['Tab', 'Switch defender'],
  ['1 – 5', 'Throw to receiver (hold = bullet)'],
  ['X', 'Throw away'],
  ['Shift', 'Sprint'],
  ['J / K / L', 'Juke · spin · stiff arm'],
  ['C', 'Ask coach (play call)'],
  ['T', 'Timeout'],
];

interface SettingRow {
  key: string;
  label: string;
  render: () => string | HTMLElement;
  adjust?: (delta: number) => void;
  confirm?: () => void;
}

export class SettingsScreen extends Screen {
  readonly name = 'settings';

  private readonly ring = new FocusRing({ wrapY: true });
  private settings!: SettingsSave;
  private rows: SettingRow[] = [];
  private valueNodes: HTMLElement[] = [];
  private resetArmed = false;
  private resetNode: HTMLElement | null = null;

  protected build(): HTMLElement {
    this.settings = { ...this.services.loadSettings() };
    const frame = screenFrame('Settings', 'Saved automatically', [
      { keys: '↑↓', label: 'Move' },
      { keys: '←→', label: 'Adjust' },
      { keys: 'Enter', label: 'Activate' },
      { keys: 'Esc', label: 'Back' },
    ]);

    const layout = div('settings-layout');
    const left = div('col scroll');
    const right = div('panel');
    right.appendChild(div('panel-title', 'Key reference'));
    const ref = div('keyref');
    for (const [k, v] of KEY_REFERENCE) {
      append(ref, span('k', k), span('v', v));
    }
    right.appendChild(ref);
    append(layout, left, right);
    frame.body.appendChild(layout);

    this.rows = this.buildRows();
    const entries: FocusEntry[] = [];
    this.valueNodes = [];
    for (const row of this.rows) {
      const node = div(row.key === 'reset' ? 'btn danger focusable' : 'option-row focusable');
      if (row.key === 'reset') {
        node.textContent = 'Reset all save data';
        this.resetNode = node;
      } else {
        const value = div('option-value');
        append(node, span('option-label', row.label), value);
        this.valueNodes.push(value);
      }
      left.appendChild(node);
      entries.push({ el: node, key: row.key });
    }
    this.ring.setList(entries);
    this.renderValues();
    return frame.root;
  }

  private buildRows(): SettingRow[] {
    const vol = (key: 'volMaster' | 'volSfx' | 'volCrowd', label: string): SettingRow => ({
      key,
      label,
      render: () => volumeMeter(this.settings[key]),
      adjust: (d) => {
        this.settings[key] = Math.max(0, Math.min(10, this.settings[key] + d));
        this.applyAudio();
      },
    });
    return [
      vol('volMaster', 'Master Volume'),
      vol('volSfx', 'Effects Volume'),
      vol('volCrowd', 'Crowd Volume'),
      {
        key: 'difficulty',
        label: 'Default Difficulty',
        render: () => DIFFICULTY_LABEL[this.settings.defaultDifficulty] ?? this.settings.defaultDifficulty,
        adjust: (d) => {
          const i = LEVELS.indexOf(this.settings.defaultDifficulty);
          const next = LEVELS[(i + d + LEVELS.length) % LEVELS.length];
          if (next) this.settings.defaultDifficulty = next;
        },
      },
      {
        key: 'quarter',
        label: 'Quarter Length',
        render: () => `${this.settings.quarterMinutes} MIN`,
        adjust: (d) => {
          const i = QUARTERS.indexOf(this.settings.quarterMinutes);
          const next = QUARTERS[(i + d + QUARTERS.length) % QUARTERS.length];
          if (next) this.settings.quarterMinutes = next;
        },
      },
      {
        key: 'hints',
        label: 'Coverage Hints',
        render: () => this.settings.coverageHints.toUpperCase(),
        adjust: (d) => {
          const i = HINTS.indexOf(this.settings.coverageHints);
          const next = HINTS[(i + d + HINTS.length) % HINTS.length];
          if (next) this.settings.coverageHints = next;
        },
      },
      {
        key: 'reset',
        label: 'Reset Save Data',
        render: () => '',
        confirm: () => this.handleReset(),
      },
    ];
  }

  private renderValues(): void {
    let vi = 0;
    for (const row of this.rows) {
      if (row.key === 'reset') continue;
      const node = this.valueNodes[vi];
      vi++;
      if (!node) continue;
      while (node.firstChild) node.removeChild(node.firstChild);
      const rendered = row.render();
      append(node, span('option-arrow', '◀'));
      if (typeof rendered === 'string') node.appendChild(span('num', rendered));
      else node.appendChild(rendered);
      node.appendChild(span('option-arrow', '▶'));
    }
  }

  private applyAudio(): void {
    const a = this.services.audio;
    a.setBusVolume('master', this.settings.volMaster / 10);
    a.setBusVolume('sfx', this.settings.volSfx / 10);
    a.setBusVolume('crowd', this.settings.volCrowd / 10);
    a.setBusVolume('ui', this.settings.volSfx / 10);
  }

  private persist(): void {
    this.services.saveSettings({ ...this.settings });
  }

  private handleReset(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetNode?.classList.add('danger-armed');
      if (this.resetNode) this.resetNode.textContent = 'Press Enter again to erase everything';
      this.blip('menuError');
      return;
    }
    this.resetArmed = false;
    this.resetNode?.classList.remove('danger-armed');
    if (this.resetNode) this.resetNode.textContent = 'Reset all save data';
    this.services.resetAllSaves();
    this.settings = { ...this.services.loadSettings() };
    this.renderValues();
    this.applyAudio();
    this.blip('menuSelect');
  }

  private disarmReset(): boolean {
    if (!this.resetArmed) return false;
    this.resetArmed = false;
    this.resetNode?.classList.remove('danger-armed');
    if (this.resetNode) this.resetNode.textContent = 'Reset all save data';
    return true;
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const dir = dirForCode(code);
    if (dir === 'up' || dir === 'down') {
      this.disarmReset();
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (dir === 'left' || dir === 'right') {
      const row = this.rows[this.ring.index];
      if (row?.adjust) {
        row.adjust(dir === 'right' ? 1 : -1);
        this.renderValues();
        this.persist();
        this.blip('menuMove');
      }
      return true;
    }
    if (isConfirm(code)) {
      const row = this.rows[this.ring.index];
      if (row?.confirm) row.confirm();
      else this.blip('menuMove');
      return true;
    }
    if (isBack(code)) {
      this.blip('menuBack');
      if (this.disarmReset()) return true;
      this.persist();
      this.manager.pop();
      return true;
    }
    return false;
  }
}

function volumeMeter(value: number): HTMLElement {
  const meter = div('vol-meter');
  for (let i = 0; i < 10; i++) {
    const seg = div(i < value ? 'vol-seg on' : 'vol-seg');
    meter.appendChild(seg);
  }
  const wrap = div('row');
  append(wrap, meter, span('num', `${value}`));
  return wrap;
}
