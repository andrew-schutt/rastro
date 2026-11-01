// scripts/identity-spike/src/drift-proposers.ts
// The three drift proposers of docs/VALIDATION-PLAN.md §3.2 rule 4, and how they are scored.
//
// Rule 4 asks whether IDENTITY-RESOLUTION.md's proposals beat two cheaper ways of making them.
// That comparison only means something if all three are fixed before any of them sees the
// corpus, so every choice the plan leaves open is settled here, in code, with its reason:
//
// - **The version boundary is the candidate pool.** A subject is a fingerprint present at
//   commit A and absent at commit B; its candidates are the fingerprints present at B and
//   absent at A. A fingerprint present at both is not drift, and an element that persisted
//   cannot be what a vanished one became. All three proposers draw from the same pool, so the
//   boundary favours none of them.
// - **A part is evidence only when both sides have it.** Two elements without a file, or with
//   an empty chain, do not match on it: they share an absence. On the react-admin demo most
//   chains are empty, so counting absence as agreement would make every element congruent
//   with every other.
// - **Exactly one candidate or abstain.** Rule 4's own words: a tie is an abstention, never a
//   pick. Each subject is proposed for independently, so two subjects may name the same
//   candidate; a one-to-one assignment across subjects would be a fourth design, not one of
//   these three.
//
// The proposers are strategy-agnostic. They read the parts a strategy composes with role +
// accessible name, never the fingerprint string itself, which the conventions say consumers
// SHOULD NOT parse.

/** One fingerprint as observed at one commit, with the parts that composed it. */
export interface DriftRecord {
  fingerprint: string;
  /**
   * Every route the fingerprint was seen on at this commit. A set, because the fingerprint
   * does not include the route: a navigation link carries one fingerprint on every screen.
   */
  routes: readonly string[];
  role: string;
  /**
   * The structural part the strategy composes with role + name, joined: a component chain
   * (`Settings>Toolbar`), or a selector path for the CSS-selector strategy. Absent when the
   * strategy derived none, which includes `unknown`.
   */
  chain?: string;
  /** The source file, for the strategies that carry one. */
  file?: string;
  /** The accessible name, already redacted, as it sits in the fingerprint. */
  name?: string;
}

/** One candidate, or abstention. Abstention is reported, never scored. */
export type Proposal = { candidate: string } | { abstain: AbstainReason };

/**
 * Why a proposer abstained, kept apart because the reasons mean different things:
 * `no-candidate` says nothing matched at all; `tie` says the proposer could not choose.
 * `no-evidence` is the resolution proposer declining a candidate that only route and role
 * support, and `no-file` is the anchor proposer with nothing to anchor on.
 */
export type AbstainReason = 'no-candidate' | 'tie' | 'no-evidence' | 'no-file';

export type Proposer = (subject: DriftRecord, pool: readonly DriftRecord[]) => Proposal;

/** A part matches only when both sides carry it and it is equal. */
function same(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && a !== '' && a === b;
}

function sharesRoute(a: DriftRecord, b: DriftRecord): boolean {
  return a.routes.some((route) => b.routes.includes(route));
}

function onlyOne(matches: readonly DriftRecord[]): Proposal {
  const [first] = matches;
  if (first === undefined) return { abstain: 'no-candidate' };
  if (matches.length > 1) return { abstain: 'tie' };
  return { candidate: first.fingerprint };
}

/**
 * **naive**: the new fingerprint with the same route and role.
 *
 * "Same route" is an overlap of route sets, not equality: events carry one `url.path` each,
 * so congruence in traffic is per path, and a control that also appears on one new screen has
 * not stopped being on its old one.
 */
export const naive: Proposer = (subject, pool) =>
  onlyOne(pool.filter((candidate) => candidate.role === subject.role && sharesRoute(subject, candidate)));

/**
 * **anchor**: the new fingerprint with the same source file and role. §4.3's alternative to
 * the whole resolution layer, so it reads no route: the file is the anchor. A subject with no
 * file has nothing to anchor on, which is every subject under the strategies without one.
 */
export const anchor: Proposer = (subject, pool) => {
  if (subject.file === undefined || subject.file === '') return { abstain: 'no-file' };
  return onlyOne(pool.filter((candidate) => candidate.role === subject.role && same(candidate.file, subject.file)));
};

const STORED_PARTS = ['chain', 'file', 'name'] as const;
type StoredPart = (typeof STORED_PARTS)[number];

/** Which of the stored parts a candidate shares with the subject. */
export function sharedParts(subject: DriftRecord, candidate: DriftRecord): Set<StoredPart> {
  return new Set(STORED_PARTS.filter((part) => same(subject[part], candidate[part])));
}

const isSuperset = (a: Set<StoredPart>, b: Set<StoredPart>): boolean => [...b].every((part) => a.has(part));

/**
 * **resolution**: IDENTITY-RESOLUTION.md's rule in its offline form — version boundary,
 * route, role, and the stored parts, file included.
 *
 * Route and role gate, exactly as in `naive`. Among what passes, a candidate is picked when
 * the set of stored parts it shares with the subject strictly contains every other
 * candidate's. That is domination again, for rule 4's own reason: it needs no weight between
 * a matching file and a matching name, which is a number nobody has. Two candidates sharing
 * the same parts, or different parts (one the file, the other the name), are a tie.
 *
 * It also declines a candidate that shares no stored part. A continuation always differs in
 * at least one part, or its fingerprint would not have changed, but one that differs in all
 * three is a rename, a move, and a relabel at once, and that is what a replacement looks
 * like too. Proposing on route and role alone would make this `naive`, adding nothing for
 * the comparison to measure.
 */
export const resolution: Proposer = (subject, pool) => {
  const gated = pool.filter((candidate) => candidate.role === subject.role && sharesRoute(subject, candidate));
  if (gated.length === 0) return { abstain: 'no-candidate' };

  const scored = gated.map((candidate) => ({ candidate, parts: sharedParts(subject, candidate) }));
  const best = scored.filter(({ parts }) => scored.every((other) => isSuperset(parts, other.parts)));
  const [winner] = best;
  // Every candidate whose parts contain all the others' is a winner; two winners hold equal
  // sets. None means the leading sets are incomparable. Both are ties.
  if (winner === undefined || best.length > 1) return { abstain: 'tie' };
  if (winner.parts.size === 0) return { abstain: 'no-evidence' };
  return { candidate: winner.candidate.fingerprint };
};

export const PROPOSERS = { naive, anchor, resolution } as const satisfies Record<string, Proposer>;

/**
 * Run one proposer over a commit pair. Keyed by the vanished fingerprint, in sorted order.
 * Throws on a record list with a fingerprint twice, since its routes would be split across
 * entries and every route comparison would be wrong.
 */
export function proposeAll(
  before: readonly DriftRecord[],
  after: readonly DriftRecord[],
  proposer: Proposer,
): Map<string, Proposal> {
  const was = byFingerprint(before);
  const now = byFingerprint(after);
  const pool = [...now.values()].filter((record) => !was.has(record.fingerprint));
  const subjects = [...was.values()]
    .filter((record) => !now.has(record.fingerprint))
    .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
  return new Map(subjects.map((subject) => [subject.fingerprint, proposer(subject, pool)]));
}

function byFingerprint(records: readonly DriftRecord[]): Map<string, DriftRecord> {
  const map = new Map<string, DriftRecord>();
  for (const record of records) {
    if (map.has(record.fingerprint)) throw new Error(`fingerprint recorded twice: ${record.fingerprint}`);
    map.set(record.fingerprint, record);
  }
  return map;
}

/**
 * The blind label for one vanished fingerprint, written from the diff before any proposer
 * runs. `evidence` is the diff line that justifies it, which rule 4 requires of every label.
 */
export type DriftLabel =
  | { kind: 'continued'; as: string; evidence: string }
  | { kind: 'removed'; evidence: string }
  | { kind: 'replaced'; evidence: string }
  | { kind: 'unclear'; evidence: string };

export interface DriftScore {
  /** Named the labelled continuation. */
  correct: number;
  /** Any other proposal, including every proposal on a fingerprint labelled removed or replaced. */
  wrong: number;
  /** Reported, not scored. */
  abstained: number;
  /** Proposals and abstentions on `unclear` labels: reported, not scored. */
  unclear: number;
  /** Labelled `continued`. Zero means (d) is unanswered, not passed. */
  continued: number;
}

/**
 * Score one proposer's run against the labels. Every subject must be labelled: an unlabelled
 * subject would silently drop out of the comparison, which is the kind of quiet shrinkage the
 * referee's `undecided` bucket exists to prevent.
 */
export function score(proposals: ReadonlyMap<string, Proposal>, labels: ReadonlyMap<string, DriftLabel>): DriftScore {
  const tally: DriftScore = { correct: 0, wrong: 0, abstained: 0, unclear: 0, continued: 0 };
  for (const [subject, proposal] of proposals) {
    const label = labels.get(subject);
    if (label === undefined) throw new Error(`unlabelled subject: ${subject}`);
    if (label.kind === 'continued') tally.continued++;
    if (label.kind === 'unclear') tally.unclear++;
    else if ('abstain' in proposal) tally.abstained++;
    else if (label.kind === 'continued' && proposal.candidate === label.as) tally.correct++;
    else tally.wrong++;
  }
  return tally;
}

/**
 * Rule 4's comparison: `a` dominates `b` with more correct proposals and no more wrong ones.
 * Strict on correct, as the rule is written, so a proposer never dominates its own score.
 */
export function dominates(a: DriftScore, b: DriftScore): boolean {
  return a.correct > b.correct && a.wrong <= b.wrong;
}
