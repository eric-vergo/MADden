import { Screen } from '../Screen';
import { append, clear, div, num, screenFrame, span, table } from '../dom';
import { cycle, eventCode, isBack, isConfirm, tabDeltaForCode } from '../focus';
import {
  STAT_GROUPS, buildLineScore, buildPlayerTables, buildTeamComparison, pickPlayerOfTheGame,
  type StatGroup,
} from '../tables';
import type { BoxScoreView } from '../UiServices';

export interface GameSummaryOptions {
  view: BoxScoreView;
  /** Post-game (true) vs. browsing an old box score from the schedule. */
  final: boolean;
  onDone?: () => void;
}

export class GameSummaryScreen extends Screen {
  readonly name = 'game-summary';

  private groupIndex = 0;
  private tabsNode!: HTMLElement;
  private tablesNode!: HTMLElement;

  constructor(private readonly opts: GameSummaryOptions) {
    super();
  }

  protected build(): HTMLElement {
    const view = this.opts.view;
    const frame = screenFrame(this.opts.final ? 'Final' : 'Box Score', view.label, [
      { keys: 'Tab / Q E', label: 'Offense · Defense · Special' },
      { keys: 'Enter', label: this.opts.final ? 'Continue' : 'Back' },
      { keys: 'Esc', label: 'Back' },
    ]);

    const top = div('row');
    top.style.alignItems = 'flex-start';
    top.style.gap = '18px';

    const scorePanel = div('panel col grow');
    scorePanel.appendChild(div('panel-title', 'Line score'));
    const line = buildLineScore(view.stats, view.homeAbbrev, view.awayAbbrev);
    scorePanel.appendChild(table({
      columns: line.headers,
      columnClasses: line.headers.map((_, i) => (i === 0 ? '' : 'right')),
      rows: line.rows.map((r) => ({
        className: r.isWinner ? 'winner-row' : undefined,
        cells: [r.label, ...r.cells, `${r.total}`],
      })),
    }));
    const finalLine = div('final-line');
    append(
      finalLine,
      span('dim', view.awayName), num(`${view.stats.teams[1].points}`, 'final-score'),
      span('dim', '—'),
      num(`${view.stats.teams[0].points}`, 'final-score'), span('dim', view.homeName),
    );
    scorePanel.appendChild(finalLine);
    top.appendChild(scorePanel);

    const potg = pickPlayerOfTheGame(view.stats, view.teamOf);
    if (potg) {
      const card = div('potg');
      append(
        card,
        div('potg-label', 'Player of the game'),
        div('potg-name', `${view.nameOf(potg.athleteId)} · ${view.posOf(potg.athleteId)} · ${view.teamOf(potg.athleteId) === 0 ? view.homeAbbrev : view.awayAbbrev}`),
        div('potg-line', potg.line),
      );
      const wrap = div('col');
      wrap.style.minWidth = '300px';
      wrap.appendChild(card);
      top.appendChild(wrap);
    }
    frame.body.appendChild(top);

    const grid = div('summary-grid');
    const comparePanel = div('panel col scroll');
    comparePanel.appendChild(div('panel-title', `${view.awayAbbrev} vs ${view.homeAbbrev}`));
    for (const row of buildTeamComparison(view.stats)) {
      const r = div('compare-row');
      append(
        r,
        span(`compare-val${row.better === 'away' ? ' better' : ''}`, row.away),
        span('compare-label', row.label),
        span(`compare-val right${row.better === 'home' ? ' better' : ''}`, row.home),
      );
      comparePanel.appendChild(r);
    }

    const statsPanel = div('panel col');
    this.tabsNode = div('tabs');
    this.tablesNode = div('col scroll grow');
    append(statsPanel, this.tabsNode, this.tablesNode);
    append(grid, comparePanel, statsPanel);
    frame.body.appendChild(grid);

    this.renderTables();
    return frame.root;
  }

  private renderTables(): void {
    const view = this.opts.view;
    clear(this.tabsNode);
    STAT_GROUPS.forEach((g, i) => {
      const node = div(i === this.groupIndex ? 'tab active' : 'tab', labelFor(g));
      this.tabsNode.appendChild(node);
    });
    clear(this.tablesNode);
    const group: StatGroup = STAT_GROUPS[this.groupIndex] ?? 'OFF';
    const tables = buildPlayerTables(view.stats, group, {
      nameOf: view.nameOf,
      teamOf: view.teamOf,
      abbrevs: [view.homeAbbrev, view.awayAbbrev],
      limitPerTable: 8,
    });
    for (const t of tables) {
      if (t.rows.length === 0) continue;
      this.tablesNode.appendChild(div('panel-title', t.title));
      this.tablesNode.appendChild(table({
        columns: ['Player', 'Tm', ...t.columns],
        columnClasses: ['', '', ...t.columns.map(() => 'right')],
        rows: t.rows.map((r) => ({ cells: [r.name, r.teamAbbrev, ...r.cells] })),
      }));
    }
    if (this.tablesNode.childElementCount === 0) {
      this.tablesNode.appendChild(div('dim', 'No stats recorded.'));
    }
  }

  private done(): void {
    this.blip('menuSelect');
    if (this.opts.onDone) this.opts.onDone();
    else if (this.opts.final) this.services.finishGameSummary();
    else this.manager.pop();
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    if (code === 'Tab') {
      this.groupIndex = cycle(this.groupIndex, e.shiftKey ? -1 : 1, STAT_GROUPS.length);
      this.renderTables();
      this.blip('menuMove');
      return true;
    }
    const delta = tabDeltaForCode(code);
    if (delta !== 0) {
      this.groupIndex = cycle(this.groupIndex, delta, STAT_GROUPS.length);
      this.renderTables();
      this.blip('menuMove');
      return true;
    }
    if (isConfirm(code)) {
      this.done();
      return true;
    }
    if (isBack(code)) {
      this.blip('menuBack');
      if (this.opts.final) this.done();
      else this.manager.pop();
      return true;
    }
    return false;
  }
}

function labelFor(group: StatGroup): string {
  switch (group) {
    case 'OFF': return 'Offense';
    case 'DEF': return 'Defense';
    case 'ST': return 'Special Teams';
  }
}
