// scripts/identity-spike/corpus/manifest.test.ts
// The manifest must say exactly what docs/CORPUS.md says. Reads the doc; clones nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS, EXPOSED_COMMITS, findCommit, type AppId } from './manifest.ts';

const DOC = readFileSync(resolve(import.meta.dirname, '../../../docs/CORPUS.md'), 'utf8');

/** The text between one heading and the next heading of the same or higher level. */
function section(heading: string): string {
  const start = DOC.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`CORPUS.md has no "${heading}" heading`);
  const level = heading.split(' ')[0] ?? '';
  const rest = DOC.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level.length}} `));
  return next === -1 ? rest : rest.slice(0, next);
}

/** `| n | \`sha\` | date |` rows, in order. */
function commitRows(text: string): { index: number; sha: string; date: string }[] {
  return [...text.matchAll(/^\| (\d+) \| `([0-9a-f]{40})` \| (\d{4}-\d{2}-\d{2})/gm)].map(
    ([, index, sha, date]) => ({ index: Number(index), sha: sha ?? '', date: date ?? '' }),
  );
}

const HEADINGS: Record<AppId, string> = {
  actual: '### Actual Budget',
  'react-admin': '### react-admin demo',
};

describe('manifest.ts against docs/CORPUS.md', () => {
  for (const id of Object.keys(CORPUS) as AppId[]) {
    const app = CORPUS[id];

    it(`${id}: the ten commits match, in order`, () => {
      const rows = commitRows(section(HEADINGS[id]));
      expect(rows).toHaveLength(10);
      expect(app.commits).toEqual(rows);
    });
  }

  it('the pins match the apps table', () => {
    const pins = section('## The apps').match(/^\| Pinned \(build-checked\) \| `([0-9a-f]{40})`.*\| `([0-9a-f]{40})`/m);
    expect([pins?.[1], pins?.[2]]).toEqual([CORPUS.actual.pin, CORPUS['react-admin'].pin]);
  });

  it('the build commands match the apps table', () => {
    const builds = section('## The apps').match(/^\| Build \| (.*) \| (.*) \|$/m);
    expect(builds?.[1]).toContain(`\`${CORPUS.actual.build.command.join(' ')}\``);
    const reactAdmin = CORPUS['react-admin'].build;
    const envPart = Object.entries(reactAdmin.env).map(([key, value]) => `${key}=${value}`).join(' ');
    expect(builds?.[2]).toBe(`\`${envPart} ${reactAdmin.command.join(' ')}\``);
  });

  it('the routed screens match, and the one unrouted screen is the one CORPUS.md describes', () => {
    const screens = section('## Screens');
    const routes = (label: string) => {
      const paragraph = screens.match(new RegExp(`\\*\\*${label}\\*\\*([^]*?)(?:\\n\\n|$)`))?.[1] ?? '';
      return [...paragraph.matchAll(/`(\/[^`]*)`/g)].map(([, route]) => route);
    };

    expect(routes('Actual\\.')).toEqual(CORPUS.actual.screens.filter((s) => s.startsWith('/')));
    expect(routes('react-admin demo\\.')).toEqual(CORPUS['react-admin'].screens);
    expect(screens).toContain('the register of the first account listed under "On budget"');
    expect(CORPUS.actual.screens.filter((s) => !s.startsWith('/'))).toEqual([
      'first on-budget account register',
    ]);
  });

  it('the exposed commits are the ones the 2026-10-30 build check built, or stand in for', () => {
    // Actual's pin is its commit 10. React-admin's pin is not in its list; CORPUS.md says
    // commit 10 builds the same app, so it stands in.
    expect(EXPOSED_COMMITS.actual).toBe(CORPUS.actual.pin);
    expect(CORPUS.actual.commits.at(-1)?.sha).toBe(CORPUS.actual.pin);
    expect(EXPOSED_COMMITS['react-admin']).toBe(CORPUS['react-admin'].commits.at(-1)?.sha);
    expect(DOC).toContain('So it builds the app that was build-checked.');
  });
});

describe('findCommit', () => {
  it('resolves an index, a sha prefix and a full sha to the same commit', () => {
    const tenth = CORPUS.actual.commits.at(-1);
    expect(findCommit(CORPUS.actual, '10')).toBe(tenth);
    expect(findCommit(CORPUS.actual, 'e82ea4d')).toBe(tenth);
    expect(findCommit(CORPUS.actual, CORPUS.actual.pin)).toBe(tenth);
  });

  it('refuses anything that is not one of the ten', () => {
    expect(() => findCommit(CORPUS.actual, '11')).toThrow(/none of CORPUS.md's ten/);
    expect(() => findCommit(CORPUS.actual, 'e82')).toThrow(/none of CORPUS.md's ten/);
    expect(() => findCommit(CORPUS['react-admin'], CORPUS['react-admin'].pin)).toThrow(
      /none of CORPUS.md's ten/,
    );
  });
});
