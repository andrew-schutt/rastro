// scripts/identity-spike/corpus/build.ts
// Build one corpus app at one CORPUS.md commit, with the harness patch, by hand.
//
//   node scripts/identity-spike/corpus/build.ts <actual|react-admin> <commit> [variant…]
//
// <commit> is CORPUS.md's index (1–10) or a sha prefix. Variants default to both
// (`as-shipped`, `mangled`). Builds land in $RASTRO_CORPUS/builds/<app>/<nn>-<sha7>/<variant>/,
// next to a build.json saying exactly what made them.
//
// THIRD-PARTY CODE. This clones the app and runs its own install scripts. It is run by hand,
// locally, and never in CI: nothing in the test suite imports or spawns it.
//
// Until the runner is frozen, only the commits the 2026-10-30 build check had already built may
// be built (manifest.ts, EXPOSED_COMMITS). `--after-freeze` lifts that, and exists so that
// lifting it is a deliberate act that shows up in the command line, not a default.
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
import { PATCH_MARKER, patchViteConfig, type PatchPaths } from './patch.ts';
import {
  AFTER_FREEZE_FLAG,
  assertExposed,
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
function patchPaths(app: CorpusApp, clone: string): PatchPaths {
  const require = createRequire(join(SPIKE_DIR, 'package.json'));
  const rastroPlugin = require.resolve('babel-plugin-rastro');
  if (!existsSync(rastroPlugin)) {
    throw new Error(`${rastroPlugin} is missing. Run \`pnpm -r build\` in the rastro repo first.`);
  }
  return {
    rastroPlugin,
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

/** Every built script's bytes, in a stable order, so two builds can be compared. */
function scriptBytes(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.m?js$/.test(entry) && statSync(join(dir, entry)).isFile())
    .sort()
    .map((entry) => readFileSync(join(dir, entry), 'utf8'))
    .join('\n');
}

/**
 * A mangled build identical to the as-shipped one means the flip did nothing, and strategy 3
 * would be scored on names it was meant to lose. Comparing the bundles is the check that does
 * not measure strategy 3 itself.
 */
function assertVariantsDiffer(commitDir: string): void {
  const shipped = join(commitDir, 'as-shipped', 'app');
  const mangled = join(commitDir, 'mangled', 'app');
  if (!existsSync(shipped) || !existsSync(mangled)) return;
  if (scriptBytes(shipped) === scriptBytes(mangled)) {
    throw new Error(`${commitDir}: the mangled build is identical to as-shipped. The flip did nothing.`);
  }
  console.log('  ok: the mangled bundle differs from as-shipped');
}

function buildVariant(
  app: CorpusApp,
  commit: CorpusCommit,
  variant: BuildVariant,
  clone: string,
  outDir: string,
): void {
  const configPath = join(clone, app.viteConfig);
  const original = readFileSync(configPath, 'utf8');
  const patched = patchViteConfig(app.id, original, variant, patchPaths(app, clone));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
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
  const marked = bundleCarries(join(outDir, 'app'), '__rastroMark');
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
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        patchMarker: patched.includes(PATCH_MARKER),
        bundle: { stamped, marked },
      },
      null,
      2,
    )}\n`,
  );
  if (!stamped || !marked) {
    throw new Error(
      `${app.id} ${variant}: the bundle carries ${stamped ? '' : 'no stamps '}` +
        `${marked ? '' : 'no marks '}— the patch did not reach the build. See ${outDir}.`,
    );
  }
  console.log(`  ok: ${join(outDir, 'app')}`);
}

function main(argv: string[]): void {
  const afterFreeze = argv.includes(AFTER_FREEZE_FLAG);
  const [appArg, commitArg, ...variantArgs] = argv.filter((arg) => arg !== AFTER_FREEZE_FLAG);
  if (appArg === undefined || commitArg === undefined || !(appArg in CORPUS)) {
    throw new Error('usage: build.ts <actual|react-admin> <commit> [as-shipped|mangled …] [--after-freeze]');
  }
  const app = CORPUS[appArg as AppId];
  const commit = findCommit(app, commitArg);

  assertExposed(app, commit, afterFreeze);

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
  run(['corepack', 'yarn', 'install', '--immutable'], {
    cwd: clone,
    log: join(root, 'logs', `${app.id}-${commit.sha.slice(0, 7)}-install.log`),
  });

  const commitDir = commitDirectory('builds', app, commit);
  for (const variant of variants as BuildVariant[]) {
    buildVariant(app, commit, variant, clone, join(commitDir, variant));
  }
  assertVariantsDiffer(commitDir);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
