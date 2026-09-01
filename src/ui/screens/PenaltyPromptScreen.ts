import { Screen } from '../Screen';
import { append, div, span } from '../dom';
import { dirForCode, eventCode, isConfirm } from '../focus';
import { buildPenaltyPrompt, preferredPenaltyChoice } from '../format';
import type { PenaltyPromptRequest } from '../UiServices';

const TICK_MS = 100;

/** Accept / decline a flag. Auto-picks the better outcome when the timer runs out. */
export class PenaltyPromptScreen extends Screen {
  readonly name = 'penalty-prompt';
  override readonly overlay = true;

  private choice: 'accept' | 'decline' = 'accept';
  private acceptNode!: HTMLElement;
  private declineNode!: HTMLElement;
  private timerFill!: HTMLElement;
  private remainingMs: number;
  private handle: number | null = null;
  private decided = false;

  constructor(private readonly request: PenaltyPromptRequest) {
    super();
    this.remainingMs = Math.max(0, request.autoPickSeconds) * 1000;
    this.choice = preferredPenaltyChoice(request.decision);
  }

  protected build(): HTMLElement {
    const text = buildPenaltyPrompt(this.request.decision, {
      abbrevs: this.request.abbrevs,
      offenderName: this.request.offenderName,
      offenderJersey: this.request.offenderJersey,
    });

    const root = div('screen-frame');
    const center = div('modal-center');
    const modal = div('modal');
    append(
      modal,
      div('modal-title warn', text.headline),
      div('modal-sub', text.offender === '' ? text.decidingLabel : `${text.offender} · ${text.decidingLabel}`),
    );

    const pair = div('choice-pair');
    this.acceptNode = div('choice focusable');
    append(
      this.acceptNode,
      div('choice-title', 'Accept'),
      div('choice-detail', stripVerb(text.acceptLine)),
    );
    this.declineNode = div('choice focusable');
    append(
      this.declineNode,
      div('choice-title', 'Decline'),
      div('choice-detail', stripVerb(text.declineLine)),
    );
    append(pair, this.acceptNode, this.declineNode);
    modal.appendChild(pair);

    const bar = div('timer-bar');
    this.timerFill = div('timer-fill');
    this.timerFill.style.width = '100%';
    bar.appendChild(this.timerFill);
    if (this.request.autoPickSeconds > 0) modal.appendChild(bar);
    modal.appendChild(div('faint', this.request.autoPickSeconds > 0
      ? `No choice in ${this.request.autoPickSeconds}s takes the better result automatically.`
      : ''));

    center.appendChild(modal);
    const legend = div('legend');
    append(
      legend,
      legendItem('← →', 'Choose'),
      legendItem('Enter', 'Confirm'),
    );
    append(root, center, legend);
    this.renderChoice();
    return root;
  }

  onEnter(): void {
    if (this.request.autoPickSeconds <= 0) return;
    this.handle = window.setInterval(() => this.tick(), TICK_MS);
  }

  onExit(): void {
    this.stopTimer();
  }

  protected onDispose(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.handle !== null) {
      window.clearInterval(this.handle);
      this.handle = null;
    }
  }

  private tick(): void {
    this.remainingMs -= TICK_MS;
    const total = Math.max(1, this.request.autoPickSeconds * 1000);
    this.timerFill.style.width = `${Math.max(0, (this.remainingMs / total) * 100).toFixed(1)}%`;
    if (this.remainingMs <= 0) this.decide(preferredPenaltyChoice(this.request.decision));
  }

  private renderChoice(): void {
    this.acceptNode.classList.toggle('focused', this.choice === 'accept');
    this.declineNode.classList.toggle('focused', this.choice === 'decline');
  }

  private decide(choice: 'accept' | 'decline'): void {
    if (this.decided) return;
    this.decided = true;
    this.stopTimer();
    this.blip('menuSelect');
    this.request.onDecide(choice);
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const dir = dirForCode(code);
    if (dir === 'left' || dir === 'right') {
      const next = dir === 'left' ? 'accept' : 'decline';
      if (next !== this.choice) {
        this.choice = next;
        this.renderChoice();
        this.blip('menuMove');
      }
      return true;
    }
    if (isConfirm(code)) {
      this.decide(this.choice);
      return true;
    }
    return true; // modal: swallow everything else
  }
}

function stripVerb(line: string): string {
  const i = line.indexOf(': ');
  return i >= 0 ? line.slice(i + 2) : line;
}

function legendItem(keys: string, label: string): HTMLElement {
  const item = div('legend-item');
  append(item, span('legend-key', keys), span('legend-label', label));
  return item;
}
