// scripts/identity-spike/corpus/runtime.ts
// What every corpus command shares: where third-party code lives, the freeze guard, and the
// rastro revision a result was made with. One copy, so build and capture cannot drift apart on
// the rules that keep the run honest.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { EXPOSED_COMMITS, type CorpusApp, type CorpusCommit } from './manifest.ts';

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
 * Until the runner is frozen, only the commits the 2026-10-30 build check already built may be
 * built or captured. A runner debugged on the commits it measures is tuned on its own numbers.
 */
export function assertExposed(app: CorpusApp, commit: CorpusCommit, afterFreeze: boolean): void {
  if (commit.sha === EXPOSED_COMMITS[app.id] || afterFreeze) return;
  throw new Error(
    `${app.id} commit ${commit.index} has never been built. Until the runner is frozen, only ` +
      `${EXPOSED_COMMITS[app.id].slice(0, 7)} may be (manifest.ts, EXPOSED_COMMITS). ` +
      `Pass ${AFTER_FREEZE_FLAG} once it is.`,
  );
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

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** The rastro commit a result came from, and whether the tree had uncommitted changes. */
export function rastroRevision(): { commit: string; dirty: boolean } {
  return { commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']) !== '' };
}
