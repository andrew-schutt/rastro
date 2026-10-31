// examples/stamp-fixture/audit/audit.test.ts
// Audits the fixture's two production builds. Runs after `pnpm -r build`, as CI does.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditBundle, passes } from './audit.ts';

const root = join(import.meta.dirname, '..');

function audit(dir: 'dist' | 'dist-misordered') {
  const buildDir = join(root, dir);
  if (!existsSync(buildDir)) {
    throw new Error(`${dir}/ is missing: run \`pnpm --filter stamp-fixture build\` first`);
  }
  return auditBundle(buildDir);
}

describe('the fixture, built in the documented plugin order', () => {
  const report = audit('dist');

  it('stamps every host element a component owns, with that component', () => {
    expect(report.missed).toEqual([]);
    expect(report.misattributed).toEqual([]);
    expect(passes(report)).toBe(true);
  });

  // Without the compiler the hoisting hazard never arises, and a pass would mean nothing.
  it('really was compiled by the React Compiler', () => {
    expect(report.compilerCacheSites).toBeGreaterThan(0);
  });

  // Every pattern in src/patterns.tsx is reached. A pattern the bundle dropped would pass the
  // rule above vacuously.
  it('covers every authoring pattern in the fixture', () => {
    const owners = new Set(report.stamped.map((f) => f.owner));
    expect([...owners].sort()).toEqual([
      'App',
      'ArrowCard',
      'Button',
      'ColorList', // .map() callback the compiler hoists to a top-level _temp
      'Counter', // .map() callback the compiler cannot hoist
      'Footer', // a component-local helper, which the compiler also hoists
      'LegacyPanel',
      'MemoArrowLink',
      'MemoBadge',
      'Modal',
      'RefInput',
      'Toggle',
      'View',
    ]);
  });

  // SettingsRow composes View and Button and writes no host element of its own, so nothing
  // carries its name. That is the design-system degeneration docs/NOTES.md records — correct
  // for host-only stamping, and pinned so that changing it is a decision, not an accident.
  it('stamps nothing for a component that only composes other components', () => {
    expect(report.stamped.some((f) => f.stampedAs === 'SettingsRow')).toBe(false);
  });

  it('leaves exactly the module-scope helper unstamped', () => {
    expect(report.unowned.map((f) => f.site)).toEqual([expect.stringMatching(/^src\/patterns\.tsx:/)]);
  });
});

// The audit's own canary. If the misordered build ever passes, the audit has lost the ability
// to see the failure it exists for — and every green run above would be meaningless.
describe('the fixture, built with the React Compiler listed first', () => {
  const report = audit('dist-misordered');

  it('is caught: the hoisted elements are reported as missed', () => {
    expect(passes(report)).toBe(false);
    expect(report.missed.map((f) => f.owner).sort()).toEqual(['ColorList', 'Footer']);
  });
});
