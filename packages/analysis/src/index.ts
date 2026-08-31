// packages/analysis/src/index.ts
// Pure functions over arrays: fixture traces in, known output out. The TDD sweet spot.
export { sessionize } from './sessionize.js';
export type { Session, Step } from './sessionize.js';

export { buildGraph, transitionGraphBuilder } from './graph.js';
export type { FlowEdge, FlowGraph, FlowNode } from './graph.js';

export { detectFriction } from './friction.js';
export type { FrictionKind, FrictionSignal } from './friction.js';
