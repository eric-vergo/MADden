import type { Team } from '../../meta/types';
import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, applyAccent, clear, div, num, ratingBar, screenFrame, span } from '../dom';
import { dirForCode, isBack, isConfirm } from '../focus';
import { ratingTier } from '../format';

export interface TeamSelectOptions {
  mode: 'exhibition' | 'season';
  /** exhibition → [awayId, homeId]; season → [userTeamId]. */
  onDone: (teamIds: string[]) => void;
}

const CONFERENCES = ['Atlantic', 'Pacific'] as const;
const DIVISIONS = ['North', 'South'] as const;

export class TeamSelectScreen extends Screen {
  readonly name = 'team-select';

  private readonly ring = new FocusRing({ wrapX: false, wrapY: false, onChange: () => this.renderDetail() });
  private ordered: Team[] = [];
  private picks: string[] = [];
  private cards: HTMLElement[] = [];
  private detail!: HTMLElement;
  private subtitle!: HTMLElement;

  constructor(private readonly opts: TeamSelectOptions) {
    super();
  }

  private get picksNeeded(): number {
    return this.opts.mode === 'exhibition' ? 2 : 1;
  }

  protected build(): HTMLElement {
    const frame = screenFrame('Team Select', '', [
      { keys: '↑↓←→', label: 'Move' },
      { keys: 'Enter', label: 'Select' },
      { keys: 'Esc', label: 'Back' },
    ]);
    this.subtitle = frame.subtitle;

    const layout = div('select-layout');
    const gridWrap = div('division-grid scroll');
    const detailPanel = div('panel detail');
    this.detail = detailPanel;
    append(layout, gridWrap, detailPanel);
    frame.body.appendChild(layout);

    this.ordered = orderTeams(this.services.getTeams());
    const entries: FocusEntry[] = [];
    this.cards = [];
    let i = 0;
    for (const conf of CONFERENCES) {
      for (const divName of DIVISIONS) {
        const block = div('division');
        block.appendChild(div('division-name', `${conf}\n${divName}`.replace('\n', ' ')));
        for (let k = 0; k < 4; k++) {
          const team = this.ordered[i];
          i++;
          if (!team) continue;
          const card = this.buildCard(team);
          block.appendChild(card);
          this.cards.push(card);
          entries.push({ el: card, key: team.identity.id });
        }
        gridWrap.appendChild(block);
      }
    }
    this.ring.setGrid(entries, 4);
    return frame.root;
  }

  onEnter(): void {
    this.renderPrompt();
    this.renderDetail();
  }

  private buildCard(team: Team): HTMLElement {
    const card = div('team-card focusable');
    card.style.setProperty('--card-primary', team.identity.colors.primary);
    card.style.setProperty('--card-secondary', team.identity.colors.secondary);
    append(
      card,
      div('tc-abbrev', team.identity.id),
      div('tc-name', `${team.identity.city} ${team.identity.nickname}`),
    );
    const ovr = div('tc-ovr');
    append(
      ovr,
      span(undefined, 'OVR '), span(`ovr-${ratingTier(team.ovr)}`, `${team.ovr}`),
      span(undefined, ' OFF '), span(undefined, `${team.off}`),
      span(undefined, ' DEF '), span(undefined, `${team.def}`),
    );
    card.appendChild(ovr);
    return card;
  }

  private renderPrompt(): void {
    if (this.opts.mode === 'season') {
      this.subtitle.textContent = 'Choose the franchise you will coach';
      return;
    }
    this.subtitle.textContent = this.picks.length === 0 ? 'Select away team' : 'Select home team';
  }

  private renderDetail(): void {
    const team = this.ordered[this.ring.index];
    clear(this.detail);
    if (!team) return;
    applyAccent(this.el, team.identity.colors);

    const header = div('detail-header');
    append(
      header,
      div('detail-city', team.identity.city),
      div('detail-nick', team.identity.nickname),
      div('faint', `${team.identity.conference} ${team.identity.division}`),
    );
    const colors = div('detail-colors');
    for (const c of [team.identity.colors.primary, team.identity.colors.secondary]) {
      const sw = div('swatch');
      sw.style.background = c;
      colors.appendChild(sw);
    }
    header.appendChild(colors);
    this.detail.appendChild(header);

    for (const [label, value] of [['OVR', team.ovr], ['OFF', team.off], ['DEF', team.def]] as const) {
      const row = div('rating-row');
      append(row, span(undefined, label), ratingBar(value), num(`${value}`, `ovr-${ratingTier(value)}`));
      this.detail.appendChild(row);
    }

    this.detail.appendChild(div('panel-title', 'Top players'));
    for (const star of this.services.getTopStars(team.identity.id, 3)) {
      const row = div('star-row');
      append(
        row,
        span('star-pos', star.pos),
        span('star-name', `${star.name} · #${star.jersey}`),
        span('star-sig', `${star.signatureKey.toUpperCase()} ${star.signatureValue}`),
        num(`${star.overall}`, `star-ovr ovr-${ratingTier(star.overall)}`),
      );
      this.detail.appendChild(row);
    }

    if (this.picks.length > 0) {
      const picked = this.picks.map((id) => id).join('  @  ');
      this.detail.appendChild(div('chip', `AWAY: ${picked}`));
    }
  }

  private markPicks(): void {
    this.cards.forEach((card, i) => {
      const id = this.ordered[i]?.identity.id;
      const taken = id !== undefined && this.picks.includes(id);
      card.classList.toggle('taken', taken);
      card.classList.toggle('picked', taken);
    });
  }

  onKey(e: KeyboardEvent): boolean {
    const dir = dirForCode(e.code);
    if (dir) {
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (isConfirm(e.code)) {
      const team = this.ordered[this.ring.index];
      if (!team) return true;
      const id = team.identity.id;
      if (this.picks.includes(id)) {
        this.blip('menuError');
        return true;
      }
      this.picks.push(id);
      this.blip('menuSelect');
      if (this.picks.length >= this.picksNeeded) {
        this.opts.onDone([...this.picks]);
        // The caller pushed the next screen; leave our picks intact so Esc
        // from there lands back on the last choice.
        this.picks.pop();
        this.markPicks();
        this.renderPrompt();
        return true;
      }
      this.markPicks();
      this.renderPrompt();
      this.renderDetail();
      return true;
    }
    if (isBack(e.code)) {
      this.blip('menuBack');
      if (this.picks.length > 0) {
        this.picks.pop();
        this.markPicks();
        this.renderPrompt();
        this.renderDetail();
      } else {
        this.manager.pop();
      }
      return true;
    }
    return false;
  }
}

/** Fixed display order: conference → division → team id. */
export function orderTeams(teams: readonly Team[]): Team[] {
  const out: Team[] = [];
  for (const conf of CONFERENCES) {
    for (const divName of DIVISIONS) {
      const group = teams
        .filter((t) => t.identity.conference === conf && t.identity.division === divName)
        .sort((a, b) => (a.identity.id < b.identity.id ? -1 : a.identity.id > b.identity.id ? 1 : 0));
      out.push(...group);
    }
  }
  // Anything with an unexpected conference/division still gets shown.
  for (const t of teams) if (!out.includes(t)) out.push(t);
  return out;
}
