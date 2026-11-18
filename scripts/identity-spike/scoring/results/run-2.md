# §3.2 run 2: the written report

The report [`VALIDATION-PLAN.md`](../../../../docs/VALIDATION-PLAN.md) §3.2 asks for. It covers
every commit of both corpus apps ([`CORPUS.md`](../../../../docs/CORPUS.md)), captured
2026-11-17 by the runner frozen at `452fc46` and scored 2026-11-18 by this directory's code,
under the definitions in [`../README.md`](../README.md). Run 1 is void and was never scored
(`CORPUS.md`, "Run 1 is void").

**Rule 1 fails. Rule 2 passes.** Under the plan, §3.2 stops at rule 1: the fix is fingerprint
redesign, not more product. Rules 3 and 4 are not scored yet. Their worksheets exist, and the
hand steps are what remains.

## What was scored

| | Actual | react-admin demo |
|---|---|---|
| Commits built and captured | 10 of 10 | 10 of 10 |
| Rebuild controls passed | 20 of 20 | 19 of 20 |
| Void commits | none | **3**: load 1 of the as-shipped build never entered the app (below) |
| Pairs scored | 9 of 9 | 7 of 9 (2→3 and 3→4 are void) |
| Void flow states | none | none |

**React-admin commit 3.** The app had not rendered its login form when the entry step timed
out, after 30 s to settle and 30 s to wait. The screenshot is blank, with no page error.
Twelve diagnostic entries of the same build all succeeded, and took between 1 s and 38 s.
Timed runs with and without the local-only network were equally erratic (1.2 to 31 s and 1.4
to 28 s), so the block is not the cause. The demo's first render is slow and variable
whatever the conditions. By the 2026-11-09 rule the commit is void. Nothing was retried, and
nothing was substituted.

## Rules 1 and 2

Counts are summed over commits and screens, from load 1. False merges are a range: the lower
bound treats keyed repeats as right merges, the upper treats them as distinct. "Untouched"
churn is on components the pair's diff did not change. A false split is an element that keeps
its screen, role and name across a pair and changes fingerprint. Elements whose key is not
unique are skipped.

### Actual

| Strategy | False merges | Visible only | Untouched churn | False splits | Splits skipped |
|---|---|---|---|---|---|
| 1 role + name | 2526–2621 | 1804–1899 | 0 | 0 | 2780 |
| 2 selector path | 0–0 | 0–0 | 516 | 755 | 2780 |
| 3 fiber walk (mangled) | 2179–2275 | 1659–1755 | 1199 | 2493 | 2780 |
| 4 attribute | 2436–2531 | 1734–1829 | 0 | 3 | 2780 |
| 5 attribute + file | 2436–2531 | 1734–1829 | 0 | 3 | 2780 |
| 6 marked fiber | 2254–2349 | 1734–1829 | 0 | 11 | 2780 |
| 3 fiber walk (as shipped, reported) | 2160–2255 | 1640–1735 | 0 | 20 | 2780 |

### react-admin demo

| Strategy | False merges | Visible only | Untouched churn | False splits | Splits skipped |
|---|---|---|---|---|---|
| 1 role + name | 2340–2475 | 1512–1557 | 0 | 0 | 2261 |
| 2 selector path | 0–0 | 0–0 | 0 | 0 | 2261 |
| 3 fiber walk (mangled) | 2196–2331 | 1440–1485 | 1017 | 901 | 2261 |
| 4 attribute | 2340–2475 | 1512–1557 | 0 | 0 | 2261 |
| 5 attribute + file | 2340–2475 | 1512–1557 | 0 | 0 | 2261 |
| 6 marked fiber | 2304–2439 | 1512–1557 | 0 | 0 | 2261 |
| 3 fiber walk (as shipped, reported) | 2232–2367 | 1440–1485 | 0 | 0 | 2261 |

No pair the referee could not rule on (`undecided`) arose on either app. The undetermined
churn count, components whose definition could not be located, is zero everywhere.

### The verdicts the plan pre-registered

- **Rule 1, "the composite must beat every alternative it was chosen over": fails.** Strategy
  5 beats no strategy on either app.
  - Actual: against role + name it has fewer merges but 3 false splits to 0. Against selector
    path it has 0 untouched churn to 516, but merges above 0. Against strategies 3 and 6 it
    trades. Against 4 it is identical.
  - react-admin: identical to role + name and to strategy 4. Selector path beats it, and so
    does strategy 6.
- **Rule 2, "churn on untouched components must be zero": passes for strategy 5.** Strategy 5
  churned at one pair only, Actual 4→5: 21 fingerprints vanished, and the diff touched every
  one. Role + name, attribute and marked fiber also had none. Selector path had untouched
  churn at 5 of Actual's 9 pairs (516 instances), and the mangled fiber walk 1,199 on Actual and
  1,017 on react-admin.
- **Strategy 3 stays only if, mangled, it beats role + name on both apps: it does not.** It has
  1,199 instances of untouched churn on Actual and 1,017 on react-admin, against 0.
- **Strategy 6 replaces 5 only if it beats 5 and passes rules 2 and 3: it does not.** It trades
  with 5 on Actual (fewer merges, 11 false splits to 3). It beats 5 on react-admin, but only on
  merges, by 36 (see the referee caveat).
- **"If neither 5 nor 6 beats strategy 1 on an app, the build plugin is carrying nothing
  there": true on Actual.** On react-admin, 6 beats role + name, by the same 36 merges.
- **The dev-against-prod comparison (an input, not a gate).** Mangling the fiber walk's names
  barely moves its merges (Actual 2160 → 2179 at the lower bound). It is what turns zero
  untouched churn into 1,199. Minification's cost to the fiber walk is instability, not
  collisions.

## How far to trust these numbers

1. **The referee misreads nested lists, so every merge count is inflated.** On Actual's budget
   screen, each row's "View notes" button has its own nearest keyed list, because the key that
   matters is inside the row. The referee rules the copies distinct, so right merges count as
   false ones. That changes the size of the merge counts, but not rule 1's verdict on strategy
   5, which rests on two things the referee does not decide:
   - the false splits against role + name, and
   - real merges, such as Actual's unlabelled toolbar icon buttons, which collapse into one
     fingerprint from different slots of the same list item.

   Comparisons decided by merges alone are weak. That includes 6 against 5 and 6 against role +
   name on react-admin, where the margin is 36.
2. **Selector path cannot merge, by construction.** A full positional path is unique per
   element. Rule 1's three counts do not penalise a failure to merge identical repeats, so
   strategy 5 cannot beat selector path on any app where it has a single real merge. That was
   true when the rule was written, and nobody noticed. It is recorded here, and the rule is not
   reread after the fact.
3. **About half of each pair's elements cannot be judged for splits** (pre-registered item 7).
   Their screen, role and name key is not unique, so they are skipped.
4. **React-admin is the dependency-upgrade case.** Its own source does not change in the window
   (`CORPUS.md`), so every pair there tests library drift alone. Selector path's perfect score
   there says the DOM did not move, not that positional identity is stable.

## Rules 3 and 4

Not scored. The worksheets are written (`worksheets.ts`). Rule 3 needs the 40 flow rows
matched by hand at commit 10. Rule 4 has 8 vanished strategy 5 fingerprints to label blind,
all at Actual 4→5. React-admin has none, as `CORPUS.md` predicted, so its rule 4 is
unanswered rather than passed.

## What was seen before scoring

Only what `CORPUS.md`'s run 1 section lists, plus run 2's build results, its rebuild-control
verdicts and element counts, and the react-admin commit 3 diagnosis above. The scoring code
had not read a capture before 2026-11-18. Its one change on that day, voiding a commit whose
control failed, came before any number.
