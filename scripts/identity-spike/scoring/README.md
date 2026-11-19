# scoring/ — §3.2's numbers, from the frozen run's captures

Reads the captures the frozen runner wrote to `$RASTRO_CORPUS/captures/` and computes what
[`VALIDATION-PLAN.md`](../../../docs/VALIDATION-PLAN.md) §3.2's four rules need. It is outside
the freeze guard's paths on purpose: it is written while the run proceeds. It may import the
frozen referee (`src/repeat-oracle.ts`) and proposers (`src/drift-proposers.ts`), and never
changes them.

**The corpus and this scoring are the standing measure of identity.** Every later change to
the fingerprint is judged on them the same way, as a new run under a new freeze, with
definitions fixed before its numbers are seen. Each run's written report goes in
[`results/`](results/). **[Run 2](results/run-2.md) is the first scored run: rule 1 failed and
rule 2 passed.** A candidate designed after seeing run 2 has to be judged on corpus commits that
nobody has seen. The run 2 apps can be reported alongside, labelled as seen.

## Pre-registered 2026-11-17, before any corpus number

The plan leaves the definitions below open, and each one moves a number. They were fixed here,
agreed with the maintainer, and committed before any scoring code existed. The run had started
at that point, and no score had been computed on any capture. **Any change after a number is
seen makes a different score, reported separately.**

1. **"Touched" is component-level (rule 2).** A commit pair touches an element when the app's
   own diff between the two commits changes a line inside the definition of any component in
   the element's recorded `ancestry`, in that component's file. File-level touching (any change
   to the file) is reported beside it and never judged. File-level would excuse churn caused by
   an unrelated edit elsewhere in the same file, which is the lenient direction. A component
   whose definition cannot be located in its file is **undetermined**, and its churn is
   investigated by hand like any untouched instance. It is never assumed touched.
2. **Rule 4's blind labels cover strategy 5 only** (`attribute+file`, the shipped default the
   resolution layer would sit on). *Since 2026-11-18 the shipped default is `attribute`, the
   chain without its file, and `drift.ts` labels that; the `anchor` proposer abstains on every
   subject, having no file.* Every strategy 5 fingerprint present at one commit and absent
   at the next is labelled, from the diff, before any proposer runs. The three proposers run on
   strategy 5. Other strategies' churn is counted for rules 1 and 2 and not labelled.
3. **Rule 3's rows are matched by hand at commit 10**, from the description. At every other
   commit a tool proposes the element whose description is identical to the commit-10 match,
   and a person confirms it. An element with a changed description, or more than one identical
   one, is matched by hand. The tool shows descriptions only, never a fingerprint or a verdict.
   Every match records who made it and whether it was proposed or by hand.
4. **Collisions are judged per screen and per flow state.** Two distinct elements sharing a
   fingerprint on one screen or state are a collision. Collisions across screens are reported,
   not judged, since events carry the route.
5. **Load 1 is scored.** The rebuild control already holds load 2 identical for the judged
   strategies. For strategy 2, the elements whose fingerprint differs between loads are reported
   beside its numbers.
6. **Every captured element counts**, hidden ones included, as `CORPUS.md` pre-registered.
   Visible-only numbers are reported beside them.
7. **False splits (rule 1c)** match elements across a commit pair by screen, role and accessible
   name (strategy 1's parts). An element whose key is not unique on its screen at either commit
   is skipped, and the skipped count is reported. A matched pair whose fingerprint changed is a
   false split under that strategy.
8. **False merges for rule 1's domination test are a range.** The referee gives a lower bound
   (the key evidence, `distinctElements.atLeast`) and an upper bound (no key means no loop,
   `atMost`). The count for a fingerprint is distinct elements minus one. A strategy dominates on
   false merges only if it does so under both bounds. If the bounds disagree, that comparison is
   reported as undecided, never decided on whichever bound favours one side. `undecided` pairs
   are reported and inspected by hand, as §3.2 requires.
9. **Rules 1 and 2 read the screens. Rule 3 reads the flow states.** Rule 1 counts "every
   interactive element" of a commit, which is what the screens hold. Rule 3's rows name flow
   states. Counting the states in rule 1 as well would count every element on both a screen and
   a state twice. *Added while writing the code, before any number. It is the reading the docs
   already imply, and it was flagged to the maintainer.*
10. **A churned fingerprint worn by several elements is untouched if any of them was.** Every
    element wearing a vanished fingerprint changed, so an untouched one changed without cause.
    Otherwise it is undetermined if any was, otherwise touched. This applies item 1 in the strict
    direction. *Added while writing the code, before any number.*

Already fixed elsewhere and applied unchanged: in run 2, strategy 3 was judged on the `mangled`
build and the five others on `as-shipped` (§3.2 rule 1). Since 2026-11-18 three strategies
remain and there is one build, so the scoring reads `as-shipped` for all of them. A flow state listed as void at a commit has no
rule 3 verdict there (`CORPUS.md`, 2026-11-17). A commit whose rebuild control failed on
either build is void (`CORPUS.md`, 2026-11-09): it is dropped from both builds, with both pairs
it is part of, and reported. *The report applied this only from 2026-11-18, before any number;
until then it read a failed commit's load 1 as if it had passed.* A screen absent at a commit is reported absent,
not replaced. The first scored run uses the `key` referee alone (`VALIDATION-PLAN.md` calls it
run 1; it is run 2, since run 1 was void and never scored).

## Running it

Once every commit is built and captured under the freeze:

```bash
node scripts/identity-spike/scoring/report.ts                     # rules 1 and 2; 3 and 4 once their inputs exist
node scripts/identity-spike/scoring/worksheets.ts rule3 actual    # sheet for matching rows at commit 10
node scripts/identity-spike/scoring/worksheets.ts rule4 actual    # one sheet per pair, to label blind
```

Reports go to `$RASTRO_CORPUS/scores/<timestamp>/`, worksheets to `$RASTRO_CORPUS/worksheets/`.
Copy each run's numbers into `results/run-N.md`, with what they decide and how far to trust
them. The human inputs live here, so they are reviewed with the results:

- **`matches/<app>.json`**: commit index → row id → `{ state, element, by, matcher, note? }`. Match
  commit 10 by hand first. `rule3` then writes proposals for the other nine commits, each to be
  confirmed. A `null` proposal is matched by hand. `element: null` with a `note` means the row's
  element is not there, or capture cannot see it, which is reported and not substituted.
- **`labels/<app>.json`**: pair (`"1-2"`) → fingerprint → `{ kind, as?, evidence }`. Copy the
  template `rule4` writes, and fill every entry from the diff before running the report. The
  proposers refuse to run while any subject is unlabelled.

| File | What it does |
|---|---|
| `captures.ts` | Reads load 1 of a capture, and picks each strategy's judged variant |
| `collisions.ts` | False merges per screen, through the frozen referee |
| `touched.ts`, `git.ts` | Component-level touching, from the pair's diff in the corpus clone |
| `churn.ts` | Rule 2's churn instances and rule 1c's false splits |
| `dominance.ts` | Rule 1's domination, undecided when the merge bounds disagree |
| `flow-rule.ts` | Rule 3's row judgement, and proposals by identical description |
| `drift.ts` | Rule 4's records, the blind worksheet, the scores and the verdict |
| `report.ts`, `worksheets.ts` | The two commands |
| `results/` | Each scored run's written report |
