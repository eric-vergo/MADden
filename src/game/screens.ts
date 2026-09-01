// Two screens the integration layer owns because no other stream needs them:
// the transparent base screen that sits under the in-game HUD (so the stack is
// never empty and overlays have something to pop back to), and a generic
// two-option modal for the coin toss and the point-after choice.

import { Screen } from '../ui/Screen';
import { append, div, span } from '../ui/dom';
import { dirForCode, eventCode, isConfirm } from '../ui/focus';

/**
 * Bottom of the in-game screen stack: draws nothing, blocks nothing, and never
 * consumes a key (game input is routed through InputSystem, not the DOM).
 */
export class GameRootScreen extends Screen {
  readonly name = 'game-root';

  protected build(): HTMLElement {
    const root = div('screen-frame');
    root.style.background = 'none';
    root.style.pointerEvents = 'none';
    root.style.animation = 'none';
    return root;
  }

  onKey(): boolean {
    return false;
  }
}

export interface ChoiceOption {
  key: string;
  title: string;
  detail: string;
}

export interface ChoiceScreenOptions {
  name: string;
  headline: string;
  sub: string;
  options: readonly [ChoiceOption, ChoiceOption];
  onChoose: (key: string) => void;
}

/** Left/right + Enter modal. Used for COIN_TOSS and POINT_AFTER_CHOICE. */
export class ChoiceScreen extends Screen {
  readonly name: string;
  override readonly overlay = true;

  private index = 0;
  private nodes: HTMLElement[] = [];
  private decided = false;

  constructor(private readonly opts: ChoiceScreenOptions) {
    super();
    this.name = opts.name;
  }

  protected build(): HTMLElement {
    const root = div('screen-frame');
    const center = div('modal-center');
    const modal = div('modal');
    append(modal, div('modal-title', this.opts.headline), div('modal-sub', this.opts.sub));

    const pair = div('choice-pair');
    this.nodes = this.opts.options.map((opt) => {
      const node = div('choice focusable');
      append(node, div('choice-title', opt.title), div('choice-detail', opt.detail));
      pair.appendChild(node);
      return node;
    });
    modal.appendChild(pair);
    center.appendChild(modal);

    const legend = div('legend');
    append(legend, legendItem('← →', 'Choose'), legendItem('Enter', 'Confirm'));
    append(root, center, legend);
    this.renderChoice();
    return root;
  }

  private renderChoice(): void {
    this.nodes.forEach((node, i) => node.classList.toggle('focused', i === this.index));
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const dir = dirForCode(code);
    if (dir === 'left' || dir === 'right') {
      const next = dir === 'left' ? 0 : 1;
      if (next !== this.index) {
        this.index = next;
        this.renderChoice();
        this.blip('menuMove');
      }
      return true;
    }
    if (isConfirm(code)) {
      if (this.decided) return true;
      const opt = this.opts.options[this.index];
      if (!opt) return true;
      this.decided = true;
      this.blip('menuSelect');
      this.opts.onChoose(opt.key);
      return true;
    }
    return true; // modal: swallow everything else
  }
}

function legendItem(keys: string, label: string): HTMLElement {
  const item = div('legend-item');
  append(item, span('legend-key', keys), span('legend-label', label));
  return item;
}
