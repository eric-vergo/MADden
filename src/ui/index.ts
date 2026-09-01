// Public surface of the UI overlay. Integration (Phase 2) needs exactly this:
// implement UiServices, construct a ScreenManager over an element in #ui, and
// push screens.

export { ScreenManager } from './ScreenManager';
export { Screen, FocusRing } from './Screen';
export type { FocusEntry, FocusRingOptions } from './Screen';
export type {
  BoxScoreView, ChampionAward, ChampionInfo, ExhibitionSetup, NextGameView,
  PenaltyPromptRequest, PlayCallGroup, PlayCallRequest, PlayCallSituation,
  PlayCardInfo, SeasonSetup, StarPlayer, UiServices, WeekGameView,
} from './UiServices';

export { UI_CSS, UI_STYLE_ID, injectStyles } from './styles';
export { accentFor, applyAccent, keyLegend, screenFrame } from './dom';
export type { LegendItem } from './dom';

export {
  cycle, dirForCode, eventCode, isBack, isConfirm, moveGrid, moveList,
  moveRagged, moveSkippingDisabled, tabDeltaForCode,
} from './focus';
export type { FocusDir, FocusOptions } from './focus';

export {
  buildPenaltyPrompt, formatClock, formatDownDistance, formatSpot,
  preferredPenaltyChoice,
} from './format';
export { buildPlayDiagram, drawPlayDiagram, DEFAULT_PAINT } from './routeDiagram';
export type { PlayDiagram, DiagramPaint } from './routeDiagram';
export {
  LEADER_CATEGORIES, buildLeaders, buildLineScore, buildPlayerTables,
  buildStandings, buildTeamComparison, pickPlayerOfTheGame, rankStandouts,
} from './tables';
export type { LeaderCategory, StatGroup } from './tables';

export { TitleScreen } from './screens/TitleScreen';
export { MainMenuScreen } from './screens/MainMenuScreen';
export { TeamSelectScreen } from './screens/TeamSelectScreen';
export { DifficultyScreen } from './screens/DifficultyScreen';
export { SeasonHubScreen } from './screens/SeasonHubScreen';
export { SettingsScreen } from './screens/SettingsScreen';
export { PlayCallScreen } from './screens/PlayCallScreen';
export { PauseScreen } from './screens/PauseScreen';
export { PenaltyPromptScreen } from './screens/PenaltyPromptScreen';
export { HalftimeStatsScreen } from './screens/HalftimeStatsScreen';
export { GameSummaryScreen } from './screens/GameSummaryScreen';
export { ChampionScreen } from './screens/ChampionScreen';
export type { TeamSelectOptions } from './screens/TeamSelectScreen';
export type { DifficultyOptions, DifficultySelection } from './screens/DifficultyScreen';
export type { GameSummaryOptions } from './screens/GameSummaryScreen';
export type { HalftimeOptions } from './screens/HalftimeStatsScreen';
