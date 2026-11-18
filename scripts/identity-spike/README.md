# identity-spike

Measurement tooling for [`docs/VALIDATION-PLAN.md`](../../docs/VALIDATION-PLAN.md) §3.2.
Private, never published, never imported by the SDK.

## Why it is a workspace package

It renders real React to read real fibers, so it needs the same test rig the SDK has. A loose
script in `scripts/` could not be typechecked, linted, or tested alongside everything else,
and this is code whose correctness the spike's numbers depend on entirely.

## What is here so far

### `repeat-oracle.ts` — the collision referee

§3.2 requires one decision before any collision number means anything:

> The harness must distinguish "collides with a semantically distinct element" from "collides
> with its own repeated siblings", or the collision number is meaningless.

Two identical buttons in a rendered list are *supposed* to share a fingerprint — §4.2.1
excluded position hints deliberately so that 50 table rows produce one identity and one click
count. Two separately-written buttons sharing an identity is the opposite: a false merge,
which `IDENTITY-RESOLUTION.md` shows is the failure nothing downstream can detect.

This tells them apart using React's `key`. When React renders an array it stamps each child's
fiber with the developer's key, so **two elements are repeats of one another exactly when they
hang off two different keyed items of the same list.**

| Situation | Verdict |
|---|---|
| Two rows of one list | `repeated-siblings` — a right merge |
| Two controls inside one row | `distinct` — a real false merge |
| Rows of two separate lists | `distinct` |
| Neither element in a keyed list | `undecided` |
| Only one side keyed | `undecided` |

**`undecided` is a real answer and never collapses into the others.** React renders an unkeyed
array perfectly happily — it only warns — so "no key" does not prove "no loop". Those pairs are
the hand-inspected bucket, and counting them either way would move the exact number the spike
exists to establish.

### Grouping is positional, because the verdict is not transitive

`groupByRepeat` clusters a fingerprint's colliding elements into the distinct things they
actually are. More than one group is a false merge.

It does **not** union over `repeated-siblings`, which was the first attempt and was wrong.
Three rows of two identical buttons: the table above correctly calls row 1's pair `distinct`,
but row 1's LEFT button and row 2's RIGHT button are two items of one list — so a union drags
all six together and reports zero false merges where the honest answer is two groups and one.
Under-reporting is the failure direction this whole exercise exists to avoid.

So repeats are matched by **JSX slot**: two elements are repeats when they sit in different
items of the same list, at the same position in the children array React reconciled for their
item. Grouping on that composite key instead of merging pairwise is what makes it structural —
two elements of one item hold different slots, so no other pair can drag them together.

The slot comes from `fiber.index`, not from the DOM, and that is what makes it a JSX *site*
rather than a position. A branch that rendered nothing still occupies its index, so
`{canEdit ? <button/> : null}<button/>` puts the second button at slot 1 in every row whether
or not the first one rendered. Two consequences, both load-bearing:

- A row that renders only one of a pair still lands in the right column. Counting a row's
  colliding elements could not tell which one it was.
- Two rows holding the same *number* of controls drawn from different JSX sites — `[X, Act]`
  against `[Act, Y]` — do not merge. Aligning on a count merges `X` with `Act` and `Act` with
  `Y`, reporting three logical elements as two with every counter silent, which is the
  under-reporting direction this exercise exists to avoid.

| Count | What it means |
|---|---|
| `undecidedPairs` | The key said nothing, so the pair did not merge. How much of the answer rests on evidence rather than silence. |
| `slotSeparatedPairs` | The key called them repeats and the slot held them apart. Not an escape — in a two-control list most cross pairs land here — but it bounds the one way the slot can be wrong: a control rendered from two JSX sites (`cond ? <button>Save</button> : <button>Save</button>`) is one logical element that the slots split. |

### The number is a range, because a key is not a loop

`distinctElements` reports `{ atLeast, atMost }` rather than a count. `atLeast` is
`groups.length` — what the key evidence says once everything mergeable is merged. `atMost`
assumes no key means a loop at all and counts every element separately.

The gap is not padding. React stamps a key on hand-written static siblings too, and
`<section key="left">…</section><section key="right">…</section>` is two items of one parent
that nothing here distinguishes from two rows of a `.map()` — their buttons merge, and
`atLeast` alone would call that a clean right merge. The width of the range says how much of
the answer is resting on `key`, which a single number would launder away.

`classifyPair` stays coarser than the grouping on purpose: a pairwise verdict cannot see a
slot, so it still calls row 1's Edit and row 2's Delete `repeated-siblings`. The verdicts are
the per-bucket reporting §3.2 asks for; the slot is the clustering rule.

### Why a key is a good referee and a terrible identity

The same transience that disqualifies keys from the fingerprint costs the referee nothing:

| | Identity | Referee |
|---|---|---|
| Compares across | deploys, months | one page, one commit |
| `key={i}` renumbering on insert | fatal | irrelevant — never compared across renders |
| Keys unique only among siblings | fatal | fine — only siblings are ever compared |
| Persisted | yes | never |

### `continuity.ts` and `continuity/`: the diff, and its smoke test

`snapshotDocument` records every interactive element's fingerprint on a rendered page, and
`diffSnapshots` says what changed between two such records: kept, vanished, appeared, and
count changes (the only trace a new merge leaves). Both are for the corpus runner.

Before the runner trusts them with numbers nobody can check, [`continuity/`](continuity) runs
them on an app whose answers we know: known edits, each with the fingerprint changes it must
cause, under every strategy §3.2 measures. Its outputs are committed snapshots, so it is
also CI's guard against any PR changing a fingerprint unannounced. See its README.

### `baselines.ts`: strategies 1 and 2

§3.2 rule 1's two baselines, which will never ship and so live here rather than in core:
**role + accessible name** (`role|"name"`), and the **CSS selector path**
(`<path>|role|"name"`), modelled on PostHog's `$elements_chain`. Both are composed from core's
`overrideOf`, `roleOf` and `accName`, so they honour `data-telemetry-id` and redact exactly as
`fingerprint()` does. The comparison is between paths, not between override or redaction rules.

The selector path is an **approximation**, and its doc comment gives the source it was read
from and every departure. It keeps every ancestor to `<body>`, sorted classes (hashed
CSS-in-JS names included), `id`, `nth-child` and `nth-of-type`. It drops text, `href` and all
other attributes, since the name is composed separately and state attributes would only add
splits. One thing no definition can model is that PostHog matches a looser Action selector
over this string at query time. Its splits therefore overstate the incumbent's, and its merges
understate them.

### `drift-proposers.ts` — rule 4's three proposers, fixed before the corpus

Rule 4 compares IDENTITY-RESOLUTION.md's drift proposals with two cheaper ones. The
comparison is only honest if all three are fixed before any of them sees a corpus commit, so
this file settles everything the plan leaves open. Each proposer takes one vanished
fingerprint and the pool of new ones, and names exactly one candidate or abstains.

| Proposer | Candidates | Picks |
|---|---|---|
| `naive` | same role, a shared route | the only one |
| `anchor` | same role, same source file, any route | the only one; abstains without a file, which is every subject since the fingerprint dropped its file |
| `resolution` | same role, a shared route | the one whose shared stored parts (chain, file, name) strictly contain every other candidate's, and share at least one |

The choices it settles:

- **The version boundary is the pool.** Subjects vanished at the commit pair, candidates
  appeared at it. Fingerprints present at both are neither.
- **A part matches only when both sides have it.** Two elements with no file or an empty
  chain share an absence, not an identity. On the react-admin demo most chains are empty.
- **`resolution` uses no weights.** Picking by containment of shared parts is domination
  again, so it needs no exchange rate between a matching file and a matching name. Leaders
  that share different parts are a tie.
- **`resolution` declines a candidate that only route and role support.** Proposing on those
  alone would make it `naive`, and a continuation that changed chain, file and name at once
  looks the same as a replacement.
- **Abstentions keep their reason** (`no-candidate`, `tie`, `no-evidence`, `no-file`),
  because "nothing matched" and "could not choose" mean different things about a proposer.

`score` tallies one proposer's run against the blind labels, and refuses an unlabelled
subject rather than letting it drop out. `dominates` is rule 4's comparison. Turning the three
scores into rule 4's verdict is `scoring/drift.ts` (`ruleFourVerdict`).

Any change to a proposer after a corpus number is seen makes it a different proposer,
reported separately.

## Where it stands

Three strategies are measured since run 2: role + name, selector path and `attribute`, which
is Rastro's fingerprint. Run 2 measured six; the fiber walk, the attribute chain with its file
and the marked fiber walk were cut after it (`docs/NOTES.md`).

**What the measurement keeps of React's internals, and why.** Rastro no longer reads them, but
the referee reads React's `key` off each element's fiber, and rule 2's "touched" reads every
first-party component above an element from marks on the fiber tree. So `src/fiber.ts` holds
the fiber lookup and the mark shape, moved from `rastro-core`, and `src/mark-plugin.ts` is the
Babel plugin that writes the marks, moved from `babel-plugin-rastro`'s `markComponents`. It
imports the build plugin's naming rule (`owningComponent`), so it marks exactly what the plugin
stamps. `continuity/ancestry.test.ts` runs the two end to end through the real plugins, React
and the React Compiler.

The corpus is pre-registered in [`docs/CORPUS.md`](../../docs/CORPUS.md): apps, commits,
screens, run conditions and rule 3's flow elements. Rule 4's verdict when both cheaper
proposers match `resolution` is settled in the plan.

In the order agreed for §3.2:

1. **The corpus runner**, which walks `CORPUS.md`'s commits under its run conditions,
   including the same-commit rebuild control. It builds and drives each app, and feeds
   `snapshotDocument` and the proposers. **Building and capturing are done**
   ([`corpus/`](corpus)): both variants of both apps build, and every pre-registered screen is
   captured twice under every strategy, passing the rebuild control at the two exposed
   commits. **The rule 3 flow drivers are done too**: both flows are walked in every load, on
   both variants, and pass the rebuild control at the exposed commits. What walking them
   settled is `CORPUS.md`'s 2026-11-13 amendment. The question the run-conditions amendment
   left open is settled too, from PostHog's source: its autocapture keeps generated ids like
   React's `useId`, so strategy 2 stands as defined. **The capture is complete**: besides
   the fingerprints, every element records what the analysis needs and only a live page has
   (the referee's sites, the full component ancestry, each strategy's parts). The freeze can
   remove nothing the rules need. **The runner is frozen** (2026-11-17, `corpus/freeze.json`),
   and both commands refuse a runner that differs from the frozen commit. Run 1 was void by
   its own rebuild control, and never scored: Actual asks GitHub for its latest release on
   every load. The runner now reaches only the local server, and is frozen again for run 2
   (`CORPUS.md`, "Run 1 is void").
2. **The run and its scoring: done for rules 1 and 2.** Run 2 built and captured every commit
   of both apps, and `scoring/` computed rules 1 and 2 from the captures. **Rule 1 failed and
   rule 2 passed** ([`scoring/results/run-2.md`](scoring/results/run-2.md)). The referee was
   `repeat-oracle.ts` alone, as settled 2026-11-17. No pair came out `undecided`, but the
   referee misreads nested lists, which the report records.
3. **Still open: rules 3 and 4.** Rule 3 needs the flow rows matched by hand, and rule 4 needs
   8 fingerprints labelled blind. Both worksheets are written (`scoring/worksheets.ts`).

## Running it

```bash
pnpm --filter identity-spike test
```
