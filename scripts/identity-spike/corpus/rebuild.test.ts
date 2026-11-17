// scripts/identity-spike/corpus/rebuild.test.ts
import { describe, expect, it } from 'vitest';
import type { CapturedElement } from '../src/page.ts';
import { RULE_1_STRATEGIES } from '../src/strategies.ts';
import { flowControl, rebuildControl, type ScreenCapture } from './rebuild.ts';

/** An element whose fingerprint is `name` under every strategy, or `overrides` where given. */
function element(name: string, overrides: Partial<CapturedElement['fingerprints']> = {}): CapturedElement {
  const fingerprints = Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, name])) as CapturedElement['fingerprints'];
  const description = { tag: 'button', role: null, label: null, text: name, attributes: {}, within: null, box: { x: 0, y: 0, width: 1, height: 1 } };
  const parts = Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, { role: 'button' }])) as CapturedElement['parts'];
  return { visible: true, fingerprints: { ...fingerprints, ...overrides }, parts, ancestry: [], site: null, description };
}

const screen = (name: string, elements: CapturedElement[]): ScreenCapture => ({
  screen: name,
  captured: true,
  elements,
});

describe('rebuildControl', () => {
  it('passes when every screen matches under every strategy', () => {
    const load = [screen('/a', [element('x'), element('y')]), screen('/b', [element('z')])];
    const verdict = rebuildControl(['/a', '/b'], load, structuredClone(load), RULE_1_STRATEGIES);

    expect(verdict.passed).toBe(true);
    expect(verdict.screens.map((s) => [s.unstable, s.reported])).toEqual([[[], []], [[], []]]);
  });

  it('names exactly the strategy that changed', () => {
    const verdict = rebuildControl(
      ['/a'],
      [screen('/a', [element('x')])],
      [screen('/a', [element('x', { fiber: 'x-different' })])],
      RULE_1_STRATEGIES,
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.screens[0]?.unstable).toEqual(['fiber']);
  });

  it('fails when two elements swap fingerprints, which a set comparison would miss', () => {
    const verdict = rebuildControl(
      ['/a'],
      [screen('/a', [element('x'), element('y')])],
      [screen('/a', [element('y'), element('x')])],
      RULE_1_STRATEGIES,
    );
    expect(verdict.passed).toBe(false);
  });

  it('fails when a load has more elements', () => {
    const verdict = rebuildControl(
      ['/a'],
      [screen('/a', [element('x')])],
      [screen('/a', [element('x'), element('x')])],
      RULE_1_STRATEGIES,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.screens[0]?.elements).toEqual([1, 2]);
  });

  it('cannot pass a screen either load failed to capture', () => {
    const failed: ScreenCapture = { screen: '/a', captured: false, error: 'no driver', elements: [] };
    const verdict = rebuildControl(['/a'], [failed], [failed], RULE_1_STRATEGIES);

    expect(verdict.passed).toBe(false);
    expect(verdict.screens[0]?.uncaptured).toBe(true);
  });

  it('cannot pass a screen present on only one load', () => {
    const verdict = rebuildControl(['/a'], [screen('/a', [element('x')])], [], RULE_1_STRATEGIES);
    expect(verdict.passed).toBe(false);
  });

  // The bug the first real capture found: no screens captured on either load passed, because
  // "every captured screen matched" is vacuously true of none.
  it('fails when neither load captured anything', () => {
    const verdict = rebuildControl(['/a', '/b'], [], [], RULE_1_STRATEGIES);

    expect(verdict.passed).toBe(false);
    expect(verdict.screens.map((s) => s.uncaptured)).toEqual([true, true]);
  });

  it('fails when there are no strategies to compare', () => {
    const load = [screen('/a', [element('x')])];
    expect(rebuildControl(['/a'], load, load, []).passed).toBe(false);
  });

  it('reports a reported-only strategy that differs, without failing on it', () => {
    const verdict = rebuildControl(
      ['/a'],
      [screen('/a', [element('x', { 'selector-path': 'p1' })])],
      [screen('/a', [element('x', { 'selector-path': 'p2' })])],
      RULE_1_STRATEGIES,
      ['selector-path'],
    );

    expect(verdict.passed).toBe(true);
    expect(verdict.screens[0]).toMatchObject({ unstable: [], reported: ['selector-path'] });
  });

  it('still fails a judged strategy alongside a reported one', () => {
    const verdict = rebuildControl(
      ['/a'],
      [screen('/a', [element('x', { 'selector-path': 'p1', fiber: 'f1' })])],
      [screen('/a', [element('x', { 'selector-path': 'p2', fiber: 'f2' })])],
      RULE_1_STRATEGIES,
      ['selector-path'],
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.screens[0]).toMatchObject({ unstable: ['fiber'], reported: ['selector-path'] });
  });

  it('cannot pass when every strategy is reported-only', () => {
    const load = [screen('/a', [element('x')])];
    expect(rebuildControl(['/a'], load, load, ['selector-path'], ['selector-path']).passed).toBe(false);
  });
});

describe('flowControl', () => {
  const states = [screen('sidebar', [element('x')]), screen('menu open', [element('y')])];
  const walked = (firsts: Record<string, string | null>) => ({ states: structuredClone(states), firsts });

  it('passes when every state and every first label matches', () => {
    const verdict = flowControl(['sidebar', 'menu open'], walked({ A1: 'Bank' }), walked({ A1: 'Bank' }), RULE_1_STRATEGIES);
    expect(verdict).toMatchObject({ passed: true, firsts: [] });
  });

  it('fails when a first item differs between the loads, even with every fingerprint stable', () => {
    const verdict = flowControl(['sidebar', 'menu open'], walked({ A1: 'Bank' }), walked({ A1: 'Ally' }), RULE_1_STRATEGIES);
    expect(verdict.passed).toBe(false);
    expect(verdict.firsts).toEqual([{ row: 'A1', labels: ['Bank', 'Ally'] }]);
  });

  it('fails when one load never recorded a first the other did', () => {
    const verdict = flowControl(['sidebar', 'menu open'], walked({ A1: 'Bank' }), walked({}), RULE_1_STRATEGIES);
    expect(verdict.firsts).toEqual([{ row: 'A1', labels: ['Bank', null] }]);
  });

  it('fails a state that was not reached on either load', () => {
    const stopped = { states: [states[0]!, { screen: 'menu open', captured: false, elements: [] }], firsts: {} };
    const verdict = flowControl(['sidebar', 'menu open'], stopped, stopped, RULE_1_STRATEGIES);
    expect(verdict.passed).toBe(false);
    expect(verdict.screens[1]?.uncaptured).toBe(true);
  });
});
