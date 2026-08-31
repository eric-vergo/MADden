import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, div, screenFrame, span } from '../dom';
import { dirForCode, isBack, isConfirm } from '../focus';
import { DifficultyScreen } from './DifficultyScreen';
import { SeasonHubScreen } from './SeasonHubScreen';
import { SettingsScreen } from './SettingsScreen';
import { TeamSelectScreen } from './TeamSelectScreen';

interface MenuAction {
  key: string;
  label: string;
  note?: string;
  enabled: boolean;
  run: () => void;
}

export class MainMenuScreen extends Screen {
  readonly name = 'main-menu';

  private readonly ring = new FocusRing({ wrapY: true });
  private list!: HTMLElement;
  private footer!: HTMLElement;
  private actions: MenuAction[] = [];

  protected build(): HTMLElement {
    const frame = screenFrame('Main Menu', 'Continental Football Association', [
      { keys: '↑↓ / W S', label: 'Move' },
      { keys: 'Enter', label: 'Select' },
    ]);
    const wrap = div('menu-wrap');
    this.list = div('menu');
    wrap.appendChild(this.list);
    this.footer = div('dim center');
    this.footer.style.fontSize = '12px';
    append(frame.body, wrap, this.footer);
    return frame.root;
  }

  onEnter(): void {
    this.rebuild();
  }

  private rebuild(): void {
    const hasSave = this.services.hasSeasonSave();
    this.actions = [
      { key: 'exhibition', label: 'Exhibition Game', enabled: true, run: () => this.exhibitionFlow() },
      { key: 'new-season', label: 'New Season', enabled: true, run: () => this.newSeasonFlow() },
      {
        key: 'continue',
        label: 'Continue Season',
        note: hasSave ? undefined : 'no save',
        enabled: hasSave,
        run: () => this.continueFlow(),
      },
      { key: 'settings', label: 'Settings', enabled: true, run: () => this.manager.push(new SettingsScreen()) },
    ];

    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
    const entries: FocusEntry[] = this.actions.map((action) => {
      const node = div('menu-item focusable');
      node.appendChild(span(undefined, action.label));
      if (action.note !== undefined) node.appendChild(span('menu-note', action.note));
      this.list.appendChild(node);
      return { el: node, enabled: action.enabled, key: action.key };
    });
    this.ring.setList(entries, true);

    const summary = this.services.saveSummary();
    this.footer.textContent = summary ?? 'No saved season';
  }

  onKey(e: KeyboardEvent): boolean {
    const dir = dirForCode(e.code);
    if (dir) {
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (isConfirm(e.code)) {
      const entry = this.ring.current();
      const action = this.actions[this.ring.index];
      if (!entry || !action || entry.enabled === false) {
        this.blip('menuError');
        return true;
      }
      this.blip('menuSelect');
      action.run();
      return true;
    }
    if (isBack(e.code)) {
      this.blip('menuBack');
      return true;
    }
    return false;
  }

  // --- flows ---------------------------------------------------------------

  private exhibitionFlow(): void {
    const settings = this.services.loadSettings();
    this.manager.push(new TeamSelectScreen({
      mode: 'exhibition',
      onDone: (ids) => {
        const awayTeamId = ids[0];
        const homeTeamId = ids[1];
        if (awayTeamId === undefined || homeTeamId === undefined) return;
        this.manager.push(new DifficultyScreen({
          title: 'Difficulty',
          showQuarterLength: false,
          initialDifficulty: settings.defaultDifficulty,
          initialQuarterMinutes: settings.quarterMinutes,
          confirmLabel: 'Kick Off',
          onConfirm: (sel) => {
            this.services.startExhibition({
              awayTeamId, homeTeamId,
              difficulty: sel.difficulty,
              quarterMinutes: sel.quarterMinutes,
            });
          },
        }));
      },
    }));
  }

  private newSeasonFlow(): void {
    const settings = this.services.loadSettings();
    this.manager.push(new TeamSelectScreen({
      mode: 'season',
      onDone: (ids) => {
        const userTeamId = ids[0];
        if (userTeamId === undefined) return;
        this.manager.push(new DifficultyScreen({
          title: 'Season Setup',
          showQuarterLength: true,
          initialDifficulty: settings.defaultDifficulty,
          initialQuarterMinutes: settings.quarterMinutes,
          confirmLabel: 'Start Season',
          onConfirm: (sel) => {
            this.services.startNewSeason({
              userTeamId,
              difficulty: sel.difficulty,
              quarterMinutes: sel.quarterMinutes,
            });
            this.manager.popTo(this.name);
            this.manager.push(new SeasonHubScreen());
          },
        }));
      },
    }));
  }

  private continueFlow(): void {
    this.services.continueSeason();
    this.manager.push(new SeasonHubScreen());
  }
}
