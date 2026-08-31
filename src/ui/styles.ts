// The whole UI stylesheet, injected once by ScreenManager (keeps the overlay
// self-contained — index.html only owns the #ui positioning).
// Dark broadcast aesthetic: near-black field of view, slate panels, one
// team-color accent per screen, monospace numerals for anything numeric.

export const UI_STYLE_ID = 'madden-ui-style';

export const UI_CSS = `
.mad-ui {
  --bg: #05080d;
  --bg-2: #0a0f16;
  --panel: #101823;
  --panel-2: #16202c;
  --panel-3: #1d2836;
  --line: #26323f;
  --line-soft: #1a2430;
  --text: #e9eff7;
  --text-dim: #8593a5;
  --text-faint: #5b6878;
  --accent: #e8b93e;
  --accent-2: #1b3a6b;
  --good: #55c98a;
  --bad: #e0645f;
  --warn: #f0b429;
  --mono: ui-monospace, 'SF Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace;
  --sans: 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif;
  position: absolute;
  inset: 0;
  color: var(--text);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.35;
  overflow: hidden;
}

.mad-ui *, .mad-ui *::before, .mad-ui *::after { box-sizing: border-box; }

.mad-ui .num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

/* --- screen stack ------------------------------------------------------- */

.mad-ui .screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 90% at 50% -10%, rgba(40,62,92,0.35), transparent 60%),
    linear-gradient(180deg, var(--bg-2), var(--bg));
  animation: mad-fade 140ms ease-out;
}
.mad-ui .screen[hidden] { display: none; }
.mad-ui .screen.overlay { background: rgba(3,6,11,0.72); backdrop-filter: blur(2px); }
.mad-ui .screen.behind { filter: brightness(0.55) saturate(0.7); }

@keyframes mad-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.mad-ui .screen-frame { display: flex; flex-direction: column; height: 100%; width: 100%; }

.mad-ui .screen-head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 18px 28px 12px;
  border-bottom: 1px solid var(--line-soft);
  position: relative;
}
.mad-ui .screen-head::after {
  content: '';
  position: absolute;
  left: 28px; bottom: -1px;
  width: 96px; height: 2px;
  background: var(--accent);
}
.mad-ui .screen-title {
  font-size: 26px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
}
.mad-ui .screen-sub { color: var(--text-dim); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }

.mad-ui .screen-body { flex: 1; min-height: 0; padding: 18px 28px; overflow: hidden; display: flex; flex-direction: column; gap: 14px; }

/* --- key legend --------------------------------------------------------- */

.mad-ui .legend {
  display: flex; flex-wrap: wrap; gap: 18px;
  padding: 10px 28px;
  border-top: 1px solid var(--line-soft);
  background: rgba(6,10,16,0.85);
  font-size: 12px;
}
.mad-ui .legend-item { display: flex; align-items: center; gap: 7px; }
.mad-ui .legend-key {
  font-family: var(--mono); font-size: 11px;
  padding: 2px 7px; border-radius: 4px;
  background: var(--panel-3); border: 1px solid var(--line);
  color: var(--text);
}
.mad-ui .legend-label { color: var(--text-dim); letter-spacing: 0.06em; text-transform: uppercase; }

/* --- focus -------------------------------------------------------------- */

.mad-ui .focusable { border-radius: 6px; transition: background-color 90ms linear, border-color 90ms linear; }
.mad-ui .focused {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
  animation: mad-pulse 1.4s ease-in-out infinite;
}
.mad-ui .disabled { opacity: 0.38; }
@keyframes mad-pulse {
  0%, 100% { outline-color: var(--accent); }
  50% { outline-color: color-mix(in srgb, var(--accent) 45%, transparent); }
}

/* --- generic bits ------------------------------------------------------- */

.mad-ui .panel {
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  min-height: 0;
}
.mad-ui .panel-title {
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--text-dim); margin-bottom: 10px;
  border-bottom: 1px solid var(--line-soft); padding-bottom: 6px;
}
.mad-ui .row { display: flex; align-items: center; gap: 10px; }
.mad-ui .col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.mad-ui .grow { flex: 1; min-height: 0; min-width: 0; }
.mad-ui .spacer { flex: 1; }
.mad-ui .dim { color: var(--text-dim); }
.mad-ui .faint { color: var(--text-faint); }
.mad-ui .good { color: var(--good); }
.mad-ui .bad { color: var(--bad); }
.mad-ui .warn { color: var(--warn); }
.mad-ui .right { text-align: right; }
.mad-ui .center { text-align: center; }
.mad-ui .scroll { overflow-y: auto; overflow-x: hidden; }
.mad-ui .scroll::-webkit-scrollbar { width: 8px; }
.mad-ui .scroll::-webkit-scrollbar-thumb { background: var(--panel-3); border-radius: 4px; }

.mad-ui .bar { height: 5px; background: var(--panel-3); border-radius: 3px; overflow: hidden; min-width: 60px; }
.mad-ui .bar-fill { height: 100%; background: var(--accent); }

.mad-ui .chip {
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--text-dim); background: var(--panel);
}

/* --- tables ------------------------------------------------------------- */

.mad-ui .tbl-wrap { overflow-x: auto; overflow-y: auto; min-height: 0; }
.mad-ui .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.mad-ui .tbl th {
  text-align: left; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--text-faint); font-weight: 600;
  padding: 6px 8px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--panel);
}
.mad-ui .tbl td { padding: 5px 8px; border-bottom: 1px solid var(--line-soft); }
.mad-ui .tbl td.right, .mad-ui .tbl th.right { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; }
.mad-ui .tbl tr.user-row td { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.mad-ui .tbl tr.winner-row td { color: var(--text); font-weight: 700; }

/* --- title screen ------------------------------------------------------- */

.mad-ui .title-screen { align-items: center; justify-content: center; gap: 26px; }
.mad-ui .wordmark {
  font-size: clamp(56px, 12vw, 132px); font-weight: 800; letter-spacing: 0.06em;
  background: linear-gradient(180deg, #ffffff 20%, #93a4bb 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 8px 40px rgba(0,0,0,0.6);
}
.mad-ui .wordmark-sub {
  letter-spacing: 0.55em; text-transform: uppercase; font-size: 13px; color: var(--accent);
  margin-top: -10px;
}
.mad-ui .title-cta { letter-spacing: 0.3em; text-transform: uppercase; font-size: 15px; color: var(--text-dim); animation: mad-blink 1.6s steps(2, start) infinite; }
@keyframes mad-blink { 50% { opacity: 0.25; } }
.mad-ui .title-rule { width: min(520px, 70vw); height: 1px; background: linear-gradient(90deg, transparent, var(--line), transparent); }

/* --- menu list ---------------------------------------------------------- */

.mad-ui .menu { display: flex; flex-direction: column; gap: 8px; width: min(460px, 100%); }
.mad-ui .menu-item {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 16px;
  background: linear-gradient(90deg, var(--panel), rgba(16,24,35,0.35));
  border: 1px solid var(--line);
  border-left: 3px solid transparent;
  letter-spacing: 0.12em; text-transform: uppercase; font-size: 15px;
}
.mad-ui .menu-item.focused { border-left-color: var(--accent); background: linear-gradient(90deg, var(--panel-3), rgba(16,24,35,0.4)); }
.mad-ui .menu-item .menu-note { margin-left: auto; font-size: 11px; letter-spacing: 0.06em; color: var(--text-faint); text-transform: none; }
.mad-ui .menu-wrap { flex: 1; display: flex; align-items: center; justify-content: center; }

/* --- team select -------------------------------------------------------- */

.mad-ui .select-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; flex: 1; min-height: 0; }
.mad-ui .division-grid { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.mad-ui .division {
  display: grid; grid-template-columns: 96px repeat(4, minmax(0, 1fr)); gap: 8px; align-items: stretch;
}
.mad-ui .division-name {
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-faint);
  display: flex; align-items: center; border-right: 1px solid var(--line-soft); padding-right: 8px;
}
.mad-ui .team-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 9px 10px 8px;
  background: var(--panel); border: 1px solid var(--line);
  position: relative; overflow: hidden; min-height: 74px;
}
.mad-ui .team-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, var(--card-primary, var(--accent)) 55%, var(--card-secondary, var(--accent-2)) 55%);
}
.mad-ui .team-card .tc-abbrev { font-family: var(--mono); font-size: 16px; font-weight: 700; letter-spacing: 0.04em; }
.mad-ui .team-card .tc-name { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mad-ui .team-card .tc-ovr { margin-top: auto; display: flex; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--text-faint); }
.mad-ui .team-card .tc-ovr b { color: var(--text); font-weight: 700; }
.mad-ui .team-card.taken { opacity: 0.35; }
.mad-ui .team-card.picked { border-color: var(--accent); }
.mad-ui .ovr-elite { color: var(--accent) !important; }
.mad-ui .ovr-good { color: var(--good) !important; }
.mad-ui .ovr-ok { color: var(--text) !important; }
.mad-ui .ovr-weak { color: var(--text-faint) !important; }

.mad-ui .detail { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.mad-ui .detail-header { display: flex; flex-direction: column; gap: 2px; }
.mad-ui .detail-city { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-dim); }
.mad-ui .detail-nick { font-size: 24px; font-weight: 700; letter-spacing: 0.04em; color: var(--accent); }
.mad-ui .detail-colors { display: flex; gap: 6px; margin-top: 6px; }
.mad-ui .swatch { width: 34px; height: 10px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.12); }
.mad-ui .rating-row { display: grid; grid-template-columns: 42px 1fr 32px; align-items: center; gap: 8px; font-size: 11px; color: var(--text-dim); }
.mad-ui .rating-row .num { color: var(--text); }
.mad-ui .star-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line-soft); }
.mad-ui .star-pos { font-family: var(--mono); font-size: 11px; width: 26px; color: var(--text-faint); }
.mad-ui .star-name { flex: 1; font-size: 13px; }
.mad-ui .star-sig { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.mad-ui .star-ovr { font-family: var(--mono); font-weight: 700; }

/* --- difficulty --------------------------------------------------------- */

.mad-ui .diff-list { display: flex; flex-direction: column; gap: 8px; width: min(620px, 100%); }
.mad-ui .diff-item {
  display: grid; grid-template-columns: 150px 1fr 20px; align-items: center; gap: 12px;
  padding: 12px 16px; background: var(--panel); border: 1px solid var(--line);
}
.mad-ui .diff-name { letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; }
.mad-ui .diff-blurb { font-size: 12px; color: var(--text-dim); }
.mad-ui .diff-mark { color: var(--accent); font-size: 14px; }
.mad-ui .option-row {
  display: grid; grid-template-columns: 200px 1fr; align-items: center; gap: 12px;
  padding: 11px 16px; background: var(--panel); border: 1px solid var(--line);
}
.mad-ui .option-label { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-dim); }
.mad-ui .option-value { display: flex; align-items: center; gap: 12px; font-family: var(--mono); }
.mad-ui .option-arrow { color: var(--text-faint); font-size: 12px; }
.mad-ui .btn {
  padding: 12px 18px; text-align: center; letter-spacing: 0.18em; text-transform: uppercase;
  background: var(--panel-3); border: 1px solid var(--line); font-weight: 700; font-size: 14px;
}
.mad-ui .btn.focused { background: var(--accent); color: #10151d; border-color: var(--accent); }
.mad-ui .btn.primary { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
.mad-ui .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }

/* --- tabs --------------------------------------------------------------- */

.mad-ui .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.mad-ui .tab {
  padding: 8px 16px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--text-dim); border-bottom: 2px solid transparent;
}
.mad-ui .tab.active { color: var(--text); border-bottom-color: var(--accent); background: rgba(255,255,255,0.03); }

/* --- season hub --------------------------------------------------------- */

.mad-ui .hub-overview { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; flex: 1; min-height: 0; }
.mad-ui .matchup { display: flex; align-items: center; gap: 16px; padding: 6px 0 14px; }
.mad-ui .matchup-team { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.mad-ui .matchup-abbrev { font-family: var(--mono); font-size: 30px; font-weight: 700; }
.mad-ui .matchup-name { font-size: 12px; color: var(--text-dim); }
.mad-ui .matchup-at { color: var(--text-faint); letter-spacing: 0.2em; font-size: 12px; }
.mad-ui .week-list { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.mad-ui .week-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 4px 6px; border-bottom: 1px solid var(--line-soft); }
.mad-ui .week-row.user { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.mad-ui .standings-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; min-height: 0; }
.mad-ui .bracket { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.mad-ui .bracket-col { display: flex; flex-direction: column; gap: 10px; }
.mad-ui .bracket-game { padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); font-size: 12px; }
.mad-ui .bracket-game .bg-team { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
.mad-ui .bracket-game .bg-team.win { color: var(--accent); font-weight: 700; }

/* --- settings ----------------------------------------------------------- */

.mad-ui .settings-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; flex: 1; min-height: 0; }
.mad-ui .vol-meter { display: flex; gap: 3px; }
.mad-ui .vol-seg { width: 12px; height: 14px; background: var(--panel-3); border-radius: 2px; }
.mad-ui .vol-seg.on { background: var(--accent); }
.mad-ui .keyref { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; }
.mad-ui .keyref .k { font-family: var(--mono); color: var(--accent); }
.mad-ui .keyref .v { color: var(--text-dim); }
.mad-ui .danger.focused { outline-color: var(--bad); }
.mad-ui .danger-armed { border-color: var(--bad); color: var(--bad); }

/* --- play call ---------------------------------------------------------- */

.mad-ui .playcall { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 14px; flex: 1; min-height: 0; }
.mad-ui .formation-list { display: flex; flex-direction: column; gap: 5px; }
.mad-ui .formation-item {
  padding: 9px 11px; background: var(--panel); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 2px;
}
.mad-ui .formation-item.active { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
.mad-ui .formation-name { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; }
.mad-ui .formation-meta { font-size: 10px; color: var(--text-faint); letter-spacing: 0.1em; }
.mad-ui .play-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 10px; min-height: 0; }
.mad-ui .play-card {
  display: flex; flex-direction: column; gap: 6px; padding: 10px;
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--line); min-height: 0;
}
.mad-ui .play-card canvas { width: 100%; height: 100%; flex: 1; min-height: 0; display: block; }
.mad-ui .play-card .pc-name { font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; }
.mad-ui .play-card .pc-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.mad-ui .play-card.dimmed { opacity: 0.18; }
.mad-ui .play-card.suggested { border-color: var(--accent); }
.mad-ui .play-card.empty { opacity: 0.25; border-style: dashed; }
.mad-ui .situation { display: flex; align-items: center; gap: 18px; font-size: 13px; }
.mad-ui .situation .pc-clock { font-family: var(--mono); font-size: 22px; font-weight: 700; }
.mad-ui .playclock { font-family: var(--mono); font-size: 22px; font-weight: 700; }
.mad-ui .playclock.hot { color: var(--bad); animation: mad-blink 0.5s steps(2, start) infinite; }
.mad-ui .coach-banner { color: var(--accent); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }

/* --- modals (pause / penalty) ------------------------------------------- */

.mad-ui .modal-center { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
.mad-ui .modal {
  width: min(560px, 100%);
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--line); border-top: 3px solid var(--accent);
  padding: 20px 22px; display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 24px 80px rgba(0,0,0,0.65);
}
.mad-ui .modal-title { font-size: 18px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; }
.mad-ui .modal-sub { font-size: 12px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
.mad-ui .choice-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.mad-ui .choice {
  padding: 14px; background: var(--panel-3); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 6px;
}
.mad-ui .choice-title { letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; font-size: 14px; }
.mad-ui .choice-detail { font-size: 12px; color: var(--text-dim); }
.mad-ui .timer-bar { height: 3px; background: var(--panel-3); overflow: hidden; }
.mad-ui .timer-fill { height: 100%; background: var(--accent); transition: width 100ms linear; }

/* --- box score / summary ------------------------------------------------ */

.mad-ui .summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; min-height: 0; flex: 1; }
.mad-ui .final-line { display: flex; align-items: baseline; gap: 14px; }
.mad-ui .final-score { font-family: var(--mono); font-size: 40px; font-weight: 800; }
.mad-ui .compare-row { display: grid; grid-template-columns: 70px 1fr 70px; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line-soft); font-size: 13px; }
.mad-ui .compare-label { grid-column: 2; text-align: center; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-faint); }
.mad-ui .compare-val { font-family: var(--mono); }
.mad-ui .compare-val.better { color: var(--accent); font-weight: 700; }
.mad-ui .potg { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.mad-ui .potg-label { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
.mad-ui .potg-name { font-size: 18px; font-weight: 700; }
.mad-ui .potg-line { font-size: 12px; color: var(--text-dim); font-family: var(--mono); }

/* --- champion ----------------------------------------------------------- */

.mad-ui .champ-screen { position: relative; }
.mad-ui .confetti { position: absolute; inset: 0; pointer-events: none; }
.mad-ui .champ-body { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; }
.mad-ui .champ-title { font-size: 13px; letter-spacing: 0.5em; text-transform: uppercase; color: var(--accent); }
.mad-ui .champ-team { font-size: clamp(34px, 7vw, 76px); font-weight: 800; letter-spacing: 0.04em; }
.mad-ui .champ-score { font-family: var(--mono); font-size: 20px; color: var(--text-dim); }
.mad-ui .award { display: flex; gap: 12px; align-items: baseline; justify-content: center; font-size: 13px; }
.mad-ui .award-label { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-faint); }
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById(UI_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_CSS;
  doc.head.appendChild(style);
}
