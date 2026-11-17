// scripts/identity-spike/scoring/git.ts
// A commit pair's diff, read from a corpus app's clone for `touched.ts`.
//
// Object reads only (`git diff`, `git show`), never a checkout, so scoring can read a clone the
// run is checking commits out in. Renames count as a delete plus an add: a component whose file
// moved has a different source path in every stamp, and the old path is gone.
import { spawnSync } from 'node:child_process';
import { parseHunks, type Hunk, type PairDiff } from './touched.ts';

function git(repo: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout };
}

export function pairDiff(repo: string, older: string, newer: string): PairDiff {
  const status = git(repo, ['diff', '--no-renames', '--name-status', older, newer]);
  if (!status.ok) throw new Error(`git diff ${older} ${newer} failed in ${repo}`);
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const line of status.out.split('\n')) {
    const [kind, path] = line.split('\t');
    if (kind === undefined || path === undefined) continue;
    changed.add(path);
    if (kind === 'D') deleted.add(path);
  }
  const hunks = new Map<string, Hunk[]>();
  return {
    changed,
    deleted,
    hunks: (path) => {
      let found = hunks.get(path);
      if (found === undefined) {
        found = parseHunks(git(repo, ['diff', '--no-renames', '-U0', older, newer, '--', path]).out);
        hunks.set(path, found);
      }
      return found;
    },
    before: (path) => {
      const shown = git(repo, ['show', `${older}:${path}`]);
      return shown.ok ? shown.out : null;
    },
  };
}
