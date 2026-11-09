// scripts/identity-spike/corpus/capture.ts
// Capture every pre-registered screen of a built corpus app, under all six strategies, twice.
//
//   node scripts/identity-spike/corpus/capture.ts <actual|react-admin> <commit> [variant…]
//
// Needs the build from build.ts. Writes to $RASTRO_CORPUS/captures/<app>/<nn>-<sha7>/<variant>/:
// load-1.json and load-2.json (every screen's elements and their six fingerprints), and
// rebuild-control.json. Prints counts and verdicts only, never a fingerprint, so a capture can be
// checked for having worked without its output being read.
//
// THIRD-PARTY CODE runs in the browser. By hand, locally, never in CI. Same freeze rule as
// build.ts: only the exposed commits until `--after-freeze`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build as esbuild } from 'esbuild';
import type { CapturedElement, PageCapture } from '../src/page.ts';
import type { CorpusStrategy } from '../src/strategies.ts';
import { DRIVERS } from './apps.ts';
import { launch, type Browser, type Page, type Settle, type WorkerCheck } from './browser.ts';
import { FIXED_TIME_MS, initScript, LOCALE, SEED, TIME_ZONE, VIEWPORT } from './conditions.ts';
import { BUILD_VARIANTS, CORPUS, findCommit, type AppId, type BuildVariant, type CorpusApp, type CorpusCommit } from './manifest.ts';
import { rebuildControl, type ScreenCapture } from './rebuild.ts';
import { AFTER_FREEZE_FLAG, assertExposed, commitDirectory, rastroRevision, SPIKE_DIR } from './runtime.ts';
import { serve } from './serve.ts';

/** The rebuild control: each build is loaded this many times, each in a fresh browser context. */
const LOADS = 2;

/**
 * Strategies whose load-to-load stability is measured and reported, but which do not judge the
 * runner (CORPUS.md, 2026-11-09 amendment). The selector path keeps element ids, as PostHog's
 * elements_chain does, and Actual's react-aria ids come from React's useId, which numbers by
 * mount order. That is the strategy's own behaviour on a reload, not the runner's noise.
 */
const REPORTED_ONLY: readonly CorpusStrategy[] = ['selector-path'];

interface ScreenRecord extends ScreenCapture {
  location?: string;
  settle?: Settle;
}

interface LoadRecord {
  load: number;
  entered: boolean;
  entryError?: string;
  screens: ScreenRecord[];
  workers: WorkerCheck[];
  errors: string[];
}

async function pageBundle(): Promise<string> {
  const result = await esbuild({
    entryPoints: [join(SPIKE_DIR, 'src', 'page.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const [file] = result.outputFiles;
  if (file === undefined) throw new Error('esbuild produced no page bundle');
  return file.text;
}

/** Best effort: a failed screenshot must not hide the failure it was taken for. */
async function saveScreenshot(page: Page, path: string): Promise<void> {
  try {
    writeFileSync(path, await page.screenshot());
    console.log(`    screenshot: ${path}`);
  } catch {
    // The page may be gone; the error is already recorded.
  }
}

async function captureLoad(
  browser: Browser,
  app: CorpusApp,
  base: string,
  pending: () => string[],
  bundle: string,
  load: number,
  out: string,
): Promise<{ record: LoadRecord; strategies: CorpusStrategy[] }> {
  const driver = DRIVERS[app.id];
  const page = await browser.newPage({
    init: initScript(),
    pending,
    bypassServiceWorker: driver.bypassServiceWorker,
  });
  let strategies: CorpusStrategy[] = [];
  const record: LoadRecord = { load, entered: false, screens: [], workers: [], errors: [] };
  try {
    try {
      await driver.enter(page, base);
      record.entered = true;
    } catch (error) {
      record.entryError = error instanceof Error ? error.message : String(error);
      await saveScreenshot(page, join(out, `load-${load}-entry.png`));
    }
    for (const screen of record.entered ? app.screens : []) {
      try {
        const settle = await driver.open(page, base, screen);
        await page.evaluate(bundle);
        const capture = await page.evaluate<PageCapture & { strategies: CorpusStrategy[] }>(
          '({ ...window.__rastroCorpus.capturePage(), strategies: window.__rastroCorpus.strategies })',
        );
        if (!capture.annotated) {
          throw new Error('the page carries no stamps: strategy 5 would read fibers. Not the pre-registered build.');
        }
        strategies = capture.strategies;
        record.screens.push({
          screen,
          captured: true,
          location: await page.evaluate<string>('location.href.replace(location.origin, "")'),
          settle,
          elements: capture.elements,
        });
      } catch (error) {
        await saveScreenshot(page, join(out, `load-${load}-${screen.replace(/[^a-z0-9]+/gi, '_')}.png`));
        record.screens.push({
          screen,
          captured: false,
          error: error instanceof Error ? error.message : String(error),
          elements: [] as CapturedElement[],
        });
      }
    }
    record.workers = await page.workers();
    record.errors = page.errors();
  } finally {
    await page.close().catch(() => {});
  }
  return { record, strategies };
}

async function captureVariant(
  browser: Browser,
  app: CorpusApp,
  commit: CorpusCommit,
  variant: BuildVariant,
  bundle: string,
): Promise<boolean> {
  const built = join(commitDirectory('builds', app, commit), variant);
  const appDir = join(built, 'app');
  if (!existsSync(appDir)) throw new Error(`no build at ${appDir}. Run build.ts first.`);
  const buildInfo = JSON.parse(readFileSync(join(built, 'build.json'), 'utf8')) as {
    bundle: { stamped: boolean; marked: boolean };
    rastro: { commit: string; dirty: boolean };
  };

  const out = join(commitDirectory('captures', app, commit), variant);
  mkdirSync(out, { recursive: true });
  const served = await serve(appDir, {
    crossOriginIsolated: DRIVERS[app.id].crossOriginIsolated,
    workerPrelude: initScript(),
  });

  const loads: LoadRecord[] = [];
  let strategies: CorpusStrategy[] = [];
  try {
    for (let load = 1; load <= LOADS; load += 1) {
      console.log(`  ${variant}: load ${load}`);
      const result = await captureLoad(browser, app, served.url, served.pending, bundle, load, out);
      if (result.strategies.length > 0) strategies = result.strategies;
      loads.push(result.record);
      writeFileSync(join(out, `load-${load}.json`), `${JSON.stringify(result.record, null, 2)}\n`);
    }
  } finally {
    await served.close();
  }

  const [first, second] = loads;
  const verdict = rebuildControl(app.screens, first?.screens ?? [], second?.screens ?? [], strategies, REPORTED_ONLY);
  writeFileSync(join(out, 'rebuild-control.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  writeFileSync(
    join(out, 'capture.json'),
    `${JSON.stringify(
      {
        app: app.id,
        commit: commit.index,
        sha: commit.sha,
        variant,
        rastro: rastroRevision(),
        build: { rastro: buildInfo.rastro },
        browser: { version: browser.version, userAgent: browser.userAgent },
        runConditions: {
          viewport: VIEWPORT,
          locale: LOCALE,
          timeZone: TIME_ZONE,
          clock: new Date(FIXED_TIME_MS).toISOString(),
          clockMode: 'frozen',
          seed: SEED,
          seeded: ['Math.random', 'crypto.getRandomValues', 'crypto.randomUUID'],
          serviceWorkers: DRIVERS[app.id].bypassServiceWorker ? 'bypassed' : 'served with the run conditions prepended',
          loads: LOADS,
        },
        strategies,
        rebuildControl: verdict.passed,
      },
      null,
      2,
    )}\n`,
  );

  // Counts and verdicts only. A fingerprint printed here would be read.
  let ok = verdict.passed;
  for (const load of loads) {
    if (!load.entered) {
      ok = false;
      console.log(`    load ${load.load}: could not enter the app: ${load.entryError}`);
    }
    const unseeded = load.workers.filter((worker) => worker.conditions === false);
    if (unseeded.length > 0) {
      ok = false;
      console.log(`    load ${load.load}: workers without the run conditions: ${unseeded.map((w) => w.url).join(', ')}`);
    }
    const unreachable = load.workers.filter((worker) => worker.conditions === 'unreachable');
    if (unreachable.length > 0) {
      console.log(`    load ${load.load}: workers that did not answer (recorded): ${unreachable.map((w) => w.url).join(', ')}`);
    }
    if (load.errors.length > 0) console.log(`    load ${load.load}: ${load.errors.length} page error(s), in load-${load.load}.json`);
    for (const screen of load.screens) {
      if (!screen.captured) console.log(`    load ${load.load}: ${screen.screen}: NOT CAPTURED: ${screen.error}`);
      else if (screen.settle?.settled === false) console.log(`    load ${load.load}: ${screen.screen}: did not settle, captured anyway`);
    }
  }
  for (const screen of verdict.screens) {
    const state = screen.uncaptured === true ? 'uncaptured' : screen.unstable.length === 0 ? 'stable' : `UNSTABLE: ${screen.unstable.join(', ')}`;
    const reported = screen.reported.length === 0 ? '' : `; reported, not judged: ${screen.reported.join(', ')} differs between loads`;
    console.log(`    ${screen.screen}: ${screen.elements[0]}/${screen.elements[1]} elements, ${state}${reported}`);
  }
  console.log(`  ${variant}: rebuild control ${verdict.passed ? 'passed' : 'FAILED'}${ok ? '' : ', with failures above'}`);
  return ok;
}

async function main(argv: string[]): Promise<boolean> {
  const afterFreeze = argv.includes(AFTER_FREEZE_FLAG);
  const [appArg, commitArg, ...variantArgs] = argv.filter((arg) => arg !== AFTER_FREEZE_FLAG);
  if (appArg === undefined || commitArg === undefined || !(appArg in CORPUS)) {
    throw new Error(`usage: capture.ts <actual|react-admin> <commit> [as-shipped|mangled …] [${AFTER_FREEZE_FLAG}]`);
  }
  const app = CORPUS[appArg as AppId];
  const commit = findCommit(app, commitArg);
  assertExposed(app, commit, afterFreeze);
  const variants = (variantArgs.length === 0 ? BUILD_VARIANTS : variantArgs) as BuildVariant[];
  for (const variant of variants) {
    if (!BUILD_VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
  }

  console.log(`${app.id} commit ${commit.index} (${commit.sha.slice(0, 7)})`);
  const bundle = await pageBundle();
  const browser = await launch();
  let ok = true;
  try {
    for (const variant of variants) ok = (await captureVariant(browser, app, commit, variant, bundle)) && ok;
  } finally {
    await browser.close();
  }
  return ok;
}

main(process.argv.slice(2)).then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
