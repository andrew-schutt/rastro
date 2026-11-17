# scoring/ — §3.2's numbers, from the frozen run's captures

Reads the captures the frozen runner wrote to `$RASTRO_CORPUS/captures/` and computes what
[`VALIDATION-PLAN.md`](../../../docs/VALIDATION-PLAN.md) §3.2's four rules need. It is outside
the freeze guard's paths on purpose: it is written while the run proceeds. It may import the
frozen referee (`src/repeat-oracle.ts`) and proposers (`src/drift-proposers.ts`), and never
changes them.

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
   resolution layer would sit on). Every strategy 5 fingerprint present at one commit and absent
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

Already fixed elsewhere and applied unchanged: strategy 3 is judged on the `mangled` build and
the five others on `as-shipped` (§3.2 rule 1). A flow state listed as void at a commit has no
rule 3 verdict there (`CORPUS.md`, 2026-11-17). A screen absent at a commit is reported absent,
not replaced. Run 1 uses the `key` referee alone.
