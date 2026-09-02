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

`groupByRepeat` clusters a fingerprint's colliding elements into the distinct things they
actually are. More than one group is a false merge, and `undecidedPairs` says how much of that
answer rests on evidence rather than silence.

### Why a key is a good referee and a terrible identity

The same transience that disqualifies keys from the fingerprint costs the referee nothing:

| | Identity | Referee |
|---|---|---|
| Compares across | deploys, months | one page, one commit |
| `key={i}` renumbering on insert | fatal | irrelevant — never compared across renders |
| Keys unique only among siblings | fatal | fine — only siblings are ever compared |
| Persisted | yes | never |

## Still to build

`repeat-oracle.ts` is one input to the referee, not the whole of it. §3.2's remaining pieces —
the per-JSX-site oracle, the four-strategy comparison, the corpus runner, per-deploy churn —
are not here yet.

## Running it

```bash
pnpm --filter identity-spike test
```
