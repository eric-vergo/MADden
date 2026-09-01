import type { ScheduledGame, TeamIdentity } from '../../meta/types';
import { Screen, FocusRing, type FocusEntry } from '../Screen';
import { append, applyAccent, clear, div, num, screenFrame, span, table } from '../dom';
import { cycle, dirForCode, eventCode, isBack, isConfirm, tabDeltaForCode } from '../focus';
import { formatRecord } from '../format';
import {
  LEADER_CATEGORIES, buildLeaders, buildStandings, type LeaderCategoryDef,
} from '../tables';
import { ChampionScreen } from './ChampionScreen';
import { GameSummaryScreen } from './GameSummaryScreen';

const TABS = ['Overview', 'Schedule', 'Standings', 'Leaders', 'Bracket'] as const;
type TabName = (typeof TABS)[number];

const CONFERENCES = ['Atlantic', 'Pacific'] as const;

export class SeasonHubScreen extends Screen {
  readonly name = 'season-hub';

  private readonly ring = new FocusRing({ wrapX: true, wrapY: false });
  private tabIndex = 0;
  private confIndex = 0;
  private categoryIndex = 0;
  private tabNodes: HTMLElement[] = [];
  private content!: HTMLElement;
  private subtitle!: HTMLElement;
  private actions: Array<{ key: string; run: () => void }> = [];

  protected build(): HTMLElement {
    const frame = screenFrame('Season Hub', '', [
      { keys: 'Q / E', label: 'Tabs' },
      { keys: '↑↓←→', label: 'Navigate' },
      { keys: 'Enter', label: 'Select' },
      { keys: 'Esc', label: 'Save & exit' },
    ]);
    this.subtitle = frame.subtitle;

    const tabs = div('tabs');
    this.tabNodes = TABS.map((t) => {
      const node = div('tab', t.toUpperCase());
      tabs.appendChild(node);
      return node;
    });
    this.content = div('col grow');
    append(frame.body, tabs, this.content);
    return frame.root;
  }

  onEnter(): void {
    this.renderTab();
  }

  private identities(): Map<string, TeamIdentity> {
    const map = new Map<string, TeamIdentity>();
    for (const id of this.services.getIdentities()) map.set(id.id, id);
    return map;
  }

  private renderHeader(): void {
    const season = this.services.getSeason();
    if (!season) {
      this.subtitle.textContent = 'No season loaded';
      return;
    }
    const team = this.services.getTeam(season.userTeamId);
    const standings = this.services.getStandings().find((r) => r.teamId === season.userTeamId);
    const record = standings ? formatRecord(standings.w, standings.l, standings.t) : '0-0';
    if (team) applyAccent(this.el, team.identity.colors);
    const name = team ? `${team.identity.city} ${team.identity.nickname}` : season.userTeamId;
    this.subtitle.textContent = `${name} · Season ${season.league.seasonIndex + 1} · Week ${season.currentWeek} · ${record}`;
  }

  private renderTab(): void {
    this.renderHeader();
    this.tabNodes.forEach((node, i) => node.classList.toggle('active', i === this.tabIndex));
    clear(this.content);
    this.actions = [];
    const entries: FocusEntry[] = [];
    const tab: TabName = TABS[this.tabIndex] ?? 'Overview';
    switch (tab) {
      case 'Overview': this.renderOverview(entries); break;
      case 'Schedule': this.renderSchedule(entries); break;
      case 'Standings': this.renderStandings(); break;
      case 'Leaders': this.renderLeaders(); break;
      case 'Bracket': this.renderBracket(entries); break;
    }
    if (tab === 'Schedule') this.ring.setList(entries);
    else this.ring.setGrid(entries, Math.max(1, entries.length));
  }

  // --- tabs ----------------------------------------------------------------

  private renderOverview(entries: FocusEntry[]): void {
    const next = this.services.getNextGame();
    const layout = div('hub-overview');
    const left = div('panel col');
    const right = div('panel col');
    append(layout, left, right);
    this.content.appendChild(layout);

    if (!next) {
      left.appendChild(div('panel-title', 'Season complete'));
      left.appendChild(div('dim', 'Head to the Bracket tab for the Apex Bowl result.'));
      return;
    }

    left.appendChild(div('panel-title', `Next up · ${next.roundLabel}`));
    const away = next.weekGames.find((g) => g.isUserGame) ?? next.weekGames[0];
    const matchup = div('matchup');
    if (away) {
      const awayCol = div('matchup-team');
      append(awayCol, div('matchup-abbrev', away.awayAbbrev), div('matchup-name', away.awayName));
      const homeCol = div('matchup-team right');
      append(homeCol, div('matchup-abbrev', away.homeAbbrev), div('matchup-name', away.homeName));
      append(matchup, awayCol, div('matchup-at', '@'), homeCol);
    }
    left.appendChild(matchup);
    left.appendChild(div('dim', `You: ${next.userRecord} · Opponent: ${next.opponentRecord} · ${next.userIsHome ? 'Home' : 'Away'}`));

    const canPlay = !next.userGameResolved;
    const buttons: Array<{ key: string; label: string; enabled: boolean; run: () => void }> = [
      { key: 'play', label: 'Play Game', enabled: canPlay, run: () => this.services.playUserGame() },
      { key: 'sim-me', label: 'Sim My Game', enabled: canPlay, run: () => { this.services.simUserGame(); this.renderTab(); } },
      { key: 'sim-week', label: 'Sim Week', enabled: next.userGameResolved, run: () => { this.services.simWeek(); this.renderTab(); } },
    ];
    const row = div('btn-row');
    for (const b of buttons) {
      const node = div('btn focusable grow');
      node.textContent = b.label.toUpperCase();
      row.appendChild(node);
      entries.push({ el: node, enabled: b.enabled, key: b.key });
      this.actions.push({ key: b.key, run: b.run });
    }
    left.appendChild(row);
    if (!canPlay) left.appendChild(div('faint', 'Your game is in the books — sim the rest of the week.'));

    right.appendChild(div('panel-title', 'Around the league'));
    const list = div('week-list scroll');
    for (const g of next.weekGames) {
      const rowEl = div(g.isUserGame ? 'week-row user' : 'week-row');
      append(
        rowEl,
        span(undefined, `${g.awayAbbrev} @ ${g.homeAbbrev}`),
        num(g.scoreLine === '' ? '—' : g.scoreLine),
      );
      list.appendChild(rowEl);
    }
    right.appendChild(list);
  }

  private renderSchedule(entries: FocusEntry[]): void {
    const panel = div('panel col grow');
    panel.appendChild(div('panel-title', 'Your schedule — Enter opens the box score'));
    const list = div('week-list scroll grow');
    const games = this.services.getUserSchedule();
    for (const g of games) {
      const rowEl = div('week-row focusable');
      append(
        rowEl,
        span(undefined, `WK ${g.game.week}  ${g.awayAbbrev} @ ${g.homeAbbrev}`),
        num(g.userResult === '' ? '—' : g.userResult),
      );
      list.appendChild(rowEl);
      entries.push({ el: rowEl, key: g.game.id });
      this.actions.push({
        key: g.game.id,
        run: () => {
          const view = g.game.result === undefined ? null : this.services.getBoxScoreView(g.game.id);
          if (!view) {
            this.blip('menuError');
            return;
          }
          this.manager.push(new GameSummaryScreen({ view, final: true }));
        },
      });
    }
    panel.appendChild(list);
    this.content.appendChild(panel);
  }

  private renderStandings(): void {
    const conference = CONFERENCES[this.confIndex] ?? 'Atlantic';
    const header = div('row');
    append(
      header,
      span('option-arrow', '◀'),
      span('panel-title', `${conference} Conference`),
      span('option-arrow', '▶'),
    );
    this.content.appendChild(header);

    const season = this.services.getSeason();
    const groups = buildStandings(
      this.services.getIdentities(),
      this.services.getStandings(),
      { conference, userTeamId: season?.userTeamId },
    );
    const cols = div('standings-cols grow');
    for (const group of groups) {
      const panel = div('panel col scroll');
      panel.appendChild(div('panel-title', group.division));
      panel.appendChild(table({
        columns: ['Team', 'W-L', 'PCT', 'DIV', 'PF', 'PA', 'DIFF'],
        columnClasses: ['', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows: group.rows.map((r) => ({
          className: r.isUser ? 'user-row' : undefined,
          cells: [r.name, r.record, r.pct, r.divRecord, `${r.pf}`, `${r.pa}`, r.diff],
        })),
      }));
      cols.appendChild(panel);
    }
    this.content.appendChild(cols);
  }

  private renderLeaders(): void {
    const category: LeaderCategoryDef = LEADER_CATEGORIES[this.categoryIndex] ?? LEADER_CATEGORIES[0]!;
    const header = div('row');
    append(
      header,
      span('option-arrow', '◀'),
      span('panel-title', category.label),
      span('option-arrow', '▶'),
    );
    this.content.appendChild(header);

    const season = this.services.getSeason();
    const identities = this.identities();
    const rows = buildLeaders(this.services.getSeasonStats(), category.id, {
      nameOf: (id) => this.services.playerName(id),
      abbrevOf: (teamId) => identities.get(teamId)?.id ?? teamId,
      userTeamId: season?.userTeamId,
      limit: 10,
    });
    const panel = div('panel col grow scroll');
    panel.appendChild(table({
      columns: ['#', 'Player', 'Team', category.valueHeader, 'Detail'],
      columnClasses: ['right', '', '', 'right', ''],
      rows: rows.map((r) => ({
        className: r.isUser ? 'user-row' : undefined,
        cells: [`${r.rank}`, r.name, r.teamAbbrev, r.value, r.detail],
      })),
    }));
    this.content.appendChild(panel);
  }

  private renderBracket(entries: FocusEntry[]): void {
    const bracket = this.services.getBracket();
    const panel = div('panel col grow');
    panel.appendChild(div('panel-title', 'Playoff bracket'));
    if (!bracket) {
      panel.appendChild(div('dim', 'Seeds are set after week 14.'));
      this.content.appendChild(panel);
      return;
    }
    const identities = this.identities();
    const abbrev = (id: string): string => identities.get(id)?.id ?? id;
    const rounds: Array<[string, number]> = [
      ['Conference Semifinals', 15],
      ['Conference Championships', 16],
      ['Apex Bowl', 17],
    ];
    const grid = div('bracket');
    for (const [label, week] of rounds) {
      const col = div('bracket-col');
      col.appendChild(div('panel-title', label));
      const games = bracket.games.filter((g) => g.week === week);
      if (games.length === 0) col.appendChild(div('faint', 'TBD'));
      for (const g of games) col.appendChild(bracketGame(g, abbrev));
      grid.appendChild(col);
    }
    panel.appendChild(grid);

    const champion = this.services.getChampionInfo();
    if (champion) {
      const node = div('btn primary focusable', 'Apex Bowl Ceremony');
      panel.appendChild(node);
      entries.push({ el: node, key: 'ceremony' });
      this.actions.push({ key: 'ceremony', run: () => this.manager.push(new ChampionScreen()) });
    }
    this.content.appendChild(panel);
  }

  // --- input ---------------------------------------------------------------

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    const tabDelta = tabDeltaForCode(code);
    if (tabDelta !== 0) {
      this.tabIndex = cycle(this.tabIndex, tabDelta, TABS.length);
      this.blip('menuMove');
      this.renderTab();
      return true;
    }
    const dir = dirForCode(code);
    const tab: TabName = TABS[this.tabIndex] ?? 'Overview';
    if (dir === 'left' || dir === 'right') {
      const delta = dir === 'right' ? 1 : -1;
      if (tab === 'Standings') {
        this.confIndex = cycle(this.confIndex, delta, CONFERENCES.length);
        this.blip('menuMove');
        this.renderTab();
        return true;
      }
      if (tab === 'Leaders') {
        this.categoryIndex = cycle(this.categoryIndex, delta, LEADER_CATEGORIES.length);
        this.blip('menuMove');
        this.renderTab();
        return true;
      }
    }
    if (dir) {
      if (this.ring.move(dir)) this.blip('menuMove');
      return true;
    }
    if (isConfirm(code)) {
      const key = this.ring.currentKey();
      const entry = this.ring.current();
      if (key === undefined || entry?.enabled === false) {
        this.blip('menuError');
        return true;
      }
      const action = this.actions.find((a) => a.key === key);
      if (!action) {
        this.blip('menuError');
        return true;
      }
      this.blip('menuSelect');
      action.run();
      return true;
    }
    if (isBack(code)) {
      this.blip('menuBack');
      this.services.saveAndExit();
      this.manager.pop();
      return true;
    }
    return false;
  }
}

function bracketGame(game: ScheduledGame, abbrev: (id: string) => string): HTMLElement {
  const node = div('bracket-game');
  const r = game.result;
  const homeWin = r !== undefined && r.homeScore > r.awayScore;
  const awayWin = r !== undefined && r.awayScore > r.homeScore;
  const line = (teamId: string, score: number | null, win: boolean): HTMLElement => {
    const row = div(win ? 'bg-team win' : 'bg-team');
    append(row, span(undefined, abbrev(teamId)), num(score === null ? '—' : `${score}`));
    return row;
  };
  append(
    node,
    line(game.awayId, r ? r.awayScore : null, awayWin),
    line(game.homeId, r ? r.homeScore : null, homeWin),
  );
  if (r?.ot) node.appendChild(div('faint', 'OT'));
  return node;
}
