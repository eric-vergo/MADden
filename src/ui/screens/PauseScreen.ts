import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, div, span } from '../dom';
import { dirForCode, isBack, isConfirm } from '../focus';
import { SettingsScreen } from './SettingsScreen';

interface PauseAction {
  key: string;
  label: () => string;
  enabled: () => boolean;
  run: () => void;
}

export class PauseScreen extends Screen {
  readonly name = 'pause';
  override readonly overlay = true;

  private readonly ring = new FocusRing({ wrapY: true });
  private actions: PauseAction[] = [];
  private list!: HTMLElement;
  private quitArmed = false;
  private warning!: HTMLElement;

  protected build(): HTMLElement {
    const root = div('screen-frame');
    const center = div('modal-center');
    const modal = div('modal');
    append(modal, div('modal-title', 'Paused'), div('modal-sub', 'Game clock stopped'));
    this.list = div('menu');
    this.warning = div('faint');
    append(modal, this.list, this.warning);
    center.appendChild(modal);
    append(root, center, div('legend'));

    this.actions = [
      { key: 'resume', label: () => 'Resume', enabled: () => true, run: () => this.resume() },
      {
        key: 'timeout',
        label: () => `Call Timeout (${this.services.timeoutsRemaining()})`,
        enabled: () => this.services.timeoutsRemaining() > 0,
        run: () => {
          this.services.requestTimeout();
          this.blip('timeoutHorn');
          this.manager.pop();
        },
      },
      { key: 'settings', label: () => 'Settings', enabled: () => true, run: () => this.manager.push(new SettingsScreen()) },
      {
        key: 'restart',
        label: () => 'Restart Game',
        enabled: () => this.services.canRestartGame(),
        run: () => {
          this.services.restartGame();
          this.manager.pop();
        },
      },
      { key: 'quit', label: () => 'Quit to Menu', enabled: () => true, run: () => this.handleQuit() },
    ];
    this.renderList();
    return root;
  }

  onEnter(): void {
    this.renderList();
  }

  private renderList(): void {
    while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
    const entries: FocusEntry[] = this.actions.map((a) => {
      const node = div('menu-item focusable');
      node.appendChild(span(undefined, a.key === 'quit' && this.quitArmed ? 'Press Enter to confirm' : a.label()));
      if (a.key === 'quit') node.classList.toggle('danger-armed', this.quitArmed);
      this.list.appendChild(node);
      return { el: node, enabled: a.enabled(), key: a.key };
    });
    this.ring.setList(entries, true);
    this.warning.textContent = this.quitArmed
      ? 'Quitting discards this game — seasons only save between weeks.'
      : '';
  }

  private resume(): void {
    this.services.resumeGame();
    this.manager.pop();
  }

  private handleQuit(): void {
    if (!this.quitArmed) {
      this.quitArmed = true;
      this.renderList();
      this.ring.focusKey('quit');
      this.blip('menuError');
      return;
    }
    this.quitArmed = false;
    this.services.quitGame();
  }

  private disarm(): boolean {
    if (!this.quitArmed) return false;
    this.quitArmed = false;
    this.renderList();
    this.ring.focusKey('quit');
    return true;
  }

  onKey(e: KeyboardEvent): boolean {
    const dir = dirForCode(e.code);
    if (dir) {
      this.disarm();
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (isConfirm(e.code)) {
      const key = this.ring.currentKey();
      const entry = this.ring.current();
      const action = this.actions.find((a) => a.key === key);
      if (!action || entry?.enabled === false) {
        this.blip('menuError');
        return true;
      }
      if (action.key !== 'quit') this.blip('menuSelect');
      action.run();
      return true;
    }
    if (isBack(e.code)) {
      this.blip('menuBack');
      if (this.disarm()) return true;
      this.resume();
      return true;
    }
    return false;
  }
}
