// scripts/identity-spike/corpus/rebuild.test.ts
import { describe, expect, it } from 'vitest';
import type { CapturedElement } from '../src/page.ts';
import { RULE_1_STRATEGIES } from '../src/strategies.ts';
import { rebuildControl, type ScreenCapture } from './rebuild.ts';

/** An element whose fingerprint is `name` under every strategy, or `overrides` where given. */
function element(name: string, overrides: Partial<CapturedElement['fingerprints']> = {}): CapturedElement {
  const fingerprints = Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, name])) as CapturedElement['fingerprints'];
  return { visible: true, fingerprints: { ...fingerprints, ...overrides } };
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
