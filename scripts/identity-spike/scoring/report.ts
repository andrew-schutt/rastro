// scripts/identity-spike/scoring/report.ts
// §3.2's numbers from the frozen run.
//
//   node scripts/identity-spike/scoring/report.ts [actual|react-admin …]
//
// Writes $RASTRO_CORPUS/scores/<timestamp>/: report.json, report.md, and rule2-instances.json
// (every untouched or undetermined churn instance, each to be investigated by hand, as rule 2
// requires). Rules 3 and 4 are computed only once their human inputs exist in this directory
// (matches/<app>.json, labels/<app>.json), and are reported as pending until then.
//
// Every capture must come from the frozen runner. One that does not is refused, not skipped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StateRecord } from '../corpus/flows.ts';
import { BUILD_VARIANTS, CORPUS, flowStates, type AppId, type BuildVariant, type CorpusApp, type CorpusCommit } from '../corpus/manifest.ts';
import { corpusRoot, readFreeze } from '../corpus/runtime.ts';
import type { DriftLabel, DriftScore } from '../src/drift-proposers.ts';
import { RULE_1_STRATEGIES, type CorpusStrategy } from '../src/strategies.ts';
import { isVoid, readCapture, type Capture } from './captures.ts';
import { churn, falseSplits, type ChurnInstance } from './churn.ts';
import { collisions, mergeCount, visibleOnly } from './collisions.ts';
import { beats, type RuleOneTotals } from './dominance.ts';
import { driftRecords, ruleFourVerdict, scoreProposers, type ProposerName } from './drift.ts';
import { judgeRow, type Matches, type RowVerdict } from './flow-rule.ts';
import { pairDiff } from './git.ts';
import { touchAncestry, type PairDiff } from './touched.ts';

const HERE = import.meta.dirname;

/** Screens by name: rules 1 and 2 read these (README, item 9). */
function screensOf(capture: Capture): Map<string, StateRecord> {
  return new Map(capture.load.screens.filter((s) => s.captured).map((s) => [s.screen, s]));
}

interface StrategyResult {
  totals: RuleOneTotals;
  visibleMerges: { atLeast: number; atMost: number };
  undecidedPairs: number;
  undeterminedChurn: number;
  fileLevelUntouchedChurn: number;
  splitsSkipped: number;
  instances: (ChurnInstance & { pair: string })[];
}

function scoreStrategy(
  app: CorpusApp,
  captures: ReadonlyMap<number, Capture>,
  strategy: CorpusStrategy,
  diffs: ReadonlyMap<string, PairDiff>,
): StrategyResult {
  const result: StrategyResult = {
    totals: { merges: { atLeast: 0, atMost: 0 }, untouchedChurn: 0, falseSplits: 0 },
    visibleMerges: { atLeast: 0, atMost: 0 },
    undecidedPairs: 0,
    undeterminedChurn: 0,
    fileLevelUntouchedChurn: 0,
    splitsSkipped: 0,
    instances: [],
  };
  for (const capture of captures.values()) {
    for (const screen of screensOf(capture).values()) {
      const all = mergeCount(collisions(screen.elements, strategy));
      const visible = mergeCount(collisions(visibleOnly(screen.elements), strategy));
      result.totals.merges.atLeast += all.atLeast;
      result.totals.merges.atMost += all.atMost;
      result.undecidedPairs += all.undecidedPairs;
      result.visibleMerges.atLeast += visible.atLeast;
      result.visibleMerges.atMost += visible.atMost;
    }
  }
  for (const commit of app.commits.slice(1)) {
    const was = captures.get(commit.index - 1);
    const now = captures.get(commit.index);
    if (was === undefined || now === undefined) continue;
    const pair = `${commit.index - 1}-${commit.index}`;
    const diff = diffs.get(pair)!;
    const before = screensOf(was);
    const after = screensOf(now);
    const found = churn(before, after, strategy, (element) => touchAncestry(element.ancestry, app.pluginRoot, diff));
    for (const instance of found.vanished) {
      if (instance.touch === 'untouched') result.totals.untouchedChurn += 1;
      if (instance.touch === 'undetermined') result.undeterminedChurn += 1;
      if (!instance.fileLevel) result.fileLevelUntouchedChurn += 1;
      if (instance.touch !== 'touched') result.instances.push({ ...instance, pair });
    }
    const splits = falseSplits(before, after, strategy);
    result.totals.falseSplits += splits.split;
    result.splitsSkipped += splits.skipped;
  }
  return result;
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

/** Rule 3 per strategy, from the hand matches. Null when there are none yet. */
function ruleThree(app: CorpusApp, all: ReadonlyMap<string, ReadonlyMap<number, Capture>>, inputs: string) {
  const matches = readJson<Matches>(join(inputs, 'matches', `${app.id}.json`));
  if (matches === null) return null;
  const rows = app.flow.rows;
  return Object.fromEntries(
    RULE_1_STRATEGIES.map((strategy) => {
      const captures = all.get('as-shipped')!;
      const verdicts: Record<string, Record<string, RowVerdict>> = {};
      for (const [commitIndex, capture] of captures) {
        const byState = new Map((capture.load.flow?.states ?? []).filter((s) => s.captured).map((s) => [s.screen, s]));
        const voided = new Set(capture.control.flow?.voidStates ?? []);
        const asShipped = all.get('as-shipped')!.get(commitIndex);
        verdicts[commitIndex] = Object.fromEntries(
          rows.map((row) => {
            const match = matches[commitIndex]?.[row.id];
            const state = byState.get(row.state);
            if (match === undefined || state === undefined) return [row.id, { verdict: 'unmatched' }];
            // Matches index the as-shipped capture. Another variant is used only where its
            // element at that index has the identical description; otherwise it is unmatched.
            let element = match.element;
            if (element !== null && capture.variant !== 'as-shipped') {
              const reference = asShipped?.load.flow?.states.find((s) => s.screen === row.state)?.elements[element];
              const here = state.elements[element];
              if (reference === undefined || here === undefined || JSON.stringify(reference.description) !== JSON.stringify(here.description)) {
                element = null;
              }
            }
            return [row.id, judgeRow(state, element, strategy, voided.has(row.state))];
          }),
        );
      }
      const flat = Object.values(verdicts).flatMap((byRow) => Object.values(byRow));
      return [
        strategy,
        {
          collisions: flat.filter((v) => v.verdict === 'collides').length,
          undecidedCollisions: flat.filter((v) => v.verdict === 'collides' && v.undecided).length,
          unmatched: flat.filter((v) => v.verdict === 'unmatched').length,
          void: flat.filter((v) => v.verdict === 'void').length,
          verdicts,
        },
      ];
    }),
  );
}

/** Rule 4 on strategy 5, from the blind labels. Null until every pair is labelled. */
function ruleFour(app: CorpusApp, captures: ReadonlyMap<number, Capture>, inputs: string) {
  const labels = readJson<Record<string, Record<string, DriftLabel>>>(join(inputs, 'labels', `${app.id}.json`));
  if (labels === null) return null;
  const totals = Object.fromEntries(
    (['naive', 'anchor', 'resolution'] as ProposerName[]).map((name) => [name, { correct: 0, wrong: 0, abstained: 0, unclear: 0, continued: 0 }]),
  ) as Record<ProposerName, DriftScore>;
  for (const commit of app.commits.slice(1)) {
    const was = captures.get(commit.index - 1);
    const now = captures.get(commit.index);
    if (was === undefined || now === undefined) continue;
    const pair = `${commit.index - 1}-${commit.index}`;
    const pairLabels = labels[pair];
    if (pairLabels === undefined) return null;
    const scores = scoreProposers(driftRecords(screensOf(was)), driftRecords(screensOf(now)), new Map(Object.entries(pairLabels)));
    for (const name of Object.keys(totals) as ProposerName[]) {
      for (const key of Object.keys(totals[name]) as (keyof DriftScore)[]) totals[name][key] += scores[name][key];
    }
  }
  return { scores: totals, verdict: ruleFourVerdict(totals) };
}

/** Where a run's captures, diffs and human inputs come from. Injected so the whole report is tested on a synthetic corpus. */
export interface Sources {
  capture: (app: CorpusApp, commit: CorpusCommit, variant: BuildVariant) => Capture | null;
  diff: (app: CorpusApp, older: CorpusCommit, newer: CorpusCommit) => PairDiff;
  /** The directory holding `matches/` and `labels/`. */
  inputs: string;
}

export function scoreApp(app: CorpusApp, sources: Sources, frozen: string) {
  const all = new Map<string, Map<number, Capture>>();
  const missing: string[] = [];
  for (const variant of BUILD_VARIANTS) {
    const captures = new Map<number, Capture>();
    for (const commit of app.commits) {
      const capture = sources.capture(app, commit, variant);
      if (capture === null) {
        missing.push(`${commit.index} ${variant}`);
        continue;
      }
      if (capture.frozen !== frozen) {
        throw new Error(`${app.id} commit ${commit.index} ${variant} was captured under ${capture.frozen ?? 'no freeze'}, not the frozen runner ${frozen}. Recapture it.`);
      }
      captures.set(commit.index, capture);
    }
    all.set(variant, captures);
  }
  // A void commit (`isVoid`) is dropped from both builds, with both pairs it is part of, and reported.
  const voidCommits = app.commits
    .map((c) => c.index)
    .filter((index) => isVoid([...all.values()].map((captures) => captures.get(index) ?? null)));
  for (const captures of all.values()) for (const index of voidCommits) captures.delete(index);

  const diffs = new Map<string, PairDiff>();
  const commitBy = new Map<number, CorpusCommit>(app.commits.map((c) => [c.index, c]));
  for (const commit of app.commits.slice(1)) {
    diffs.set(`${commit.index - 1}-${commit.index}`, sources.diff(app, commitBy.get(commit.index - 1)!, commit));
  }

  const strategies = Object.fromEntries(
    RULE_1_STRATEGIES.map((strategy) => [strategy, scoreStrategy(app, all.get('as-shipped')!, strategy, diffs)]),
  ) as Record<CorpusStrategy, StrategyResult>;

  const comparisons = Object.fromEntries(
    RULE_1_STRATEGIES.map((a) => [
      a,
      Object.fromEntries(RULE_1_STRATEGIES.filter((b) => b !== a).map((b) => [b, beats(strategies[a].totals, strategies[b].totals)])),
    ]),
  );
  return {
    app: app.id,
    missing,
    voidCommits,
    voidStates: Object.fromEntries(
      [...all.get('as-shipped')!].map(([index, c]) => [index, c.control.flow?.voidStates ?? []]),
    ),
    strategies,
    comparisons,
    ruleThree: ruleThree(app, all, sources.inputs),
    ruleFour: ruleFour(app, all.get('as-shipped')!, sources.inputs),
    flowStates: flowStates(app.flow),
  };
}

export function markdown(results: ReturnType<typeof scoreApp>[], frozen: string): string {
  const lines = [`# §3.2 scores`, '', `Frozen runner \`${frozen}\`. Definitions: \`scripts/identity-spike/scoring/README.md\`.`, ''];
  for (const r of results) {
    lines.push(`## ${r.app}`, '');
    if (r.missing.length > 0) lines.push(`**Missing captures:** ${r.missing.join(', ')}`, '');
    if (r.voidCommits.length > 0) lines.push(`**Void commits** (rebuild control failed; both pairs each is part of are not scored): ${r.voidCommits.join(', ')}`, '');
    lines.push('| Strategy | False merges (range) | Visible only | Undecided pairs | Untouched churn | Undetermined churn | File-level untouched | False splits | Splits skipped |', '|---|---|---|---|---|---|---|---|---|');
    const row = (label: string, s: StrategyResult) =>
      lines.push(
        `| ${label} | ${s.totals.merges.atLeast}–${s.totals.merges.atMost} | ${s.visibleMerges.atLeast}–${s.visibleMerges.atMost} | ${s.undecidedPairs} | ${s.totals.untouchedChurn} | ${s.undeterminedChurn} | ${s.fileLevelUntouchedChurn} | ${s.totals.falseSplits} | ${s.splitsSkipped} |`,
      );
    for (const strategy of RULE_1_STRATEGIES) row(strategy, r.strategies[strategy]);
    lines.push('', '**Rule 1, row beats column:**', '', `| | ${RULE_1_STRATEGIES.join(' | ')} |`, `|---|${RULE_1_STRATEGIES.map(() => '---').join('|')}|`);
    for (const a of RULE_1_STRATEGIES) {
      lines.push(`| ${a} | ${RULE_1_STRATEGIES.map((b) => (a === b ? '—' : (r.comparisons[a] as Record<string, string>)[b])).join(' | ')} |`);
    }
    lines.push('', `**Rule 3:** ${r.ruleThree === null ? 'pending: rows not matched yet.' : ''}`);
    if (r.ruleThree !== null) {
      for (const [strategy, v] of Object.entries(r.ruleThree)) {
        lines.push(`- ${strategy}: ${v.collisions} collisions (${v.undecidedCollisions} undecided), ${v.unmatched} unmatched, ${v.void} void`);
      }
    }
    lines.push('', `**Rule 4:** ${r.ruleFour === null ? 'pending: not every pair is labelled.' : r.ruleFour.verdict}`, '');
    if (r.ruleFour !== null) lines.push('```json', JSON.stringify(r.ruleFour.scores, null, 2), '```', '');
  }
  return `${lines.join('\n')}\n`;
}

function main(argv: string[]): void {
  const freeze = readFreeze();
  if (freeze === null) throw new Error('the runner is not frozen; there is no run to score');
  const root = corpusRoot();
  const apps = (argv.length === 0 ? Object.keys(CORPUS) : argv) as AppId[];
  const sources: Sources = {
    capture: (app, commit, variant) => readCapture(root, app, commit, variant),
    diff: (app, older, newer) => pairDiff(join(root, app.id), older.sha, newer.sha),
    inputs: HERE,
  };
  const results = apps.map((id) => scoreApp(CORPUS[id], sources, freeze.commit));
  const out = join(root, 'scores', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(
    join(out, 'rule2-instances.json'),
    `${JSON.stringify(
      Object.fromEntries(results.map((r) => [r.app, Object.fromEntries(Object.entries(r.strategies).map(([s, v]) => [s, v.instances]))])),
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(out, 'report.md'), markdown(results, freeze.commit));
  console.log(`scores: ${out}`);
}

// Run only as a command, so the test can import scoreApp without scoring the real corpus.
if (process.argv[1] === import.meta.filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
