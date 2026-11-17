// scripts/identity-spike/corpus/runtime.ts
// What every corpus command shares: where third-party code lives, the freeze guard, and the
// rastro revision a result was made with. One copy, so build and capture cannot drift apart on
// the rules that keep the run honest.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { EXPOSED_COMMITS, type AppId, type CorpusApp, type CorpusCommit } from './manifest.ts';

export const SPIKE_DIR = resolve(import.meta.dirname, '..');
export const REPO_DIR = resolve(SPIKE_DIR, '../..');

export const AFTER_FREEZE_FLAG = '--after-freeze';

export function corpusRoot(): string {
  const root = resolve(process.env.RASTRO_CORPUS ?? join(homedir(), 'rastro-corpus'));
  // Third-party code must never sit where a `git add` or a pnpm workspace glob could reach it.
  if (!relative(REPO_DIR, root).startsWith('..')) {
    throw new Error(`RASTRO_CORPUS (${root}) is inside the rastro repo. Put it outside.`);
  }
  return root;
}

/**
 * Everything that shapes what a capture records, relative to the repo root: the runner, the
 * strategies and referee it bundles, the two packages it builds with, how they compile, and
 * every version the lockfile resolves. Tests and prose are excluded because they change no
 * capture, and so is the freeze record itself.
 *
 * A lockfile change for any reason trips the guard. Dependency bumps wait for the run to end.
 */
export const RUNNER_PATHS = [
  'scripts/identity-spike/corpus',
  'scripts/identity-spike/src',
  'scripts/identity-spike/package.json',
  'scripts/identity-spike/tsconfig.json',
  'packages/core/src',
  'packages/core/package.json',
  'packages/core/tsconfig.json',
  'packages/babel-plugin/src',
  'packages/babel-plugin/package.json',
  'packages/babel-plugin/tsconfig.json',
  'tsconfig.base.json',
  'pnpm-lock.yaml',
] as const;

export const FREEZE_FILE = 'scripts/identity-spike/corpus/freeze.json';

const NOT_RUNNER = [
  ':(exclude,glob)**/*.test.ts',
  ':(exclude,glob)**/*.test.tsx',
  ':(exclude,glob)**/*.md',
  `:(exclude)${FREEZE_FILE}`,
];

/** The freeze record: the rastro commit the runner was frozen at. */
export interface Freeze {
  commit: string;
  /** When, as a date. */
  frozen: string;
}

export function readFreeze(): Freeze | null {
  const path = join(REPO_DIR, FREEZE_FILE);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Freeze) : null;
}

/**
 * Runner files that differ from the frozen commit: committed since, edited and not committed,
 * or new and untracked. Empty means this checkout runs the frozen runner.
 */
export function runnerDrift(commit: string, repo: string = REPO_DIR): string[] {
  const paths = [...RUNNER_PATHS, ...NOT_RUNNER];
  const changed = git(['diff', '--name-only', commit, '--', ...paths], repo);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...paths], repo);
  return [...new Set([...changed.split('\n'), ...untracked.split('\n')].filter((line) => line !== ''))].sort();
}

/**
 * Whether a build or capture of `commit` may run. Pure, so the rules are tested apart from git.
 *
 * - Before the freeze, only the exposed commits: a runner debugged on the commits it measures
 *   is tuned on its own numbers.
 * - After it, every command runs the frozen runner and nothing else, exposed commits too, so
 *   no number in the run comes from a runner that differs from the recorded one.
 * - `--after-freeze` is still required for the unexposed commits, so lifting the rule shows
 *   in the command line, and it is refused when there is no freeze to lift.
 */
export function freezeVerdict(input: {
  app: AppId;
  commit: CorpusCommit;
  afterFreeze: boolean;
  freeze: Freeze | null;
  drift: readonly string[];
}): string | null {
  const { app, commit, afterFreeze, freeze, drift } = input;
  if (freeze !== null && drift.length > 0) {
    return (
      `the runner differs from the one frozen at ${freeze.commit.slice(0, 7)} (${FREEZE_FILE}): ` +
      `${drift.join(', ')}. Every capture in the run comes from the frozen runner. Check it out, ` +
      'or record a new freeze, which makes a different run.'
    );
  }
  if (commit.sha === EXPOSED_COMMITS[app]) return null;
  if (!afterFreeze) {
    return (
      `${app} commit ${commit.index} has never been built. Until the runner is frozen, only ` +
      `${EXPOSED_COMMITS[app].slice(0, 7)} may be (manifest.ts, EXPOSED_COMMITS). ` +
      `Pass ${AFTER_FREEZE_FLAG} once it is.`
    );
  }
  if (freeze === null) return `${AFTER_FREEZE_FLAG} was passed, but the runner is not frozen (${FREEZE_FILE} is missing).`;
  return null;
}

/**
 * The guard every corpus command runs first. Once frozen, it also rebuilds `rastro-core` and
 * `babel-plugin-rastro`: both are loaded from `dist`, so a stale build would run code the
 * frozen source does not contain while the source comparison passed.
 */
export function prepareRunner(app: CorpusApp, commit: CorpusCommit, afterFreeze: boolean): Freeze | null {
  const freeze = readFreeze();
  const verdict = freezeVerdict({
    app: app.id,
    commit,
    afterFreeze,
    freeze,
    drift: freeze === null ? [] : runnerDrift(freeze.commit),
  });
  if (verdict !== null) throw new Error(verdict);
  if (freeze !== null) {
    const built = spawnSync('pnpm', ['--filter', 'rastro-core', '--filter', 'babel-plugin-rastro', 'run', 'build'], {
      cwd: REPO_DIR,
      stdio: 'inherit',
    });
    if (built.status !== 0) throw new Error('could not rebuild rastro-core and babel-plugin-rastro from the frozen source');
  }
  return freeze;
}

/** `<root>/<kind>/<app>/<nn>-<sha7>/`, the directory every artifact for one commit lives under. */
export function commitDirectory(kind: 'builds' | 'captures', app: CorpusApp, commit: CorpusCommit): string {
  return join(
    corpusRoot(),
    kind,
    app.id,
    `${String(commit.index).padStart(2, '0')}-${commit.sha.slice(0, 7)}`,
  );
}

function git(args: string[], cwd: string = REPO_DIR): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * The rastro commit a result came from, whether the tree had uncommitted changes, and the
 * commit the runner was frozen at, null before the freeze. Every result after the freeze
 * names the freeze it ran under.
 */
export function rastroRevision(): { commit: string; dirty: boolean; frozen: string | null } {
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']) !== '',
    frozen: readFreeze()?.commit ?? null,
  };
}
