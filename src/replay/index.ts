// Public surface of the replay stream.

export { ReplayBuffer, REPLAY_LEAD_TICKS } from './ReplayBuffer';
export type { RecordedPlay, ReplayBufferOptions } from './ReplayBuffer';
export {
  ReplayController, REPLAY_SPEEDS, DEFAULT_REPLAY_SPEED,
  focusYOf, isReplaySpeed, nextReplaySpeed,
} from './ReplayController';
export type { ReplayFrameView, ReplaySpeed } from './ReplayController';
export {
  ReplayTrigger, REPLAY_POLICY, gameSecondsSince, isLateInHalf, shouldReplay,
} from './trigger';
export type { PlayResultEvent, ReplayClock, ReplayDecision } from './trigger';
