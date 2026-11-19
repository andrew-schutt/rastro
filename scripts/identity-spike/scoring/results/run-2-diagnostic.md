# Run 2, diagnosed: where `attribute`'s false merges live

A diagnostic on **seen** data, run 2026-11-19 after [run 2](run-2.md) was scored. It judges
nothing, and it is not part of any rule. It was run to decide which candidates the next run
pre-registers, and every later run discloses it as seen. The code is
[`../run-2-diagnostic.ts`](../run-2-diagnostic.ts).

**The finding: a JSX site as first proposed would separate at most 94 of Actual's 2436 merges and
72 of react-admin's 2340, and probably none.** The merged elements are not written as host JSX in the app's own components, so host-only
stamping cannot see what distinguishes them, and a site stamped the same way inherits that.
Most of the merges are also the referee's error, not real.

## What was proposed, and what this tested

After run 2, three candidates were proposed to fix the unlabelled-element merge
(`fingerprint.dom.test.tsx`, "KNOWN MERGE"). The plugin would stamp each host element with its
**JSX site**, `<owner>:<tag>#<n>`: the owning component and the element's index among that
owner's JSX elements of the same tag, in source order. The candidates were:

- **S1**: the site, in place of the name, for unnamed elements only.
- **S2**: the site on every element.
- **S3**: role and name, with the site for unnamed elements, and no chain.

A site can only separate two merged elements if they are written as different host JSX elements
in their owner's own JSX. This diagnostic asks how often that holds.

## Method

The diagnostic reads load 1's screens of every non-void commit, as rule 1 does, and groups each
`attribute` fingerprint's elements with the frozen referee (`groupSites`), at the lower bound. Its
totals equal run 2's: **2436 on Actual and 2340 on react-admin**, with react-admin commit 3 void.
For each falsely merged fingerprint, it takes one element per referee group and asks two things:

1. **Where is the element written?** Its owner is the innermost first-party component of its
   recorded ancestry. The owner's file is parsed at the commit, and the plugin's own
   `owningComponent` counts the host JSX elements of the element's tag that the owner owns.
2. **Does any component information separate the members?** Their full first-party ancestries,
   uncapped, are compared.

Both are proxies. Counting by tag cannot say *which* of several sites rendered an element, and a
host element of the right tag in the owner does not prove it rendered this one. One error matters,
because it runs toward hiding a separable merge. An element written as host JSX in one component
and passed as `children` into another has the second as its innermost ancestor, so it is filed
"not in the owner's JSX" when a site exists. The nearest stamp bounds that. An element written as
host JSX in the app carries its writer's stamp, so a misfiled one cannot have `View` or no stamp
as its nearest. Only merges whose nearest stamp is something else could be misfiled: **94 on
Actual and 72 on react-admin.** That is the bound in the finding above.

Counts are excess distinct elements (distinct − 1), summed over commits and screens, as in run 2.

## Where the elements are written

| | Actual | react-admin |
|---|---|---|
| Not in the owner's JSX: a primitive or library renders it | 1050 (700 named, 350 unnamed) | 2232 (585 named, 1647 unnamed) |
| One owner, **one** JSX site of that tag | 1194 (14 named, 1180 unnamed) | 0 |
| Different owners, which the chain did not see | 192 (named) | 36 (unnamed) |
| One owner, mixed tags | 0 | 72 (named) |
| **One owner, several JSX sites: the only case a site can separate** | **0** | **0** |
| Class 2: same component name, different files | 0 | 0 |

The nearest stamp makes the reason concrete:

- **Actual: 2342 of 2436 merges have `View` as their nearest stamp.** Actual builds its components
  from the component library's `View`, which is a `<div {...restProps}>`. The app's own components,
  such as `SelectCell`, `StatusCell` and `Row`, render `<View>`, not host elements. So they are
  never stamped, and the only owner the DOM records is the primitive. Every one of those elements'
  sites would be `View:div#0`.
- **react-admin: 2268 of 2340 merges have no stamp at all (`unknown`).** The demo composes
  react-admin and MUI components, so most interactive elements have no stamped ancestor.

## Whether anything separates them

| Members' first-party ancestry | Actual | react-admin |
|---|---|---|
| Identical: no component-based identity can separate them | 526 | 2304 |
| Diverges within 4 components of the owner | 362 | 36 |
| Diverges more than 4 above the owner | 1548 | 0 |

On react-admin, almost every merge sits between elements with identical ancestry. Those are
either right merges the referee misjudged, or separable only by position.

## Most of the merges are the referee's error

Two examples show the nested-list caveat in [run 2's report](run-2.md) at work:

- **Actual's 57-way merge `View>FixedSizeList>View|div` on `/accounts`.** These are the register's
  cell buttons. Their ancestries differ at `SelectCell`, `StatusCell` and `Cell`, so a few columns
  are distinct, each repeated down every row. The referee calls all 57 distinct, because each
  cell's nearest keyed item belongs to its own row's inner list.
- **React-admin's 32-way `unknown|input:checkbox` on `/orders`.** This is the row-select checkbox,
  a right merge.

So how many of the 4776 are real is not known. The captures record only each element's nearest
keyed item, so a fixed referee cannot rule on them. It needs a recapture.

## What was decided from it, 2026-11-19

Decided by the maintainer after reading this. Nothing here was chosen with a candidate's number in
view, because no candidate has one.

1. **S1 to S3 are not pre-registered.** The diagnostic predicts they would separate little or
   nothing that run 2 measured.
2. **The referee is fixed first.** Two elements are repeats when they diverge at their lowest
   common ancestor, that ancestor is a keyed list, they sit in different items of it, and their
   paths below the items match step by step (key where keyed, slot otherwise). The capture must
   record the full keyed path to support that, so the fix is a runner change and part of the next
   freeze.
3. **Then a call-site chain is the candidate.** The plugin stamps component elements as well as
   host elements, so `<View>` inside `SelectCell` carries `SelectCell` onto the `<div>` that
   `View` spreads its props onto. This reverses the plugin's host-only rule, and it depends on each
   component spreading unknown props onto its DOM. Its definition, and how coverage is measured
   where a component does not spread, are pre-registered before the run.
4. **Rule 1 is restated for the next run**, before any number:
   - Domination adds a fourth axis, **split repeats**: elements the referee calls repeats of one
     another that carry different fingerprints. Rule 1 never charged selector path for failing to
     merge (run 2's caveat 2).
   - The candidate must dominate `attribute` and role + name. Against selector path, a strategy
     that fails rule 2 on any app is beaten, and otherwise the four-axis test applies.
   - False splits are matched by role + name, which is role + name's own fingerprint. So **role +
     name has zero false splits by construction**: its zero in run 2 was not a measurement. This
     was not recorded with run 2, and is stated in the rule rather than discovered after it.
   - Under the upper bound, selector path never loses on merges. If it also passes rule 2, the
     comparison against it is undecided, which is reported as such and does not pass.
5. **The unseen commits are a forward window.** The rule in `CORPUS.md`, "The commits", is applied
   to the 30 days after each app's pin, ending 2026-11-29. Run 2's twenty commits are rerun beside
   them and labelled seen.
