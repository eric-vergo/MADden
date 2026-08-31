// Public barrel for the sim core — the ONLY import surface for outside layers.
// DETERMINISM RULES (enforced by tsconfig.pure.json + tests/purity.test.ts):
//  1. No Date, Math.random, performance, timers, or DOM anywhere in src/sim.
//  2. All randomness through the injected RngSet; all time through state.tick.
//  3. tick() is the only mutator; outsiders treat state as Readonly.
//  4. Fixed-order iteration only (arrays by index; sort keys before iterating
//     any Record whose insertion order isn't fixed by construction).

export * from './types';
export * from './events';
export * from './constants';
export { Rng, makeRngSet, hashSeed } from './rng';
export type { RngSet } from './rng';
export { Hasher, hashGameState } from './hash';
export { GameSim, createInitialState, emptyGameStats } from './GameSim';
