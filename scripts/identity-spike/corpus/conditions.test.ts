// scripts/identity-spike/corpus/conditions.test.ts
// The init script, run in fresh V8 contexts the way a page and a worker would run it.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FIXED_TIME_MS, initScript } from './conditions.ts';

/** A fresh global, as a new page or worker would have, with the script installed. */
function context(script = initScript()): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(script, sandbox);
  return sandbox;
}

const evaluate = (sandbox: Record<string, unknown>, code: string): unknown =>
  runInNewContext(code, sandbox);

describe('initScript', () => {
  it('gives every fresh context the same Math.random sequence', () => {
    const draw = 'Array.from({ length: 5 }, () => Math.random())';
    const first = evaluate(context(), draw);
    expect(evaluate(context(), draw)).toEqual(first);
    expect(new Set(first as number[]).size).toBe(5);
    for (const value of first as number[]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('gives a different seed a different sequence', () => {
    const draw = 'Math.random()';
    expect(evaluate(context(initScript(1)), draw)).not.toBe(evaluate(context(initScript(2)), draw));
  });

  it('freezes Date.now and new Date() at the fixed instant', () => {
    const sandbox = context();
    expect(evaluate(sandbox, 'Date.now()')).toBe(FIXED_TIME_MS);
    expect(evaluate(sandbox, 'new Date().toISOString()')).toBe('2026-10-30T12:00:00.000Z');
    expect(evaluate(sandbox, 'Date.now()')).toBe(FIXED_TIME_MS);
  });

  it('leaves explicit dates, parsing and instanceof working', () => {
    const sandbox = context();
    expect(evaluate(sandbox, "new Date('2020-01-02T00:00:00Z').getTime()")).toBe(
      Date.UTC(2020, 0, 2),
    );
    expect(evaluate(sandbox, 'new Date(0).getTime()')).toBe(0);
    expect(evaluate(sandbox, "Date.parse('2020-01-02T00:00:00Z')")).toBe(Date.UTC(2020, 0, 2));
    expect(evaluate(sandbox, 'new Date() instanceof Date')).toBe(true);
    expect(evaluate(sandbox, 'new Date().constructor === Date')).toBe(true);
  });

  it('returns a string when Date is called without new, as the real one does', () => {
    expect(typeof evaluate(context(), 'Date()')).toBe('string');
  });

  it('installs once, even when run twice in one context', () => {
    const sandbox = context();
    const first = evaluate(sandbox, 'Math.random()');
    evaluate(sandbox, initScript());
    // A second install would have reset the generator and repeated the first draw.
    expect(evaluate(sandbox, 'Math.random()')).not.toBe(first);
  });

  it('seeds crypto by default, as the 2026-11-09 amendment requires', () => {
    const sandbox: Record<string, unknown> = { crypto: {} };
    runInNewContext(initScript(), sandbox);
    expect(evaluate(sandbox, 'typeof crypto.randomUUID')).toBe('function');
  });

  it('can leave crypto alone, for the comparison below', () => {
    const sandbox: Record<string, unknown> = { crypto: { getRandomValues: 'native', randomUUID: 'native' } };
    runInNewContext(initScript(undefined, undefined, 'frozen', false), sandbox);
    expect(evaluate(sandbox, 'crypto.randomUUID')).toBe('native');
  });

  it('seeds randomUUID deterministically, without moving Math.random', () => {
    const run = (seedCrypto: boolean) => {
      const sandbox: Record<string, unknown> = { crypto: {} };
      runInNewContext(initScript(undefined, undefined, 'frozen', seedCrypto), sandbox);
      return sandbox;
    };
    const uuid = '[crypto.randomUUID(), crypto.randomUUID()]';
    const [a1, a2] = evaluate(run(true), uuid) as string[];
    expect(evaluate(run(true), uuid)).toEqual([a1, a2]);
    expect(a1).not.toBe(a2);
    expect(a1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(evaluate(run(true), 'Math.random()')).toBe(evaluate(run(false), 'Math.random()'));
  });
});
