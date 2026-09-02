// packages/analysis/src/graph.test.ts
// §19.4 step 5 says build this test-first against fixture traces. These are those fixtures.
import { describe, expect, it } from 'vitest';
import type { Session, Step } from 'rastro-core';
import { buildGraph, labelFor } from './graph.js';

/** A step, with only the fields the graph actually reads spelled out. */
const step = (fingerprint: string, activeMs = 0, seq = 0): Step => ({
  eventName: 'ux.click',
  fingerprint,
  route: '/',
  seq,
  activeMs,
});

/** A session from a path of fingerprints, with optional dwell before each. */
const session = (sessionId: string, path: [string, number?][]): Session => ({
  sessionId,
  steps: path.map(([fingerprint, activeMs], index) => step(fingerprint, activeMs ?? 0, index + 1)),
});

const edgeBetween = (graph: ReturnType<typeof buildGraph>, from: string, to: string) =>
  graph.edges.find((edge) => edge.from === from && edge.to === to);

describe('buildGraph', () => {
  describe('nodes', () => {
    it('emits one node per distinct fingerprint', () => {
      const graph = buildGraph([session('s1', [['A'], ['B'], ['A']])]);

      expect(graph.nodes.map((node) => node.id)).toEqual(['A', 'B']);
    });

    it('counts hits across every session, not per session', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B'], ['A']]),
        session('s2', [['A'], ['B']]),
      ]);

      expect(graph.nodes.find((node) => node.id === 'A')?.hits).toBe(3);
      expect(graph.nodes.find((node) => node.id === 'B')?.hits).toBe(2);
    });

    it('returns an empty graph for no sessions', () => {
      expect(buildGraph([])).toEqual({ nodes: [], edges: [] });
    });

    it('emits a node but no edges for a single-step session', () => {
      const graph = buildGraph([session('s1', [['A']])]);

      expect(graph.nodes).toHaveLength(1);
      expect(graph.edges).toHaveLength(0);
    });

    it('ignores a session with no steps at all', () => {
      expect(buildGraph([{ sessionId: 's1', steps: [] }])).toEqual({ nodes: [], edges: [] });
    });

    it('carries a display label alongside the opaque id', () => {
      const graph = buildGraph([session('s1', [['App>Save|button|"Save Profile"']])]);

      expect(graph.nodes[0]?.id).toBe('App>Save|button|"Save Profile"');
      expect(graph.nodes[0]?.label).toBe('Save Profile');
    });
  });

  describe('edges', () => {
    it('tallies one edge per consecutive step pair within a session', () => {
      const graph = buildGraph([session('s1', [['A'], ['B'], ['C']])]);

      expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['A->B', 'B->C']);
    });

    it('does NOT create edges across session boundaries', () => {
      const graph = buildGraph([session('s1', [['A'], ['B']]), session('s2', [['C'], ['D']])]);

      // B->C would be the seam between the two sessions.
      expect(edgeBetween(graph, 'B', 'C')).toBeUndefined();
      expect(graph.edges).toHaveLength(2);
    });

    it('increments count when two sessions make the same A->B transition', () => {
      const graph = buildGraph([session('s1', [['A'], ['B']]), session('s2', [['A'], ['B']])]);

      expect(edgeBetween(graph, 'A', 'B')?.count).toBe(2);
    });

    // §19.3: "how many sessions made this A->B transition". One user hammering a path must
    // not outweigh a path many users take.
    it('counts a session that repeats the same transition only ONCE', () => {
      const graph = buildGraph([session('s1', [['A'], ['B'], ['A'], ['B'], ['A'], ['B']])]);

      expect(edgeBetween(graph, 'A', 'B')?.count).toBe(1);
    });

    it('keeps A->B and B->A as distinct edges', () => {
      const graph = buildGraph([session('s1', [['A'], ['B'], ['A']])]);

      expect(edgeBetween(graph, 'A', 'B')).toBeDefined();
      expect(edgeBetween(graph, 'B', 'A')).toBeDefined();
    });

    it('handles a self-transition (A->A) without collapsing it', () => {
      const graph = buildGraph([session('s1', [['A'], ['A']])]);

      expect(edgeBetween(graph, 'A', 'A')?.count).toBe(1);
      expect(graph.nodes).toHaveLength(1);
    });
  });

  describe('medianMs', () => {
    it('is the median dwell on `from` before moving to `to`', () => {
      // activeMs is the dwell BEFORE a step, so B's dwell is the time spent on A.
      const graph = buildGraph([session('s1', [['A'], ['B', 4200]])]);

      expect(edgeBetween(graph, 'A', 'B')?.medianMs).toBe(4200);
    });

    it('picks the middle value for an odd number of occurrences', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B', 100]]),
        session('s2', [['A'], ['B', 500]]),
        session('s3', [['A'], ['B', 300]]),
      ]);

      expect(edgeBetween(graph, 'A', 'B')?.medianMs).toBe(300);
    });

    it('averages the two middle values for an even number', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B', 100]]),
        session('s2', [['A'], ['B', 200]]),
        session('s3', [['A'], ['B', 300]]),
        session('s4', [['A'], ['B', 400]]),
      ]);

      expect(edgeBetween(graph, 'A', 'B')?.medianMs).toBe(250);
    });

    // The reason §19.3 specifies median and not mean.
    it('is not skewed by one walked-away-from-the-desk outlier', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B', 1000]]),
        session('s2', [['A'], ['B', 1100]]),
        session('s3', [['A'], ['B', 1200]]),
        session('s4', [['A'], ['B', 45 * 60_000]]),
      ]);

      expect(edgeBetween(graph, 'A', 'B')?.medianMs).toBe(1150);
    });

    it('treats a missing dwell as 0 rather than dropping the occurrence', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B']]),
        session('s2', [['A'], ['B', 1000]]),
        session('s3', [['A'], ['B', 2000]]),
      ]);

      expect(edgeBetween(graph, 'A', 'B')?.medianMs).toBe(1000);
    });

    // count is per session, but every traversal is a dwell sample — more data, better median.
    it('samples every traversal, even repeats within one session', () => {
      const graph = buildGraph([session('s1', [['A'], ['B', 100], ['A'], ['B', 900]])]);
      const edge = edgeBetween(graph, 'A', 'B');

      expect(edge?.count).toBe(1);
      expect(edge?.medianMs).toBe(500);
    });
  });

  describe('dropoffRate', () => {
    it('is the share of sessions that reached `from` and then ended', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B']]), // continued past A
        session('s2', [['A'], ['B']]), // continued past A
        session('s3', [['X'], ['A']]), // ended on A
        session('s4', [['X'], ['A']]), // ended on A
      ]);

      // Four sessions reached A; two ended there.
      expect(edgeBetween(graph, 'A', 'B')?.dropoffRate).toBeCloseTo(0.5);
    });

    it('is 0 when every session that reached `from` continued', () => {
      const graph = buildGraph([session('s1', [['A'], ['B']]), session('s2', [['A'], ['B']])]);

      expect(edgeBetween(graph, 'A', 'B')?.dropoffRate).toBe(0);
    });

    it('counts a session that visits `from` twice only once', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B'], ['A'], ['B']]),
        session('s2', [['A'], ['B']]),
      ]);

      // Two sessions reached A, neither ended on it — a revisit must not inflate the base.
      expect(edgeBetween(graph, 'A', 'B')?.dropoffRate).toBe(0);
    });

    // dropoffRate is a property of `from`, reported on each outgoing edge.
    it('is identical on every edge leaving the same node', () => {
      const graph = buildGraph([
        session('s1', [['A'], ['B']]),
        session('s2', [['A'], ['C']]),
        session('s3', [['A']]),
      ]);

      expect(edgeBetween(graph, 'A', 'B')?.dropoffRate).toBeCloseTo(1 / 3);
      expect(edgeBetween(graph, 'A', 'C')?.dropoffRate).toBeCloseTo(1 / 3);
    });
  });

  describe('spaghetti-taming (§8)', () => {
    it('keeps every edge by default — hiding data silently is worse than an ugly graph', () => {
      const graph = buildGraph([session('s1', [['A'], ['B']]), session('s2', [['A'], ['C']])]);

      expect(graph.edges).toHaveLength(2);
    });

    it('drops transitions below minEdgeCount', () => {
      const graph = buildGraph(
        [
          session('s1', [['A'], ['B']]),
          session('s2', [['A'], ['B']]),
          session('s3', [['A'], ['C']]), // the long tail: one session only
        ],
        { minEdgeCount: 2 },
      );

      expect(graph.edges.map((edge) => edge.to)).toEqual(['B']);
    });

    it('leaves nodes alone when pruning edges, so a pruned node is still visible', () => {
      const graph = buildGraph([session('s1', [['A'], ['B']])], { minEdgeCount: 5 });

      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(0);
    });
  });

  it('is deterministic: the same sessions in a different order give the same graph', () => {
    const a = session('s1', [['B'], ['A', 100]]);
    const b = session('s2', [['A'], ['C', 200]]);
    const c = session('s3', [['C'], ['B', 300]]);

    expect(buildGraph([a, b, c])).toEqual(buildGraph([c, a, b]));
  });

  it('builds the demo-app flow end to end', () => {
    // Two users navigate to settings; one abandons the form, one submits.
    const nav = 'App>Nav|button:button|"/users/42/settings"';
    const route = 'route:/users/:id/settings';
    const input = 'App>SettingsForm|input';
    const form = 'App>SettingsForm|form';

    const graph = buildGraph([
      session('s1', [[nav], [route, 1], [input, 400], [form, 6500]]),
      session('s2', [[nav], [route, 2], [input, 300], [form, 2200]]),
    ]);

    expect(graph.nodes.map((node) => node.label).sort()).toEqual([
      '/users/42/settings',
      '/users/:id/settings',
      'SettingsForm form',
      'SettingsForm input',
    ]);
    expect(edgeBetween(graph, input, form)?.count).toBe(2);
    expect(edgeBetween(graph, input, form)?.medianMs).toBe(4350);
    // Both sessions ended on the form, so it is a 100% drop-off point.
    expect(edgeBetween(graph, route, input)?.dropoffRate).toBe(0);
  });
});

describe('labelFor', () => {
  it('unwraps a data-telemetry-id override', () => {
    expect(labelFor('id:save-profile')).toBe('save-profile');
  });

  it('unwraps a route identity', () => {
    expect(labelFor('route:/orders/:id')).toBe('/orders/:id');
  });

  it('prefers the accessible name — what the user actually saw', () => {
    expect(labelFor('Settings>ProfileForm>SaveButton|button|"Save Profile"')).toBe('Save Profile');
  });

  it('falls back to the innermost component and role when there is no name', () => {
    expect(labelFor('App>SettingsForm|input:email')).toBe('SettingsForm input:email');
  });

  // The source-file qualifier is part of the identity (§4.2.1), never part of the label — a
  // path inside a box on screen is noise. This is the exact shape a build-annotated demo run
  // produces for an unnamed element, so it is what the flow graph renders today.
  it('drops the source-file qualifier from the innermost component', () => {
    expect(labelFor('App>SettingsForm@src/App.tsx|form')).toBe('SettingsForm form');
    expect(labelFor('App>Card@src/billing/Card.tsx|input:email')).toBe('Card input:email');
  });

  // Only a source path is a qualifier. On the fiber-walk path there is no `@<file>` at all and
  // the segment is a raw `displayName`, which is arbitrary developer- or library-supplied text
  // — cutting at the first `@` turned `Connect(@app/Widget)` into the label `Connect(`.
  it('keeps an @ that is part of the component name, not a source path', () => {
    expect(labelFor('App>Connect(@app/Widget)|input:email')).toBe(
      'Connect(@app/Widget) input:email',
    );
    expect(labelFor('App>Card@v2|input:email')).toBe('Card@v2 input:email');
  });

  it('falls back to the role alone when the chain is unknown', () => {
    expect(labelFor('unknown|button')).toBe('button');
  });

  it('returns the fingerprint unchanged when the shape is unfamiliar', () => {
    expect(labelFor('something-else-entirely')).toBe('something-else-entirely');
  });

  it('never returns an empty label', () => {
    for (const fingerprint of ['id:', 'route:', '|', 'unknown|', 'a|b|""']) {
      expect(labelFor(fingerprint).length).toBeGreaterThan(0);
    }
  });
});
