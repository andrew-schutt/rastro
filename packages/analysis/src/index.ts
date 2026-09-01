// packages/analysis/src/index.ts
// Pure functions over arrays: fixture traces in, known output out. The TDD sweet spot.
export { sessionize } from './sessionize.js';
export type { Session, Step } from './sessionize.js';

export { buildGraph, labelFor, transitionGraphBuilder } from './graph.js';
export type { BuildGraphOptions, FlowEdge, FlowGraph, FlowNode } from './graph.js';

export {
  DEFAULT_MIN_CLICKS,
  DEFAULT_MIN_DROPOFF_RATE,
  DEFAULT_MIN_SESSIONS,
  DEFAULT_WINDOW_MS,
  detectFriction,
  frictionByNode,
} from './friction.js';
export type {
  DetectFrictionOptions,
  FrictionByNode,
  FrictionKind,
  FrictionSignal,
} from './friction.js';
