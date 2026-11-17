// scripts/identity-spike/scoring/captures.ts
// Reading the frozen run's captures, and choosing which one each strategy is judged on.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowRecord, StateRecord } from '../corpus/flows.ts';
import type { AppId, BuildVariant, CorpusApp, CorpusCommit } from '../corpus/manifest.ts';
import type { CorpusStrategy } from '../src/strategies.ts';

/** What `capture.ts` writes as `load-N.json`: the fields scoring reads. */
export interface Load {
  entered: boolean;
  screens: StateRecord[];
  flow?: FlowRecord;
}

/** The part of `rebuild-control.json` scoring reads: flow states listed void at this commit. */
export interface Control {
  passed: boolean;
  flow?: { voidStates?: string[] };
}

/** One capture: an app, a commit and a build variant, load 1 (README, item 5). */
export interface Capture {
  app: AppId;
  commit: CorpusCommit;
  variant: BuildVariant;
  load: Load;
  control: Control;
  /** The freeze the capture ran under. Scoring refuses a capture from any other runner. */
  frozen: string | null;
}

/**
 * §3.2 rule 1: strategy 3 reads function names, so it is judged on the build with mangling
 * forced on. The other five are judged as shipped.
 */
export function judgedVariant(strategy: CorpusStrategy): BuildVariant {
  return strategy === 'fiber' ? 'mangled' : 'as-shipped';
}

export function captureDirectory(root: string, app: CorpusApp, commit: CorpusCommit, variant: BuildVariant): string {
  return join(root, 'captures', app.id, `${String(commit.index).padStart(2, '0')}-${commit.sha.slice(0, 7)}`, variant);
}

/** Load 1 of one capture, or null when it was never captured (a build that failed, say). */
export function readCapture(root: string, app: CorpusApp, commit: CorpusCommit, variant: BuildVariant): Capture | null {
  const dir = captureDirectory(root, app, commit, variant);
  if (!existsSync(join(dir, 'load-1.json'))) return null;
  const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  const meta = read<{ rastro: { frozen?: string | null } }>('capture.json');
  return {
    app: app.id,
    commit,
    variant,
    load: read<Load>('load-1.json'),
    control: read<Control>('rebuild-control.json'),
    frozen: meta.rastro.frozen ?? null,
  };
}

/** Every screen and reached flow state of a load, by name. Screens and states never share a key. */
export function documents(load: Load): Map<string, StateRecord> {
  const all = new Map<string, StateRecord>();
  for (const screen of load.screens) if (screen.captured) all.set(`screen ${screen.screen}`, screen);
  for (const state of load.flow?.states ?? []) if (state.captured) all.set(`state ${state.screen}`, state);
  return all;
}
