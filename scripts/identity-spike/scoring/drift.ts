// scripts/identity-spike/scoring/drift.ts
// Rule 4 on strategy 5 (README, item 2): the records the frozen proposers compare, the blind
// labelling worksheet, and the scores.
//
// The order is the rule's: every vanished fingerprint is labelled from the diff BEFORE any
// proposer runs. `worksheet` shows what was there and what appeared, and never a proposal.
// `scoreProposers` refuses to run until every subject has a label.
import type { StateRecord } from '../corpus/flows.ts';
import {
  dominates,
  PROPOSERS,
  proposeAll,
  score,
  type DriftLabel,
  type DriftRecord,
  type DriftScore,
} from '../src/drift-proposers.ts';
import type { ElementDescription } from '../src/describe.ts';

export const DRIFT_STRATEGY = 'attribute+file' as const;

/** One record per strategy 5 fingerprint on a commit's screens, with every screen it was on. */
export function driftRecords(screens: ReadonlyMap<string, StateRecord>): DriftRecord[] {
  const records = new Map<string, DriftRecord & { routes: string[] }>();
  for (const [screen, record] of screens) {
    for (const element of record.elements) {
      const fingerprint = element.fingerprints[DRIFT_STRATEGY];
      const existing = records.get(fingerprint);
      if (existing !== undefined) {
        if (!existing.routes.includes(screen)) existing.routes.push(screen);
        continue;
      }
      const { role, chain, file, name } = element.parts[DRIFT_STRATEGY];
      records.set(fingerprint, {
        fingerprint,
        routes: [screen],
        role,
        ...(chain === undefined ? {} : { chain }),
        ...(file === undefined ? {} : { file }),
        ...(name === undefined ? {} : { name }),
      });
    }
  }
  return [...records.values()];
}

export interface WorksheetEntry {
  fingerprint: string;
  routes: readonly string[];
  /** What the elements wearing it looked like, for reading the diff against. */
  descriptions: ElementDescription[];
}

/**
 * What a labeller reads for one commit pair: every vanished fingerprint (the subjects), and every
 * one that appeared (what a continuation could be named as). No proposal, no proposer, no score.
 */
export function worksheet(
  before: ReadonlyMap<string, StateRecord>,
  after: ReadonlyMap<string, StateRecord>,
): { subjects: WorksheetEntry[]; appeared: WorksheetEntry[] } {
  const entries = (screens: ReadonlyMap<string, StateRecord>, keep: (print: string) => boolean) => {
    const found = new Map<string, WorksheetEntry>();
    for (const [screen, record] of screens) {
      for (const element of record.elements) {
        const fingerprint = element.fingerprints[DRIFT_STRATEGY];
        if (!keep(fingerprint)) continue;
        const entry = found.get(fingerprint) ?? { fingerprint, routes: [], descriptions: [] };
        if (!entry.routes.includes(screen)) (entry.routes as string[]).push(screen);
        if (entry.descriptions.length < 3) entry.descriptions.push(element.description);
        found.set(fingerprint, entry);
      }
    }
    return [...found.values()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
  };
  const was = new Set(driftRecords(before).map((r) => r.fingerprint));
  const now = new Set(driftRecords(after).map((r) => r.fingerprint));
  return {
    subjects: entries(before, (print) => !now.has(print)),
    appeared: entries(after, (print) => !was.has(print)),
  };
}

export type ProposerName = keyof typeof PROPOSERS;

/** Every proposer scored against the labels, after checking every subject has one. */
export function scoreProposers(
  before: readonly DriftRecord[],
  after: readonly DriftRecord[],
  labels: ReadonlyMap<string, DriftLabel>,
): Record<ProposerName, DriftScore> {
  const now = new Set(after.map((r) => r.fingerprint));
  const unlabelled = before.filter((r) => !now.has(r.fingerprint) && !labels.has(r.fingerprint));
  if (unlabelled.length > 0) {
    throw new Error(`${unlabelled.length} vanished fingerprint(s) unlabelled. Label them before any proposer runs.`);
  }
  return Object.fromEntries(
    (Object.keys(PROPOSERS) as ProposerName[]).map((name) => [name, score(proposeAll(before, after, PROPOSERS[name]), labels)]),
  ) as Record<ProposerName, DriftScore>;
}

/**
 * Rule 4's verdict, branch by branch as VALIDATION-PLAN.md §3.2 words it, from scores summed over
 * every pair. "Matches or beats" is no fewer correct and no more wrong.
 */
export function ruleFourVerdict(scores: Record<ProposerName, DriftScore>): string {
  const { naive, anchor, resolution } = scores;
  if (resolution.continued === 0) return 'No fingerprint labelled continued: (d) is unanswered, not passed.';
  if (dominates(resolution, naive) && dominates(resolution, anchor)) {
    return 'Resolution dominates both: the design is viable, and its build trigger stands.';
  }
  const matchesOrBeats = (other: DriftScore) => other.correct >= resolution.correct && other.wrong <= resolution.wrong;
  const anchorVerdict = "the answer is §4.3's anchor, and IDENTITY-RESOLUTION.md records that.";
  const naiveVerdict = 'neither the file nor the other parts carry anything offline; the decision waits for traffic.';
  if (matchesOrBeats(anchor) && matchesOrBeats(naive)) {
    return `Both match or beat it. ${dominates(anchor, naive) ? `Anchor dominates naive: ${anchorVerdict}` : `Anchor does not dominate naive: ${naiveVerdict}`}`;
  }
  if (matchesOrBeats(anchor)) return `Anchor matches or beats it: ${anchorVerdict}`;
  if (matchesOrBeats(naive)) return `Naive matches or beats it: ${naiveVerdict}`;
  return 'Neither dominates nor loses outright: report the trade. It does not license building.';
}
