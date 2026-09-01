import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { accentFor, append, applyAccent, clear, div, num, screenFrame, span } from '../dom';
import { cycle, dirForCode, eventCode, isBack, isConfirm, tabDeltaForCode } from '../focus';
import { formatClock, formatDownDistance, formatSpot } from '../format';
import { DEFAULT_PAINT, buildPlayDiagram, drawPlayDiagram, type DiagramPaint } from '../routeDiagram';
import type { PlayCallRequest, PlayCallSituation, PlayCardInfo } from '../UiServices';
import { PauseScreen } from './PauseScreen';

const CARDS_PER_PAGE = 6;
const GRID_COLS = 3;

export class PlayCallScreen extends Screen {
  readonly name = 'play-call';

  private readonly formationRing = new FocusRing({ wrapY: true, onChange: () => this.onFormationChanged() });
  private readonly playRing = new FocusRing({ wrapX: false, wrapY: false });
  private panel: 'formations' | 'plays' = 'plays';
  private groupIndex = 0;
  private page = 0;
  private coach: ReadonlySet<string> | null = null;

  private situation: PlayCallSituation;
  private formationList!: HTMLElement;
  private grid!: HTMLElement;
  private situationBar!: HTMLElement;
  private playClockNode!: HTMLElement;
  private coachBanner!: HTMLElement;
  private pageNote!: HTMLElement;
  private canvases: Array<{ canvas: HTMLCanvasElement; card: PlayCardInfo }> = [];
  private readonly onResize = (): void => this.layoutDiagrams();

  constructor(private readonly request: PlayCallRequest) {
    super();
    this.situation = request.situation;
  }

  protected build(): HTMLElement {
    const frame = screenFrame(
      this.request.side === 'offense' ? 'Play Call' : 'Defensive Call',
      '',
      [
        { keys: '↑↓←→', label: 'Move' },
        { keys: 'Enter', label: 'Call play' },
        { keys: 'Q / E', label: 'Page' },
        { keys: 'C', label: 'Ask coach' },
        { keys: 'T', label: 'Timeout' },
        { keys: 'Esc', label: 'Pause' },
      ],
    );
    applyAccent(frame.root, this.request.colors);

    this.situationBar = div('situation');
    this.playClockNode = span('playclock', '40');
    this.coachBanner = div('coach-banner');
    this.pageNote = span('faint');

    const layout = div('playcall');
    this.formationList = div('formation-list scroll');
    this.grid = div('play-grid');
    append(layout, this.formationList, this.grid);
    append(frame.body, this.situationBar, this.coachBanner, layout);

    this.buildFormationList();
    this.renderGrid();
    this.renderSituation();
    return frame.root;
  }

  onEnter(): void {
    window.addEventListener('resize', this.onResize);
    this.layoutDiagrams();
    window.requestAnimationFrame(() => this.layoutDiagrams());
  }

  onExit(): void {
    window.removeEventListener('resize', this.onResize);
  }

  protected onDispose(): void {
    window.removeEventListener('resize', this.onResize);
  }

  // --- public updates from the game loop -----------------------------------

  setSituation(situation: PlayCallSituation): void {
    this.situation = situation;
    this.renderSituation();
  }

  setPlayClock(sec: number): void {
    this.situation = { ...this.situation, playClockSec: sec };
    this.playClockNode.textContent = `${Math.max(0, Math.ceil(sec))}`;
    this.playClockNode.classList.toggle('hot', sec <= 5);
  }

  // --- rendering -----------------------------------------------------------

  private renderSituation(): void {
    const s = this.situation;
    clear(this.situationBar);
    append(
      this.situationBar,
      span(undefined, formatDownDistance(s.down, s.toGo, s.goalToGo)),
      span('faint', '·'),
      span(undefined, `BALL ON ${formatSpot(s.ballOnY, s.homeAbbrev, s.awayAbbrev)}`),
      span('faint', '·'),
      span(undefined, `Q${s.quarter}`),
      num(formatClock(s.clockSec), 'pc-clock'),
      div('spacer'),
      span(undefined, `${s.awayAbbrev} ${s.score[1]} — ${s.homeAbbrev} ${s.score[0]}`),
      span('faint', 'PLAY CLOCK'),
      this.playClockNode,
    );
    this.setPlayClock(s.playClockSec);
  }

  private buildFormationList(): void {
    clear(this.formationList);
    const entries: FocusEntry[] = [];
    this.request.groups.forEach((group, i) => {
      const node = div('formation-item focusable');
      append(
        node,
        div('formation-name', group.label),
        div('formation-meta', [
          group.personnel === undefined ? '' : `${group.personnel} PERS`,
          `${group.cards.length} ${group.cards.length === 1 ? 'PLAY' : 'PLAYS'}`,
        ].filter((s) => s !== '').join(' · ')),
      );
      const hasSuggestion = this.coach === null || group.cards.some((c) => this.coach?.has(c.playId));
      node.classList.toggle('dimmed', !hasSuggestion);
      node.classList.toggle('active', i === this.groupIndex);
      this.formationList.appendChild(node);
      entries.push({ el: node, key: group.id });
    });
    this.formationRing.setList(entries, true);
    this.formationRing.focus(this.groupIndex);
    if (this.panel !== 'formations') this.formationRing.clearFocusClass();
  }

  private currentCards(): PlayCardInfo[] {
    const group = this.request.groups[this.groupIndex];
    if (!group) return [];
    const start = this.page * CARDS_PER_PAGE;
    return group.cards.slice(start, start + CARDS_PER_PAGE);
  }

  private pageCount(): number {
    const group = this.request.groups[this.groupIndex];
    if (!group) return 1;
    return Math.max(1, Math.ceil(group.cards.length / CARDS_PER_PAGE));
  }

  private renderGrid(): void {
    clear(this.grid);
    this.canvases = [];
    const cards = this.currentCards();
    const entries: FocusEntry[] = [];
    for (const card of cards) {
      const node = div('play-card focusable');
      const suggested = this.coach?.has(card.playId) ?? false;
      if (this.coach !== null) {
        node.classList.toggle('suggested', suggested);
        node.classList.toggle('dimmed', !suggested);
      }
      const name = div('pc-name', card.name);
      node.appendChild(name);
      if (card.play) {
        const canvas = document.createElement('canvas');
        node.appendChild(canvas);
        this.canvases.push({ canvas, card });
      } else {
        const info = div('grow dim center');
        info.textContent = card.subtitle ?? '';
        node.appendChild(info);
      }
      const tags = div('pc-tags');
      for (const t of card.tags) tags.appendChild(span('chip', t));
      node.appendChild(tags);
      this.grid.appendChild(node);
      entries.push({ el: node, key: card.playId, enabled: this.coach === null || suggested });
    }
    for (let i = cards.length; i < CARDS_PER_PAGE; i++) {
      this.grid.appendChild(div('play-card empty'));
    }
    this.playRing.setGrid(entries, GRID_COLS);
    if (this.panel !== 'plays') this.playRing.clearFocusClass();

    const pages = this.pageCount();
    this.pageNote.textContent = pages > 1 ? `PAGE ${this.page + 1}/${pages}` : '';
    this.coachBanner.textContent = this.coach
      ? `COACH SUGGESTS ${this.coach.size} PLAY${this.coach.size === 1 ? '' : 'S'} — C TO CLEAR`
      : '';
    if (this.pageNote.parentElement === null) this.coachBanner.appendChild(this.pageNote);
    this.layoutDiagrams();
  }

  private onFormationChanged(): void {
    this.groupIndex = this.formationRing.index;
    this.page = 0;
    this.request.groups.forEach((_, i) => {
      this.formationList.children[i]?.classList.toggle('active', i === this.groupIndex);
    });
    this.renderGrid();
  }

  private layoutDiagrams(): void {
    // Routes and runs both ride the team accent; the run arrow is heavier so
    // the two still read apart at 150px wide.
    const teamInk = accentFor(this.request.colors);
    const paint: DiagramPaint = { ...DEFAULT_PAINT, routeColor: teamInk, runColor: teamInk };
    for (const { canvas, card } of this.canvases) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0 || !card.play) continue;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlayDiagram(ctx, buildPlayDiagram(card.play, card.formation, w, h), paint);
    }
  }

  // --- input ---------------------------------------------------------------

  private toggleCoach(): void {
    if (this.coach !== null) {
      this.coach = null;
      this.buildFormationList();
      this.renderGrid();
      this.blip('menuBack');
      return;
    }
    const ids = this.request.suggest().slice(0, 3);
    if (ids.length === 0) {
      this.blip('menuError');
      return;
    }
    this.coach = new Set(ids);
    const firstId = ids[0];
    const groupIdx = this.request.groups.findIndex((g) => g.cards.some((c) => c.playId === firstId));
    if (groupIdx >= 0) this.groupIndex = groupIdx;
    this.page = 0;
    this.panel = 'plays';
    this.buildFormationList();
    this.renderGrid();
    if (firstId !== undefined) this.playRing.focusKey(firstId);
    this.blip('menuSelect');
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    if (code === 'KeyC') {
      this.toggleCoach();
      return true;
    }
    if (code === 'KeyT') {
      if (this.request.onTimeout) {
        this.request.onTimeout();
        this.blip('timeoutHorn');
      } else {
        this.blip('menuError');
      }
      return true;
    }
    const tabDelta = tabDeltaForCode(code);
    if (tabDelta !== 0) {
      const pages = this.pageCount();
      if (pages > 1) {
        this.page = cycle(this.page, tabDelta, pages);
        this.renderGrid();
        this.blip('menuMove');
      } else {
        this.blip('menuError');
      }
      return true;
    }
    const dir = dirForCode(code);
    if (dir) {
      if (this.panel === 'formations') {
        if (dir === 'right') {
          this.panel = 'plays';
          this.formationRing.clearFocusClass();
          this.playRing.refresh();
          this.blip('menuMove');
          return true;
        }
        if (this.formationRing.move(dir)) this.blip('menuMove');
        return true;
      }
      if (this.playRing.move(dir)) {
        this.blip('menuMove');
        return true;
      }
      if (dir === 'left') {
        this.panel = 'formations';
        this.playRing.clearFocusClass();
        this.formationRing.refresh();
        this.blip('menuMove');
      }
      return true;
    }
    if (isConfirm(code)) {
      if (this.panel === 'formations') {
        this.panel = 'plays';
        this.formationRing.clearFocusClass();
        this.playRing.refresh();
        this.blip('menuSelect');
        return true;
      }
      const entry = this.playRing.current();
      const playId = this.playRing.currentKey();
      if (!entry || entry.enabled === false || playId === undefined) {
        this.blip('menuError');
        return true;
      }
      this.blip('menuSelect');
      this.request.onSelect(playId);
      return true;
    }
    if (isBack(code)) {
      this.blip('menuBack');
      this.manager.push(new PauseScreen());
      return true;
    }
    return false;
  }
}
