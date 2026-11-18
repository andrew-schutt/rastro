// scripts/identity-spike/scoring/git.test.ts
// pairDiff against a real repository built in a temporary directory.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { pairDiff } from './git.ts';
import { touchAncestry } from './touched.ts';

let repo: string;
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function commit(files: Record<string, string | null>): string {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) rmSync(join(repo, path));
    else {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
  }
  const run = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  run('add', '-A');
  run('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'c');
  return run('rev-parse', 'HEAD');
}

it('reads changed, deleted and moved files, the old side of each hunk, and the older source', () => {
  repo = mkdtempSync(join(tmpdir(), 'rastro-pair-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const older = commit({
    'demo/src/A.tsx': 'export function A() {\n  return <a />;\n}\n\nexport function B() {\n  return <b />;\n}\n',
    'demo/src/Gone.tsx': 'export function Gone() { return null; }\n',
    'demo/src/Moved.tsx': 'export function Moved() { return null; }\n',
  });
  const newer = commit({
    'demo/src/A.tsx': 'export function A() {\n  return <a />;\n}\n\nexport function B() {\n  return <b title="x" />;\n}\n',
    'demo/src/Gone.tsx': null,
    'demo/src/Moved.tsx': null,
    'demo/src/moved/Moved.tsx': 'export function Moved() { return null; }\n',
  });
  const diff = pairDiff(repo, older, newer);

  expect([...diff.changed].sort()).toEqual(['demo/src/A.tsx', 'demo/src/Gone.tsx', 'demo/src/Moved.tsx', 'demo/src/moved/Moved.tsx']);
  expect([...diff.deleted].sort()).toEqual(['demo/src/Gone.tsx', 'demo/src/Moved.tsx']);
  expect(diff.hunks('demo/src/A.tsx')).toEqual([{ start: 6, count: 1 }]);
  expect(diff.before('demo/src/A.tsx')).toContain('return <b />');
  expect(diff.before('demo/src/moved/Moved.tsx')).toBeNull();

  const touch = (name: string, file: string) => touchAncestry([{ name, file }], 'demo', diff).touch;
  expect([touch('A', 'src/A.tsx'), touch('B', 'src/A.tsx'), touch('Gone', 'src/Gone.tsx'), touch('Moved', 'src/Moved.tsx')]).toEqual([
    'untouched',
    'touched',
    'touched',
    'touched',
  ]);
});
