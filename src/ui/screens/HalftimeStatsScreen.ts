import type { TeamSide } from '../../sim/types';
import { Screen } from '../Screen';
import { append, div, num, screenFrame, span } from '../dom';
import { eventCode, isBack, isConfirm } from '../focus';
import { buildTeamComparison, rankStandouts } from '../tables';
import type { BoxScoreView } from '../UiServices';

export interface HalftimeOptions {
  view: BoxScoreView;
  onContinue?: () => void;
}

export class HalftimeStatsScreen extends Screen {
  readonly name = 'halftime';

  constructor(private readonly opts: HalftimeOptions) {
    super();
  }

  protected build(): HTMLElement {
    const view = this.opts.view;
    const frame = screenFrame('Halftime', view.label, [
      { keys: 'Enter', label: 'Second half' },
    ]);

    const scoreRow = div('final-line center');
    scoreRow.style.justifyContent = 'center';
    append(
      scoreRow,
      span('dim', view.awayAbbrev), num(`${view.stats.teams[1].points}`, 'final-score'),
      span('dim', '—'),
      num(`${view.stats.teams[0].points}`, 'final-score'), span('dim', view.homeAbbrev),
    );
    frame.body.appendChild(scoreRow);

    const grid = div('summary-grid');
    const comparePanel = div('panel col scroll');
    comparePanel.appendChild(div('panel-title', 'Team stats'));
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
    grid.appendChild(comparePanel);

    const leadersPanel = div('panel col scroll');
    leadersPanel.appendChild(div('panel-title', 'Standouts'));
    for (const side of [1, 0] as TeamSide[]) {
      const abbrev = side === 0 ? view.homeAbbrev : view.awayAbbrev;
      leadersPanel.appendChild(div('chip', abbrev));
      const standouts = rankStandouts(view.stats, view.teamOf, { onlyTeam: side, limit: 3 });
      if (standouts.length === 0) leadersPanel.appendChild(div('faint', 'Nothing doing yet.'));
      for (const s of standouts) {
        const row = div('star-row');
        const col = div('col grow');
        col.style.gap = '2px';
        append(
          col,
          div('star-name', `${view.nameOf(s.athleteId)} · ${view.posOf(s.athleteId)}`),
          div('faint', s.line),
        );
        row.appendChild(col);
        leadersPanel.appendChild(row);
      }
    }
    grid.appendChild(leadersPanel);
    frame.body.appendChild(grid);

    const btn = div('btn primary focused center', 'Start Second Half');
    frame.body.appendChild(btn);
    return frame.root;
  }

  onKey(e: KeyboardEvent): boolean {
    const code = eventCode(e);
    if (isConfirm(code) || isBack(code)) {
      this.blip('menuSelect');
      if (this.opts.onContinue) this.opts.onContinue();
      else this.services.continueFromHalftime();
      return true;
    }
    return true; // modal-ish: nothing else to do here
  }
}
