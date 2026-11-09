// scripts/identity-spike/corpus/manifest.ts
// docs/CORPUS.md as data, for the corpus runner.
//
// CORPUS.md is the pre-registration and stays the source of truth. This file is a transcription
// of it, and `manifest.test.ts` fails CI the moment the two disagree on a commit, a pin or a
// screen, without cloning anything. A runner that read a hand-edited copy would let a commit
// change after a number was seen, which is the one thing the pre-registration forbids.

export type AppId = 'actual' | 'react-admin';

/**
 * Which build of a commit. §3.2 rule 1 measures strategies 1, 2, 4, 5 and 6 on the app as it
 * ships, and strategy 3 (the unmarked fiber walk, which reads function names) on a rebuild with
 * identifier mangling forced on, because both corpus apps keep names and most apps do not.
 * Strategy 3's as-shipped numbers come from `as-shipped` and are reported beside, not instead.
 */
export type BuildVariant = 'as-shipped' | 'mangled';

export const BUILD_VARIANTS: readonly BuildVariant[] = ['as-shipped', 'mangled'];

export interface CorpusCommit {
  /** 1-based, as numbered in CORPUS.md. Consecutive pairs are the deploys. */
  index: number;
  sha: string;
  /** Committer date, as CORPUS.md lists it. */
  date: string;
}

export interface CorpusApp {
  id: AppId;
  /** Clone URL. Third-party code: built by hand, locally, never in CI. */
  repository: string;
  /** The commit that was build-checked on 2026-10-30. */
  pin: string;
  /** The ten commits, oldest first. */
  commits: readonly CorpusCommit[];
  /** Repo-relative directory the build runs in. */
  buildDirectory: string;
  /** The build, as CORPUS.md gives it: environment, then the command. */
  build: { env: Readonly<Record<string, string>>; command: readonly string[] };
  /** Repo-relative directory the build writes the app to. */
  outputDirectory: string;
  /** Repo-relative Vite config the harness patch edits. */
  viteConfig: string;
  /**
   * `babel-plugin-rastro`'s `root`, relative to the clone. It is part of every stamped path,
   * so it is fixed here, never left to Babel's default (which follows cwd).
   */
  pluginRoot: string;
  /** The screens CORPUS.md lists, by route or by the name it gives them. */
  screens: readonly string[];
}

export const CORPUS: Readonly<Record<AppId, CorpusApp>> = {
  actual: {
    id: 'actual',
    repository: 'https://github.com/actualbudget/actual.git',
    pin: 'e82ea4dc3594e7e0c32ba7b1039913c19e6ce9f9',
    commits: [
      { index: 1, sha: '7f74953a5422c480e09175013ff872b9fd29500b', date: '2026-10-01' },
      { index: 2, sha: '821caa264304b391f62216e4affa1ee5e6dc5410', date: '2026-10-03' },
      { index: 3, sha: '1ad8477abdc432f318be27dc2fde25dde6ab0720', date: '2026-10-06' },
      { index: 4, sha: '358823017c93dbe5bf4bd469e6b49eb2cac00cf8', date: '2026-10-09' },
      { index: 5, sha: '52ac1f91e5b8c28311354a6faad6bed0d9ec7f8e', date: '2026-10-12' },
      { index: 6, sha: '63180ceeabb119a9184200b04f388a6394f90073', date: '2026-10-17' },
      { index: 7, sha: '6e68ee1de1c54cf3b8c69d17aa1c4fde219f64e2', date: '2026-10-21' },
      { index: 8, sha: '168e174b47c0dc8a5cf4b0e9aef808371c6e393d', date: '2026-10-25' },
      { index: 9, sha: 'd9d15c12fa41a0bb8380fab09519e0180333e146', date: '2026-10-27' },
      { index: 10, sha: 'e82ea4dc3594e7e0c32ba7b1039913c19e6ce9f9', date: '2026-10-30' },
    ],
    buildDirectory: '.',
    build: { env: {}, command: ['corepack', 'yarn', 'build:browser', '--skip-translations'] },
    outputDirectory: 'packages/desktop-client/build',
    viteConfig: 'packages/desktop-client/vite.config.mts',
    pluginRoot: '.',
    screens: ['/budget', '/reports', '/schedules', '/settings', '/accounts', 'first on-budget account register'],
  },
  'react-admin': {
    id: 'react-admin',
    repository: 'https://github.com/marmelab/react-admin.git',
    pin: '7845c813503898db5ec25365855f84ad7d070e56',
    commits: [
      { index: 1, sha: '47890673cae903b9c5a33898c07a12ea94205b5a', date: '2026-10-02' },
      { index: 2, sha: 'c2f0b8ffd19af658241cb10b67f0de18744136f5', date: '2026-10-11' },
      { index: 3, sha: 'eec76175e77e1a47a7ec6471346c4f2fbdb940a1', date: '2026-10-11' },
      { index: 4, sha: 'd19769a44762b9314e2d12a06b4b9ea9546929d9', date: '2026-10-11' },
      { index: 5, sha: 'a66bd3ec1c279a70d13758c7ba86e72b10d25a4e', date: '2026-10-16' },
      { index: 6, sha: 'a13cab504a42fb7888f9ede38cbc32a2e60ff69c', date: '2026-10-19' },
      { index: 7, sha: '089ad1bf6d55500eab228f3833d12a5dbaf530cb', date: '2026-10-24' },
      { index: 8, sha: 'fa22e2db862a6ea85941fa88cb294622c3012df4', date: '2026-10-25' },
      { index: 9, sha: '679e5e17cd6803abf722acdfb0d1add34067a65f', date: '2026-10-25' },
      { index: 10, sha: '61acd3f62174b9c2d3c1aa5856c7411d7713aaab', date: '2026-10-25' },
    ],
    buildDirectory: 'examples/demo',
    build: {
      env: { REACT_APP_DATA_PROVIDER: 'rest', NODE_ENV: 'production' },
      command: ['corepack', 'yarn', 'vite', 'build'],
    },
    outputDirectory: 'examples/demo/dist',
    viteConfig: 'examples/demo/vite.config.ts',
    pluginRoot: 'examples/demo',
    screens: ['/', '/orders', '/invoices', '/products', '/categories', '/customers', '/segments', '/reviews'],
  },
};

/**
 * The commits the runner may build while it is being written: those the 2026-10-30 build
 * check had already built. Everything else stays unbuilt until the runner is frozen, so it
 * cannot be tuned on the numbers it produces.
 *
 * Actual's pin is commit 10. React-admin's pin is not in its list, but commit 10 builds the
 * same app (CORPUS.md: no build input changes between them), so commit 10 stands for it.
 */
export const EXPOSED_COMMITS: Readonly<Record<AppId, string>> = {
  actual: 'e82ea4dc3594e7e0c32ba7b1039913c19e6ce9f9',
  'react-admin': '61acd3f62174b9c2d3c1aa5856c7411d7713aaab',
};

/** Resolve `10`, `7f74953`, or a full sha to one of an app's commits, or throw. */
export function findCommit(app: CorpusApp, ref: string): CorpusCommit {
  const asIndex = Number(ref);
  const matches = Number.isInteger(asIndex) && String(asIndex) === ref
    ? app.commits.filter((commit) => commit.index === asIndex)
    : ref.length >= 7
      ? app.commits.filter((commit) => commit.sha.startsWith(ref))
      : [];
  const [match] = matches;
  if (match === undefined || matches.length > 1) {
    throw new Error(`${app.id}: "${ref}" names none of CORPUS.md's ten commits`);
  }
  return match;
}
