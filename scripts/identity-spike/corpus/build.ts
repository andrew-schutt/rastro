// scripts/identity-spike/corpus/build.ts
// Build one corpus app at one CORPUS.md commit, with the harness patch, by hand.
//
//   node scripts/identity-spike/corpus/build.ts <actual|react-admin> <commit> [variant…]
//
// <commit> is CORPUS.md's index (1–10) or a sha prefix. The one variant is `as-shipped`.
// Builds land in $RASTRO_CORPUS/builds/<app>/<nn>-<sha7>/<variant>/,
// next to a build.json saying exactly what made them.
//
// THIRD-PARTY CODE. This clones the app and runs its own install scripts. It is run by hand,
// locally, and never in CI: nothing in the test suite imports or spawns it.
//
// The freeze guard (runtime.ts, `prepareRunner`) runs first. Before the freeze, only the exposed
// commits may be built. After it, every build runs the frozen runner or is refused, and the other
// commits also need `--after-freeze`, so lifting the rule is a deliberate act that shows up in
// the command line, not a default.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { join, resolve } from 'node:path';
import {
  BUILD_VARIANTS,
  CORPUS,
  findCommit,
  type AppId,
  type BuildVariant,
  type CorpusApp,
  type CorpusCommit,
} from './manifest.ts';
import { installDifference } from './lockfile.ts';
import { PATCH_MARKER, patchViteConfig, type PatchPaths } from './patch.ts';
import { MARK_PROPERTY, SITE_PROPERTY } from '../src/fiber.ts';
import {
  AFTER_FREEZE_FLAG,
  prepareRunner,
  commitDirectory,
  corpusRoot,
  rastroRevision,
  SPIKE_DIR,
} from './runtime.ts';

function run(
  command: readonly string[],
  options: { cwd: string; env?: Readonly<Record<string, string>>; log?: string },
): string {
  const [file, ...args] = command;
  if (file === undefined) throw new Error('empty command');
  const fd = options.log === undefined ? undefined : openSync(options.log, 'a');
  try {
    const result = spawnSync(file, args, {
      cwd: options.cwd,
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', ...options.env },
      stdio: fd === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', fd, fd],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      const tail = fd === undefined ? `\n${result.stderr}` : ` — see ${options.log}`;
      throw new Error(`\`${command.join(' ')}\` exited ${result.status} in ${options.cwd}${tail}`);
    }
    return typeof result.stdout === 'string' ? result.stdout.trim() : '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Clone once, blobless, then check out exactly the commit with no local changes. */
function checkout(app: CorpusApp, commit: CorpusCommit, clone: string): void {
  if (!existsSync(join(clone, '.git'))) {
    console.log(`  cloning ${app.repository} → ${clone}`);
    run(['git', 'clone', '--quiet', '--filter=blob:none', '--no-checkout', app.repository, clone], {
      cwd: corpusRoot(),
    });
  }
  run(['git', 'checkout', '--force', '--quiet', commit.sha], { cwd: clone });
  const head = run(['git', 'rev-parse', 'HEAD'], { cwd: clone });
  if (head !== commit.sha) throw new Error(`${app.id}: HEAD is ${head}, wanted ${commit.sha}`);
  const dirty = run(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: clone });
  if (dirty !== '') throw new Error(`${app.id}: tracked files differ from ${commit.sha}:\n${dirty}`);
}

/** The absolute paths the patch writes into a foreign config, resolved from this package. */
function patchPaths(app: CorpusApp, clone: string, markPlugin: string, sitePlugin: string): PatchPaths {
  const require = createRequire(join(SPIKE_DIR, 'package.json'));
  const rastroPlugin = require.resolve('babel-plugin-rastro');
  if (!existsSync(rastroPlugin)) {
    throw new Error(`${rastroPlugin} is missing. Run \`pnpm -r build\` in the rastro repo first.`);
  }
  return {
    rastroPlugin,
    markPlugin,
    sitePlugin,
    rolldownBabel: require.resolve('@rolldown/plugin-babel'),
    pluginRoot: resolve(clone, app.pluginRoot),
  };
}

/** Does any built script carry the markers? Proof the patch reached the bundle, not a metric. */
function bundleCarries(dir: string, needle: string): boolean {
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, entry);
    if (!/\.m?js$/.test(entry) || !statSync(path).isFile()) continue;
    if (readFileSync(path, 'utf8').includes(needle)) return true;
  }
  return false;
}

/**
 * One of the measurement's plugins (`mark-plugin.ts`, `site-plugin.ts`), bundled into one
 * CommonJS file the app's own Babel can load: they are TypeScript in this package, and the marks
 * import the build plugin's naming rule.
 */
function bundlePlugin(source: string, outFile: string): void {
  buildSync({
    entryPoints: [join(SPIKE_DIR, 'src', source)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: outFile,
    logLevel: 'silent',
  });
}

function buildVariant(
  app: CorpusApp,
  commit: CorpusCommit,
  variant: BuildVariant,
  clone: string,
  outDir: string,
): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const markPlugin = join(outDir, 'mark-plugin.cjs');
  bundlePlugin('mark-plugin.ts', markPlugin);
  const sitePlugin = join(outDir, 'site-plugin.cjs');
  bundlePlugin('site-plugin.ts', sitePlugin);

  const configPath = join(clone, app.viteConfig);
  const original = readFileSync(configPath, 'utf8');
  const patched = patchViteConfig(app.id, original, patchPaths(app, clone, markPlugin, sitePlugin));
  const log = join(outDir, 'build.log');
  const startedAt = new Date();

  writeFileSync(configPath, patched);
  try {
    rmSync(join(clone, app.outputDirectory), { recursive: true, force: true });
    console.log(`  building ${variant} (log: ${log})`);
    run(app.build.command, { cwd: join(clone, app.buildDirectory), env: app.build.env, log });
  } finally {
    // Restore from git, not from memory, so the clone is provably back at the commit.
    run(['git', 'checkout', '--quiet', '--', app.viteConfig], { cwd: clone });
  }

  const built = join(clone, app.outputDirectory);
  if (!existsSync(built)) throw new Error(`${app.id}: the build wrote nothing to ${built}`);
  cpSync(built, join(outDir, 'app'), { recursive: true });

  const stamped = bundleCarries(join(outDir, 'app'), 'data-rastro-component');
  const marked = bundleCarries(join(outDir, 'app'), MARK_PROPERTY);
  const sited = bundleCarries(join(outDir, 'app'), SITE_PROPERTY);
  writeFileSync(join(outDir, 'vite.config.patched'), patched);
  writeFileSync(
    join(outDir, 'build.json'),
    `${JSON.stringify(
      {
        app: app.id,
        commit: commit.index,
        sha: commit.sha,
        variant,
        rastro: rastroRevision(),
        node: process.version,
        command: app.build.command,
        env: app.build.env,
        lockfile: commit.lockfileOutOfStep === undefined ? 'immutable' : `rewritten, same packages: ${commit.lockfileOutOfStep}`,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        patchMarker: patched.includes(PATCH_MARKER),
        bundle: { stamped, marked, sited },
      },
      null,
      2,
    )}\n`,
  );
  if (!stamped || !marked || !sited) {
    throw new Error(
      `${app.id} ${variant}: the bundle carries ${stamped ? '' : 'no stamps '}` +
        `${marked ? '' : 'no marks '}${sited ? '' : 'no sites '}— the patch did not reach the build. See ${outDir}.`,
    );
  }
  console.log(`  ok: ${join(outDir, 'app')}`);
}

/**
 * `--immutable`, except at a commit whose lockfile is out of step (manifest.ts says which). There
 * yarn may rewrite the lockfile, and the build is refused unless what it installs is unchanged.
 * The committed lockfile is restored afterwards, so the clone is back at the commit.
 */
function install(commit: CorpusCommit, clone: string, log: string): void {
  if (commit.lockfileOutOfStep === undefined) {
    run(['corepack', 'yarn', 'install', '--immutable'], { cwd: clone, log });
    return;
  }
  console.log(`  the lockfile is out of step (${commit.lockfileOutOfStep}); installing without --immutable`);
  const lockfile = join(clone, 'yarn.lock');
  const committed = readFileSync(lockfile, 'utf8');
  run(['corepack', 'yarn', 'install'], { cwd: clone, log });
  const difference = installDifference(committed, readFileSync(lockfile, 'utf8'));
  run(['git', 'checkout', '--quiet', '--', 'yarn.lock'], { cwd: clone });
  if (difference.length > 0) {
    throw new Error(`the rewritten lockfile installs different packages than the committed one:\n${difference.join('\n')}`);
  }
  console.log('  ok: the rewrite changed no resolved package or checksum');
}

function main(argv: string[]): void {
  const afterFreeze = argv.includes(AFTER_FREEZE_FLAG);
  const [appArg, commitArg, ...variantArgs] = argv.filter((arg) => arg !== AFTER_FREEZE_FLAG);
  if (appArg === undefined || commitArg === undefined || !(appArg in CORPUS)) {
    throw new Error('usage: build.ts <actual|react-admin> <commit> [as-shipped] [--after-freeze]');
  }
  const app = CORPUS[appArg as AppId];
  const commit = findCommit(app, commitArg);

  prepareRunner(app, commit, afterFreeze);

  const variants = variantArgs.length === 0 ? BUILD_VARIANTS : variantArgs;
  for (const variant of variants) {
    if (!BUILD_VARIANTS.includes(variant as BuildVariant)) throw new Error(`unknown variant ${variant}`);
  }

  const root = corpusRoot();
  mkdirSync(root, { recursive: true });
  const clone = join(root, app.id);
  console.log(`${app.id} commit ${commit.index} (${commit.sha.slice(0, 7)})`);
  checkout(app, commit, clone);
  console.log('  installing');
  mkdirSync(join(root, 'logs'), { recursive: true });
  install(commit, clone, join(root, 'logs', `${app.id}-${commit.sha.slice(0, 7)}-install.log`));

  const commitDir = commitDirectory('builds', app, commit);
  for (const variant of variants as BuildVariant[]) {
    buildVariant(app, commit, variant, clone, join(commitDir, variant));
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
