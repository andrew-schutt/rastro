// packages/analysis/src/graph.test.ts
// Placeholders only — `buildGraph` throws until walking-skeleton step 5 (§19.4).
// §19.4 says build this one test-first against fixture traces; these name the cases.
import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph.js';

describe('buildGraph', () => {
  it('is not implemented yet', () => {
    expect(() => buildGraph([])).toThrow(/not implemented/);
  });

  describe('nodes', () => {
    it.todo('emits one node per distinct fingerprint');
    it.todo('counts hits across every session, not per session');
    it.todo('returns an empty graph for no sessions');
    it.todo('emits a node but no edges for a single-step session');
  });

  describe('edges', () => {
    it.todo('tallies one edge per consecutive step pair within a session');
    it.todo('does NOT create edges across session boundaries');
    it.todo('increments count when two sessions make the same A→B transition');
    it.todo('keeps A→B and B→A as distinct edges');
    it.todo('handles a self-transition (A→A) without collapsing it');
  });

  describe('medianMs', () => {
    it.todo('is the median dwell on `from` before moving to `to`');
    it.todo('picks the middle value for an odd number of occurrences');
    it.todo('averages the two middle values for an even number');
    it.todo('is not skewed by one walked-away-from-the-desk outlier (median, not mean)');
    it.todo('treats a missing ux.active_ms as 0 rather than dropping the occurrence');
  });

  describe('dropoffRate', () => {
    it.todo('is the share of sessions that reached `from` and then ended');
    it.todo('is 0 when every session that reached `from` continued');
    it.todo('is 1 when `from` is the last step of every session that reached it');
    it.todo('counts a session that visits `from` twice only once');
  });

  it.todo('is deterministic: the same sessions in a different order give the same graph');
  it.todo('prunes rare transitions so the Flow Explorer stays legible (§8 spaghetti-taming)');
});
