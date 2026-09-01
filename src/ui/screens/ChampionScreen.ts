import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, applyAccent, div, span } from '../dom';
import { Confetti } from '../confetti';
import { dirForCode, eventCode, isBack, isConfirm } from '../focus';

export class ChampionScreen extends Screen {
  readonly name = 'champion';

  private readonly ring = new FocusRing({ wrapX: true });
  private confetti: Confetti | null = null;
  private actions: Array<{ key: string; run: () => void }> = [];

  protected build(): HTMLElement {
    const info = this.services.getChampionInfo();
    const root = div('screen-frame champ-screen');

    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    root.appendChild(canvas);

    const body = div('champ-body');
    if (!info) {
      body.appendChild(div('champ-title', 'No champion yet'));
      append(root, body, div('legend'));
      return root;
    }

    applyAccent(root, info.colors);
    this.confetti = new Confetti(canvas, {
      colors: [info.colors.primary, info.colors.secondary, '#ffffff'],
    });

    append(
      body,
      div('champ-title', `${info.seasonLabel} · Apex Bowl Champions`),
      div('champ-team', info.teamName),
      div('champ-score', info.scoreLine),
    );

    const awards = div('col');
    for (const a of info.awards) {
      const row = div('award');
      append(row, span('award-label', a.label), span(undefined, a.name), span('dim', a.detail));
      awards.appendChild(row);
    }
    body.appendChild(awards);

    const buttons = div('btn-row');
    const entries: FocusEntry[] = [];
    const defs = [
      { key: 'next', label: 'Start Next Season', run: () => { this.services.startNextSeason(); this.manager.pop(); } },
      { key: 'menu', label: 'Main Menu', run: () => { this.services.exitToMainMenu(); this.manager.popTo('main-menu'); } },
    ];
    for (const d of defs) {
      const node = div('btn focusable', d.label.toUpperCase());
      buttons.appendChild(node);
      entries.push({ el: node, key: d.key });
      this.actions.push({ key: d.key, run: d.run });
    }
    body.appendChild(buttons);
    this.ring.setGrid(entries, entries.length);

    const legend = div('legend');
    const item = div('legend-item');
    append(item, span('legend-key', '← →'), span('legend-label', 'Move'));
    const item2 = div('legend-item');
    append(item2, span('legend-key', 'Enter'), span('legend-label', 'Select'));
    append(legend, item, item2);

    append(root, body, legend);
    return root;
  }

  onEnter(): void {
    this.confetti?.start();
    this.blip('touchdownFanfare');
  }

  onExit(): void {
    this.confetti?.stop();
  }

  protected onDispose(): void {
    this.confetti?.stop();
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const dir = dirForCode(code);
    if (dir) {
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (isConfirm(code)) {
      const key = this.ring.currentKey();
      const action = this.actions.find((a) => a.key === key);
      if (action) {
        this.blip('menuSelect');
        action.run();
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
