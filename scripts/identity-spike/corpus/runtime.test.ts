// scripts/identity-spike/corpus/runtime.test.ts
// The freeze guard: its rules, pure, and its comparison against a real git repository built in a
// temporary directory, so neither depends on the state of the checkout running the tests.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CORPUS, EXPOSED_COMMITS } from './manifest.ts';
import { AFTER_FREEZE_FLAG, FREEZE_FILE, freezeVerdict, runnerDrift, type Freeze } from './runtime.ts';

const actual = CORPUS.actual;
const exposed = actual.commits.find((commit) => commit.sha === EXPOSED_COMMITS.actual)!;
const unexposed = actual.commits[0]!;
const FREEZE: Freeze = { commit: 'f'.repeat(40), frozen: '2026-11-17' };

describe('freezeVerdict', () => {
  const verdict = (overrides: Partial<Parameters<typeof freezeVerdict>[0]>) =>
    freezeVerdict({ app: 'actual', commit: exposed, afterFreeze: false, freeze: null, drift: [], ...overrides });

  it('before the freeze: the exposed commit runs, any other is refused, with or without the flag', () => {
    expect(verdict({})).toBeNull();
    expect(verdict({ commit: unexposed })).toMatch(/has never been built/);
    expect(verdict({ commit: unexposed, afterFreeze: true })).toMatch(/not frozen/);
  });

  it('after the freeze: any commit runs, the unexposed ones only with the flag', () => {
    expect(verdict({ freeze: FREEZE })).toBeNull();
    expect(verdict({ freeze: FREEZE, commit: unexposed, afterFreeze: true })).toBeNull();
    expect(verdict({ freeze: FREEZE, commit: unexposed })).toContain(AFTER_FREEZE_FLAG);
  });

  // The point of the freeze: no number in the run from a runner other than the recorded one,
  // the exposed commits included.
  it('after the freeze: a drifted runner is refused for every commit, and the files are named', () => {
    const drift = ['scripts/identity-spike/src/strategies.ts'];
    expect(verdict({ freeze: FREEZE, drift })).toMatch(/differs from the one frozen at fffffff.*strategies\.ts/);
    expect(verdict({ freeze: FREEZE, drift, commit: unexposed, afterFreeze: true })).toMatch(/differs/);
  });
});

describe('runnerDrift', () => {
  let repo: string;
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };

  /** A repository holding a runner file, a test, prose, the freeze record and an unrelated app. */
  function frozenRepo(): string {
    repo = mkdtempSync(join(tmpdir(), 'rastro-freeze-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    write('scripts/identity-spike/src/strategies.ts', 'a');
    write('scripts/identity-spike/src/strategies.test.ts', 'a');
    write('scripts/identity-spike/corpus/README.md', 'a');
    write('packages/core/src/fingerprint.ts', 'a');
    write('pnpm-lock.yaml', 'a');
    write('apps/dashboard/src/App.tsx', 'a');
    git('add', '-A');
    git('commit', '-qm', 'frozen');
    return git('rev-parse', 'HEAD');
  }

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('is empty on the frozen commit, and ignores tests, prose, the freeze record and other apps', () => {
    const commit = frozenRepo();
    write('scripts/identity-spike/src/strategies.test.ts', 'b');
    write('scripts/identity-spike/corpus/README.md', 'b');
    write(FREEZE_FILE, '{}');
    write('apps/dashboard/src/App.tsx', 'b');
    expect(runnerDrift(commit, repo)).toEqual([]);
  });

  it('names runner files changed since, edited and uncommitted, or new and untracked', () => {
    const commit = frozenRepo();
    write('packages/core/src/fingerprint.ts', 'b');
    git('commit', '-qam', 'later');
    write('pnpm-lock.yaml', 'b');
    write('scripts/identity-spike/src/new-strategy.ts', 'b');
    expect(runnerDrift(commit, repo)).toEqual([
      'packages/core/src/fingerprint.ts',
      'pnpm-lock.yaml',
      'scripts/identity-spike/src/new-strategy.ts',
    ]);
  });
});
