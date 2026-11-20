# The §3.2 corpus, pre-registered

Every choice the corpus runner would otherwise make while looking at data:

- which commits are walked,
- which screens are captured,
- what state the apps are in,
- which elements rule 3 is judged on.

Fixed on 2026-11-01, before the runner exists. The rules are in
[`VALIDATION-PLAN.md`](VALIDATION-PLAN.md) §3.2. This file is the inputs they run on.

**Any change after a corpus number is seen makes it a different run, reported separately.**
That holds for a commit, a screen, a run condition or a flow element alike. Where something
here turns out to be impossible, record that against it, and do not quietly substitute.

**What had been seen when this was written.** This is not blind, and says so.

- Both apps had been build-checked at their pinned commits (2026-10-30), with `rastro-core`'s
  own functions run on four screens of Actual and five of the react-admin demo. What those
  samples showed is in [`NOTES.md`](NOTES.md), under the reopened attribute decision.
- No commit other than the two pins had been built.
- No fingerprint had been compared across commits.

The commit lists below come from a mechanical rule, so that exposure cannot have chosen them.

## The apps

| | Actual Budget | react-admin demo |
|---|---|---|
| Repository | `actualbudget/actual` | `marmelab/react-admin`, `examples/demo` |
| Pinned (build-checked) | `e82ea4dc3594e7e0c32ba7b1039913c19e6ce9f9`, 2026-10-30 | `7845c813503898db5ec25365855f84ad7d070e56`, 2026-10-30 |
| Build | `corepack yarn build:browser --skip-translations`, then serve `build/` with COOP/COEP headers | `REACT_APP_DATA_PROVIDER=rest NODE_ENV=production corepack yarn vite build` |
| Harness patch | `babel-plugin-rastro` (`root` = repo root) added to the existing `babel({ presets: [reactCompilerPreset()] })` call | `@rolldown/plugin-babel@0.2.4` with `babel-plugin-rastro`, `include` scoped to `examples/demo/src`, `root` = the demo directory |
| Ships with | `mangle: false` | `keepNames: true` |
| Entry | "Try the demo" (no server) | sign-in accepts any credentials |

**Strategy 6 also needs `markComponents: true`** in the plugin options, in the same scope as
the stamps. Strategy 3 is rebuilt with mangling forced on, as rule 1 requires. The build
scoping in rule 1 applies unchanged.

These apps are third-party code with their own install scripts. They are built by hand,
locally, and never in CI.

## The commits

**The rule, applied identically to both apps:**

1. Start from the default branch's **first-parent** chain, ending at the pinned commit. That
   chain is the sequence of states the branch was actually in, like a series of deploys.
2. **Eligible** commits are those in the 30 days ending at the pin (by committer date) whose
   first-parent diff touches a **build input**: anything the app's browser build reads from
   the repository. A commit touching only docs, CI or other apps is not a deploy of this app.
3. Take **10** eligible commits, spaced evenly by index from the oldest to the newest. With
   `n` eligible, oldest first and counting from 0, these are indices `round(i × (n − 1) / 9)`
   for `i` = 0 … 9.
4. Each consecutive pair of selected commits is one deploy, which gives **9 pairs per app**.
   A pair usually bundles several commits, as a real deploy does.

If fewer than 10 commits had been eligible, the window would have widened in further 30-day
steps. That did not happen.

### Actual Budget

Build inputs: `packages/desktop-client`, `packages/component-library`, `packages/loot-core`,
`packages/crdt` and `packages/plugins-service` (the shipped app and the workspace packages it
depends on), `yarn.lock`, and the root `package.json`.

Window `2026-09-30T08:59:36Z` → the pin. **132 eligible.**

| # | Commit | Date |
|---|---|---|
| 1 | `7f74953a5422c480e09175013ff872b9fd29500b` | 2026-10-01 |
| 2 | `821caa264304b391f62216e4affa1ee5e6dc5410` | 2026-10-03 |
| 3 | `1ad8477abdc432f318be27dc2fde25dde6ab0720` | 2026-10-06 |
| 4 | `358823017c93dbe5bf4bd469e6b49eb2cac00cf8` | 2026-10-09 |
| 5 | `52ac1f91e5b8c28311354a6faad6bed0d9ec7f8e` | 2026-10-12 |
| 6 | `63180ceeabb119a9184200b04f388a6394f90073` | 2026-10-17 |
| 7 | `6e68ee1de1c54cf3b8c69d17aa1c4fde219f64e2` | 2026-10-21 |
| 8 | `168e174b47c0dc8a5cf4b0e9aef808371c6e393d` | 2026-10-25 |
| 9 | `d9d15c12fa41a0bb8380fab09519e0180333e146` | 2026-10-27 |
| 10 | `e82ea4dc3594e7e0c32ba7b1039913c19e6ce9f9` | 2026-10-30 (the pin) |

The sidebar was reorganised inside this window: on 2026-10-12, Payees, Rules, Tags and Bank
Sync moved into Settings, and the menu became configurable. That was found while choosing
screens, after the commits were already fixed by the rule. It is why screens below are named
by route, not by menu position.

### react-admin demo

Build inputs: `examples/demo`, `packages` (Vite aliases every react-admin package to its
`src/`, so the demo is built from library source), `yarn.lock`, and the root `package.json`.

Window `2026-09-30T09:10:21+02:00` → the pin. **29 eligible.**

| # | Commit | Date |
|---|---|---|
| 1 | `47890673cae903b9c5a33898c07a12ea94205b5a` | 2026-10-02 |
| 2 | `c2f0b8ffd19af658241cb10b67f0de18744136f5` | 2026-10-11 |
| 3 | `eec76175e77e1a47a7ec6471346c4f2fbdb940a1` | 2026-10-11 |
| 4 | `d19769a44762b9314e2d12a06b4b9ea9546929d9` | 2026-10-11 |
| 5 | `a66bd3ec1c279a70d13758c7ba86e72b10d25a4e` | 2026-10-16 |
| 6 | `a13cab504a42fb7888f9ede38cbc32a2e60ff69c` | 2026-10-19 |
| 7 | `089ad1bf6d55500eab228f3833d12a5dbaf530cb` | 2026-10-24 |
| 8 | `fa22e2db862a6ea85941fa88cb294622c3012df4` | 2026-10-25 |
| 9 | `679e5e17cd6803abf722acdfb0d1add34067a65f` | 2026-10-25 |
| 10 | `61acd3f62174b9c2d3c1aa5856c7411d7713aaab` | 2026-10-25 |

The last selected commit is not the pin. The two merges after it, up to and including the
pin, touch no build input: `git diff 61acd3f 7845c81 -- examples/demo packages yarn.lock
package.json` is empty. So it builds the app that was build-checked.

**The demo's own source does not change anywhere in this window.** `examples/demo` is
identical at commits 1 and 10. Its own `src/` last changed on 2026-07-30. Every pair is a
library change (`ra-ui-materialui`, `ra-core` and others) or a lockfile bump. Under rule 2,
every element is therefore *untouched* at every pair. This is the dependency-upgrade case,
measured nine times. Two consequences, predicted here rather than discovered later:

- (b)'s *edited* bucket on react-admin will be empty, and (c) has little to work on.
- Rule 4 on react-admin will probably have **no fingerprint labelled `continued`**, which the
  plan scores as unanswered, not passed. Any churn there is library-driven, so rule 2 judges
  it directly. Actual carries the edited-component signal for (b), (c) and rule 4.

## Run conditions

Identical for every commit, every strategy and both apps.

- **The page reaches the local server and nothing else.** Added after run 1, which this
  voided. See "Run 1 is void" below.
- **Browser:** Chromium, desktop viewport 1280 × 800, English locale. Mobile layouts are out
  of scope, so every screen below is its desktop layout.
- **The user agent does not identify the runner as Playwright.** Actual switches to a
  test-only pseudo-random generator when `navigator.userAgent` contains `playwright`. That
  is a test mode the app's users never see.
- **The clock is fixed at `2026-10-30T12:00:00Z`.** Both demos generate data relative to
  today.
- **`Math.random` is replaced by one seeded generator** before any app script runs, with the
  same seed for every load. Actual's demo budget draws from `Math.random`, and the
  react-admin demo's data comes from unseeded faker.
- **The rebuild control.** Every commit is loaded **twice**, and every fingerprint under every
  strategy must be identical across the two loads. This is the fixture's `rebuild` scenario,
  on the corpus. If it fails, that commit's numbers are void until the runner is fixed, and
  the fix is recorded. Run-to-run noise counted as churn would fail rule 2 for a reason that
  has nothing to do with identity.

### Amended 2026-11-09, before any corpus number

Building the runner at the two exposed commits found conditions above that could not hold as
written. Each change below was decided then, and nothing here was chosen with a result in view.

**What had been seen when this was written.** Only the two exposed commits (Actual's pin,
react-admin's commit 10) had been loaded. Seen: element counts per screen, rebuild-control
verdicts, and, while investigating failed controls, the fingerprints that differed between two
loads of one build. No fingerprint had been compared across commits. No collision, churn or
proposer number had been computed.

- **Crypto is seeded too.** `crypto.getRandomValues` and `crypto.randomUUID` draw from a second
  seeded generator, so `Math.random`'s sequence is the one it always was. Actual's demo data
  takes its ids from `crypto.randomUUID()`, and transactions that tie on date are ordered by
  them. With only `Math.random` seeded, its screens differed on every load and the rebuild
  control failed under all six strategies.
- **The clock is frozen, not started.** Every read of the clock in a load returns
  `2026-10-30T12:00:00Z`. A clock left running would make relative dates depend on how long a
  load took.
- **The time zone is UTC.** Otherwise the dates the apps render depend on the machine.
- **The run conditions reach workers.** A page-level script does not, and Actual builds its demo
  budget in its backend worker. The corpus server prepends the conditions to every script the
  browser requests as a worker (`Sec-Fetch-Dest`), and each load checks every worker that
  answers. A worker that answers without them fails the capture. One that does not answer is
  recorded: at Actual's pin that is its IndexedDB helper, which blocks in `Atomics.wait`, and
  whose decoded source uses no `Math.random`, `Date` or `crypto`.
- **Service workers, per app.** Actual's is a precache that fetches the app's files itself, so a
  cached worker script would run without the conditions. Its requests go past it, as on a first
  visit. The react-admin demo's is Mock Service Worker, its data backend, so it is kept, and is
  served with the conditions like any worker.
- **Every screen is a real load.** The react-admin demo routes by hash, and a hash change is not
  a load, so each of its screens is reached through `about:blank`.
- **The user agent** is Chrome's own, with `HeadlessChrome` reported as `Chrome`.
- **The rebuild control judges strategies 1 and 3 to 6.** Strategy 2, the selector path, keeps
  element ids, as PostHog's `$elements_chain` does. Actual's react-aria components take theirs
  from React's `useId`, which numbers by mount order, so the same button on the same build has a
  different strategy 2 fingerprint on a reload. That is the strategy's behaviour, not the
  runner's noise, so strategy 2's load-to-load stability is measured and reported beside the
  control instead of judging it. **Open:** whether PostHog's autocapture keeps generated ids
  like these. Check its source before this is reported as anything about the incumbents.
  **Settled 2026-11-17, from source, before any corpus number: it keeps them, so strategy 2
  stands as defined.** posthog-js (`8c832754`, the commit `baselines.ts` cites, and `fce957b9a`,
  2026-11-16) copies every attribute of every element in the chain, `id` included. It filters
  only values shaped like card or social security numbers, Angular's `_ngcontent`/`_nghost`
  attributes ("these update on each build and lead to noise"), and an ignore list that is
  empty by default. On sensitive elements it still keeps `id`. Nothing recognises React's ids.
  `elementsToString` writes the id into `$elements_chain` as `attr_id`, and the server's
  `nodejs/src/common/utils/elements-chain.ts` (posthog `be0a6f2`) parses it back out unchanged.
  Not read: every ingestion transformation a customer can install. Nor is the instability the
  runner's doing. React's client-side `useId` takes `globalClientIdCounter++`, one counter for
  the page's life, never reset (react-dom 19.2.8; Actual ships 19.3.0). So an id depends on
  everything mounted before it, and a real user's session moves it as the two loads here do.
  Strategy 2's load-to-load instability is reported as the incumbent's behaviour.

## Screens

**The rule:** every destination in the app's primary navigation that is visible by default at
the pin, by route, in its default state after load. For a screen that does not exist at some
commit, the screen is reported absent, not replaced. The flow states in rule 3 below are
captured as well.

**Actual.** `/budget`, `/reports`, `/schedules`, `/settings`, `/accounts` (All accounts), and
the register of the first account listed under "On budget". The other accounts' registers are
the same component over different data, so one stands for all.

**react-admin demo.** `/` (Dashboard), `/orders`, `/invoices`, `/products`, `/categories`,
`/customers`, `/segments`, `/reviews`.

## Rule 3: the flow that matters

Rule 3 requires zero collisions among the ~20 elements of one real flow. One flow per app,
listed from each app's source at the last selected commit. Each element is described by screen,
role and visible label, never by fingerprint, so the list is the same under every strategy.

**How elements are matched at each commit.** By hand, from that description. Where an element
cannot be found, or is not matched by `INTERACTIVE_SELECTOR` (capture would emit no event for
it), it is **reported, not substituted**. A cell that is a `<div>` until it is edited is a real
finding about what capture can see, not a gap in this list.

**What counts as a collision.** As the plan's rule 3 now words it (widened 2026-11-02, before
any corpus number): any element of this list sharing a fingerprint, at the same commit, with
any other distinct element **on the same screen or state**, whether or not that element is on
the list. The collision referee judges "distinct", so repeats of one element in a list are not
collisions. Collisions with elements on other screens are reported beside the rule but do not
fail it, because events carry the route and can still tell those apart.

Source paths are relative to each app's components directory:
`packages/desktop-client/src/components/` for Actual, and `examples/demo/src/` for the demo.

### Actual: add a transaction to an account

Open the first on-budget account from the sidebar. Add a transaction, choosing the payee and
the category from their suggestion lists and entering a payment. Add it, then return to the
budget.

| # | Screen / state | Element | Source (at the pin) |
|---|---|---|---|
| A1 | sidebar | link: the first account under "On budget" | `sidebar/Accounts.tsx` |
| A2 | sidebar | link: "Budget" | `sidebar/PrimaryButtons.tsx` |
| A3 | register | button: "Add New" | `accounts/Header.tsx` |
| A4 | register | button: "Import" | `accounts/Header.tsx` |
| A5 | register | button: filter | `accounts/Header.tsx` (`FilterButton`) |
| A6 | register | search input: "Search" | `accounts/Header.tsx` |
| A7 | register | button: "Account menu" | `accounts/Header.tsx` |
| A8 | register | button: "Reconcile" | `accounts/Header.tsx` |
| A9 | new transaction row | Date field | `transactions/TransactionsTable.tsx` |
| A10 | new transaction row | Payee field | `transactions/TransactionsTable.tsx` |
| A11 | new transaction row | Notes field | `transactions/TransactionsTable.tsx` |
| A12 | new transaction row | Category field | `transactions/TransactionsTable.tsx` |
| A13 | new transaction row | Payment field | `transactions/TransactionsTable.tsx` |
| A14 | new transaction row | Deposit field | `transactions/TransactionsTable.tsx` |
| A15 | new transaction row | button: "Add" | `transactions/TransactionsTable.tsx` (`NewTransaction`) |
| A16 | new transaction row | button: "Cancel" | `transactions/TransactionsTable.tsx` (`NewTransaction`) |
| A17 | payee suggestions open | the first suggested payee | payee autocomplete |
| A18 | category suggestions open | the first suggested category | category autocomplete |
| A19 | after Add | the new transaction's select checkbox | transaction row |
| A20 | after Add | the new transaction's Payee cell | transaction row |

### react-admin demo: mark a pending order delivered

Open Orders from the Sales menu, open the newest order in the "ordered" tab, set its status to
delivered, and save. Then check the "delivered" tab.

| # | Screen / state | Element | Source (at commit 10) |
|---|---|---|---|
| R1 | sidebar | menu toggle: "Sales" | `layout/Menu.tsx` (`SubMenu`) |
| R2 | sidebar | link: "Orders" | `layout/Menu.tsx` |
| R3 | `/orders` | tab: "ordered (n)" | `orders/OrderList.tsx` |
| R4 | `/orders` | tab: "delivered (n)" | `orders/OrderList.tsx` |
| R5 | `/orders` | tab: "cancelled (n)" | `orders/OrderList.tsx` |
| R6 | `/orders` | search input | `orders/OrderList.tsx` (`SearchInput`) |
| R7 | `/orders` | button: add filter | `orders/OrderList.tsx` (`FilterButton`) |
| R8 | `/orders` | button: columns | `orders/OrderList.tsx` (`ColumnsButton`) |
| R9 | `/orders` | button: "Export" | `orders/OrderList.tsx` (`ExportButton`) |
| R10 | `/orders`, ordered tab | the first row (its click opens the order) | `orders/OrderList.tsx` (`DataTable rowClick="edit"`) |
| R11 | `/orders`, ordered tab | the first row's customer link | `visitors/CustomerReferenceField` |
| R12 | `/orders/:id` | button: previous order | `orders/OrderEdit.tsx` (`PrevNextButtons`) |
| R13 | `/orders/:id` | button: next order | `orders/OrderEdit.tsx` (`PrevNextButtons`) |
| R14 | `/orders/:id` | select: "Status" | `orders/OrderEdit.tsx` (`SelectInput`) |
| R15 | Status menu open | option: "delivered" | `orders/OrderEdit.tsx` |
| R16 | `/orders/:id` | switch: "Returned" | `orders/OrderEdit.tsx` (`BooleanInput`) |
| R17 | `/orders/:id` | link: the customer's name | `orders/OrderEdit.tsx` (`CustomerDetails`) |
| R18 | `/orders/:id` | link: the first basket item's product | `orders/Basket.tsx` |
| R19 | `/orders/:id` | button: "Save" | `orders/OrderEdit.tsx` (`Toolbar`) |
| R20 | `/orders/:id` | button: "Delete" | `orders/OrderEdit.tsx` (`Toolbar`) |

The tab labels carry live counts, so their names depend on the data. The seeded run
conditions above are what keep them fixed across commits.

### Amended 2026-11-09, before any flow was driven

Capturing the screens settled how a screen is reached and judged. It said nothing about the
states a flow passes through, and the runner cannot be written without deciding them. Each
rule below was decided before either flow was driven by any code, at any commit.

**What had been seen when this was written.** Everything the 2026-11-09 run-conditions amendment
lists, and nothing since. No flow state had been captured. One line of Actual's source at the
pin was read to decide the clock (below).

- **A flow is one walk per load, after the screens.** Each load captures every screen first and
  then walks the flow, so nothing the flow writes can reach a screen capture. The walk starts
  from a real load of its first screen: Actual's `/budget`, the react-admin demo's `/`. After
  that it moves only by the flow's own interactions. Clicking "Orders" or an account link is
  the flow, and a real load would skip what it is measuring.
- **Every state in the tables is captured,** in the order the flow reaches it, whole document,
  like a screen. A state is captured once even when several rows name it.
- **Interactions are real input.** Clicks and keys are dispatched through CDP's `Input` domain
  at the element's on-screen position, never `element.click()` or a synthetic event. Apps
  handle synthetic events differently, and capture listens for the real ones.
- **The flow's inputs are fixed.** Actual: the date is left as the app fills it (the frozen
  clock makes it `2026-10-30`), the payee and the category are the first suggestion in each
  list as it opens with nothing typed, the payment is `12.34`, and Notes and Deposit are left
  empty. The react-admin demo: the order is the first row of the "ordered" tab as it loads, and
  the only edit is Status to "delivered". These are inputs, not results, and their values carry
  no meaning.
- **"First" is recorded.** Where a row says "first", the capture records the visible label of
  the item it got. A first item that differs between the two loads is caught by the rebuild
  control. One that differs between commits is reported beside the rule and not substituted.
- **A state counts as reached** when it settles, by the same rule as a screen, and shows what
  defines it: the suggestion list or the Status menu is open, the new row is in the register,
  or the route is `/orders/:id`. If a state is not reached, the walk stops there. That state
  and every later one are reported as not reached, and their rows are reported, not
  substituted. A flow that stops is a finding about the app or the runner, recorded with
  the step that failed. The step is not retried with a different interaction.
- **The clock stays frozen through the flow.** Adding a transaction at Actual's pin sets
  `sort_order = Date.now()` (`transactions/TransactionList.tsx`). A frozen clock keeps that,
  and so the register's order, the same on every load. A running clock would not. The cost is
  that code waiting for the clock to move would never finish. Such a step stops the walk as
  above. The clock is not switched mid-run without another dated amendment.
- **Flows run on both build variants,** like the screens, so strategy 3 is judged on the
  mangled build.
- **The rebuild control covers flow states.** Each state is held to the same strict, positional
  comparison as a screen: strategies 1 and 3 to 6 are judged, and strategy 2 is reported. A
  state that is not reached on either load fails the control, as an uncaptured screen does.
  Both loads start from fresh contexts. So if one load's transaction or saved order were
  still there on the next, the control would see it.
- **Collisions are judged in the state the table names.** A row's element is compared with
  every distinct element in that state's capture, which is the whole document at that moment.
  Rows A3 to A8 are judged in the register as loaded, and the same buttons are not judged
  again in a later state.

### Amended 2026-11-13, after both flows were walked at the exposed commits

Writing the flow drivers meant walking both flows, at the two exposed commits only. The steps
the amendment above defines left some questions open, and walking them answered these.
Nothing here was decided with a fingerprint, a collision or a cross-commit difference in view,
and none had been computed.

**What had been seen when this was written.** Everything the two 2026-11-09 amendments list.
Also, at the two exposed commits only: the visible text, roles and test ids of the elements
along each flow, per-state element counts, rebuild-control verdicts, and the labels the
"first" rows got (below). Once the capture recorded a description of every element (see the
runner's README), those descriptions were read for some flow states. That showed one rule 3
result early. In Actual's new transaction row, capture sees the Date field (A9) and the Add
and Cancel buttons (A15, A16), but not the Payee, Notes, Category, Payment or Deposit fields
(A10 to A14). Those are `<div>`s until they are edited, which is the case "How elements are
matched" anticipates, and they will be reported, not substituted. No fingerprint was printed
or read.

- **A18 skips "Split Transaction".** Actual's category list opens with "Split Transaction"
  above every category. It is an action on the transaction, not a category, and choosing it
  splits the transaction. A18 is "the first suggested category", so the walk takes the first
  item that is a category. Group headings in either list ("Suggested Payees", "Usual
  Expenses") are not items either. "Split Transaction" is still an element of that state, and
  rule 3 compares A18 against it like any other.
- **The payment replaces the field's text.** Actual's Payment field holds `0.00` and does not
  select it on focus, so typed text is appended to it. The walk selects the field's text with
  the platform's select-all keystroke, through CDP's `Input` like every other key, then types
  `12.34`.
- **The react-admin walk does not click "Sales" (R1).** The Sales menu is open by default, so
  its Orders link is already the click. Clicking "Sales" would close it. R1 is still judged in
  the sidebar state. At a commit where the menu starts closed, the Orders click finds nothing
  on screen and the walk stops there, as the amendment above requires. The walk does not adapt.
- **`/orders` and "`/orders`, ordered tab" are two states, so the walk captures both.** The
  table names them apart, so the walk clicks the "ordered" tab, the tab the flow opens its
  order from, and captures again. It is the default tab, so the click may change nothing, and
  then both captures should agree.
- **The first row is clicked on its date cell.** The row's centre is its customer link (R11),
  which opens the customer instead of the order.
- **Steps after the last named state are walked and checked, not captured.** These are
  Actual's return to the budget, and react-admin's Save and its "delivered" tab. No row of
  either table is judged after them. If one is not reached, the walk is still reported as
  stopped.
- **How "first" labels are recorded.** An item that shows a name and then a balance (Actual's
  sidebar accounts and suggestions) is recorded by its name. Anything else is recorded by its
  whole visible text. At the exposed commits these were A1 "Bank of America", A17 "Deposit",
  A18 "Food", R10 "VJ0ZOKQE" (the order's reference), R11 "Sherwood Paucek" and R18
  "Forgotten Strawberries". They were the same on both loads and both build variants.

### Amended 2026-11-17, before the freeze: what every capture records

The runner's freeze fixes what a capture records, so the capture was checked against what each
§3.2 rule needs, and completed first. Each element now also records: each strategy's parts
(rule 4), its full first-party component ancestry with files (rule 2's "touched"), and the
collision referee's input (rules 1 and 3). The runner's README lists them. None of these
changes a fingerprint, and the continuity snapshots did not move.

**What had been seen when this was written.** Everything the earlier amendments list. Also, at
the two exposed commits only: that every new field is filled in, the deepest ancestry (60
components on Actual, 6 on react-admin), that react-admin's ancestries hold only the demo's own
`src/` files, and that every captured element on both apps has a keyed ancestor. No referee
verdict, collision count or cross-commit difference was computed.

**Run 1 uses the `key` referee alone**, as `VALIDATION-PLAN.md` §3.2 now records. Pairs it
cannot rule on are reported as `undecided` and inspected by hand.

### Amended 2026-11-17, before the freeze: an unstable flow state voids that state, once traced

Completing the capture found a flow state that fails the rebuild control because of the app,
not the runner. Before this amendment, any failed control voided the whole commit's numbers.

**The rule.** A flow state reached on both loads, whose judged fingerprints differ between
them, voids **that state's rule 3 verdict at that commit, and nothing else**. This holds only
when a person traces the difference to the app's own data and records the evidence here. A
difference that is not traced, or that is traced to the runner, voids the commit as before.
Nothing is substituted for a void state, and nothing is retried. Screens are unaffected, and
so are states not reached and "first" labels that differ: each still fails the control as the
2026-11-09 amendment says. The runner lists every unstable state as void and exits unclean
until it is traced. It never decides the cause.

**The case that prompted it, and the first trace.** Actual, "after Add", mangled build at the
pin. Only three elements differed between the loads: the sidebar links for Capital One
Checking, All accounts and On budget, whose names include their balances. Capital One reads
1,679.09 on every screen and state until the transaction is added to Bank of America. In
"after Add" it read 1,743.52 on three loads and 1,693.86 on one. Those are 1,679.09 plus
64.43 and plus 14.77, which are exactly two of Capital One's own transactions (Kroger on 10/22
and on 10/26). Walking the same steps by hand showed 1,679.09 after the Add, with Capital
One's register unchanged. So the sidebar briefly shows a balance missing one of that account's
transactions, and which one depends on timing. That is the app's data, not the runner's
nondeterminism. Rows A19 and A20, the only rows judged in that state, are a checkbox and a
payee cell. Neither has a link's role, and every strategy includes the role, so neither can
collide with those links on either load.

**Also seen, not captured:** the Notes value Actual auto-fills on the new transaction differed
between runs ("#groceries" and "#home-improvement"). Notes is not an interactive element's
label, so no fingerprint reads it.

**What had been seen when this was written.** Everything the earlier amendments list. Also, at
Actual's pin only: the descriptions of the "after Add" state on all four loads, and the
balances of Capital One Checking in every capture of each load. No collision, churn or
proposer number was computed.

### Amended 2026-11-17, before the freeze: the browser build is pinned

The run conditions said "Chromium" and named no version. Chrome updates itself, so a run
spread over days could change browser partway through, and the browser's own changes would
show up as churn between commits. **Every capture runs in Chrome `157.0.8103.79`**, the build
every capture so far has used, and the runner refuses any other. Changing the pin after the
freeze makes a different run. To keep the build through the run, point the runner at a copy
that does not update itself, such as Chrome for Testing at this version.

## The runner is frozen, 2026-11-17

**At rastro commit `1d99a9d41b102b609e9e8059a56743ebf2cf9a57`**, recorded in `scripts/identity-spike/corpus/freeze.json`.
From here, every build and capture in the run must come from that runner, the exposed
commits included, or it is refused. The runner's README says what the guard compares and why.
The other eight commits per app may now be built and captured, with `--after-freeze`.

Before the freeze, only the two exposed commits had been built or captured. Everything seen
on them is listed in the amendments above, dated. No collision, churn or proposer number had
been computed on any commit.

**Any change to the runner from here makes a different run, reported separately.** That
covers code, the lockfile and the pinned browser. The same goes for anything this file fixes.

## Run 1 is void, 2026-11-17, and nothing was scored from it

Run 1 built and captured every commit of both apps at the frozen runner. Its own rebuild
control voided it, and no score was computed from any of it. The fixes below make the next
run a different run, as the line above requires. Run 1 is reported as void, never scored.

**What failed.** Actual's rebuild control failed at commits 5, 7, 8 and 10, on one build
each. Each time, the two loads differed by the same two elements: an "Open changelog" button
and its "Close" button. React-admin passed at every commit it built, but commit 9 did not
install.

**The trace: Actual asks GitHub, live, on every load.** `getLatestVersion`
(`packages/desktop-client/src/util/versions.ts`) fetches
`https://api.github.com/repos/actualbudget/actual/releases/latest`, unauthenticated. If the
answer is newer than the build, a notice with those two buttons is shown. Whether it was on
screen at capture depended on GitHub's answer, how long it took, and GitHub's limit of 60
unauthenticated requests an hour, which a run of hundreds of loads exhausts. That is data from
outside reaching the page through the runner. It is not the app's own data, so the void-state
rule above does not apply, and the 2026-11-09 rule does: void until the runner is fixed.

**Why all of run 1, not four commits.** Captures that passed the control had the notice on
both loads, or on neither. It was on screen through commit 4, then on and off from commit 5.
Between commits it would have counted as two elements vanishing on untouched code under every
strategy: churn that rule 2 cannot tell from identity loss. A passing control did not make a
capture clean.

**Fix 1, a run condition: the page reaches the local server and nothing else.** Chrome is
launched with `--host-resolver-rules` mapping every host except `127.0.0.1` and `localhost`
to nothing. Every other request fails at once, the same way on every load. That holds in the
page and in every worker, since it is the browser's resolver and not request interception.
Each load records the refused requests the page made (`refused` in `load-N.json`). Two
loads of Actual commit 1, with the fix in place, showed no notice and refused two hosts: the
GitHub releases call, and `raw.githubusercontent.com/.../master/.../news.json`, which Actual
reads live from its `master` branch. That second call had reached every run-1 capture too.
Two loads of react-admin commit 10 refused six Google Fonts stylesheets (Roboto, Inter,
Gabarito, Pixelify Sans, Open Sans, Geist), the theme fonts, and nothing else. Its text now
renders in the browser's fallback font, the same on every load and every commit. That changes
the layout boxes descriptions record. It changes no fingerprint, since none reads a box, and it
removes a second outside dependency: when a font arrived.

**Fix 2: react-admin commit 9 installs without `--immutable`, if nothing installed changes.**
At `679e5e1` the committed lockfile is out of step with the manifests, so
`yarn install --immutable` refuses it. Yarn's only rewrite merges two entries,
`zod@npm:^4.3.6` and `zod@npm:^4.5.4`, which both resolve to `zod@npm:4.6.7` with the same
checksum. The runner allows that commit, and only that commit, to install without
`--immutable`. It refuses the build unless every resolved package and checksum is unchanged,
then restores the committed lockfile. `build.json` records it. This builds exactly the code
that was committed, so it is not a substitution. The alternative, dropping the commit, would
have lost two of react-admin's nine pairs.

**What had been seen when this was written.** Everything the earlier amendments list. From
run 1, at every commit of both apps: build results, rebuild-control verdicts, element counts
per screen and state, and the elements that differed between loads where a control failed.
Also, to establish when the notice was present, how often "Open changelog" appeared in each
Actual load file. No fingerprint was compared across commits. No collision, churn, split or
proposer number was computed, and the scoring code has not read a run-1 capture.

## The runner is frozen again, 2026-11-17, for run 2

**At rastro commit `452fc46bb34c6238aa552d2353bf40999a656b5d`**, recorded in
`scripts/identity-spike/corpus/freeze.json`. It replaces the first freeze. That freeze's
runner made run 1, which is void. Run 2 is every commit of both apps, rebuilt and recaptured
from this runner, and it is the run the gate reads. Run 1's captures carry the first freeze,
and the scoring refuses them. Everything the first freeze section says still holds, with this
commit in place of `1d99a9d`.

## After run 2, 2026-11-18: the runner has changed, and this file describes run 2

Run 2 was scored (`VALIDATION-PLAN.md` §3.2, outcome). Rastro's identity was then narrowed to
one fingerprint ([`NOTES.md`](NOTES.md)), and the runner changed with it:
- it measures three strategies, not six: role + name, selector path and `attribute`;
- it builds `as-shipped` only, with no `mangled` variant;
- the marks rule 2 reads come from a measurement-only Babel plugin
  (`scripts/identity-spike/src/mark-plugin.ts`), not from `babel-plugin-rastro`;
- since 2026-11-19, a second measurement-only plugin (`src/site-plugin.ts`) stamps every JSX
  element's site for a new collision referee (`src/site-referee.ts`), which fixes the key
  referee's nested-list error. Both apps' own source gets it in the step above. React-admin's
  library source (`packages/*/src`) gets it alone, in a second `@rolldown/plugin-babel` step.
  Which referee judges the next run is part of that run's pre-registration.

`freeze.json` still names run 2's runner, so every build and capture now refuses to run. That
is deliberate. **The next run is pre-registered and frozen anew before it runs**, and everything
above stays as the record of what run 2 ran on. That includes this file's six strategies and two
variants. Run 2's captures remain readable by the scoring for the three strategies that remain.
A fingerprint redesigned after seeing run 2 is judged on corpus commits nobody has seen, and
these two apps' commits are reported alongside it, labelled as seen.

## Run 3, pre-registered 2026-11-20, before any of its numbers

What run 3 runs on. Its rules are in [`VALIDATION-PLAN.md`](VALIDATION-PLAN.md) §3.2, "Run 3".
Everything above still holds unless this section replaces it, and **any change after a run 3
number is seen makes a different run.**

**What had been seen.** All of run 2, and the run 2 diagnostic, on the twenty commits above.
The site referee was smoke-tested at the two exposed commits, in a separate corpus directory,
outside any freeze. That read element counts, page errors, rebuild-control verdicts and whether
every element had a site sequence (all did, on both apps). No grouping, merge or split count was
computed. For the forward window, only the two pins' own committer dates were read. No later
commit has been listed, read or built.

### The commits: a forward window

**The rule above ("The commits") is applied to the 30 days after each pin**, unchanged in every
other respect:
- the same first-parent chain of the default branch;
- the same build-input lists;
- 10 eligible commits, spaced evenly by index;
- 9 pairs per app.

| | Window, by committer date |
|---|---|
| Actual | after `2026-10-30T08:59:36Z`, up to and including `2026-11-29T08:59:36Z` |
| react-admin | after `2026-10-30T10:10:21+01:00`, up to and including `2026-11-29T10:10:21+01:00` |

The pins themselves are run 2's and are not in the window. The chain is read from the default
branch as fetched after the window closes. The commits are selected by script, and recorded
here with their count of eligible commits before any of them is built. Two cases are fixed
now, before anyone has looked:
- *Fewer than 10 eligible in an app's window:* it widens in further 30-day steps, as the rule
  says. The run waits for that.
- *A new build input:* a commit in the window may add a path the browser build reads. If so,
  the path is added to that app's list, and that is recorded before selection. It is never
  added after a number is seen.

**Run 2's twenty commits are rerun** under run 3's runner, with both builds. Their numbers are
reported beside run 3's verdict, labelled seen. They judge nothing.

### Builds: two per commit

| Build | Plugins, in the app's own source | Measures |
|---|---|---|
| `as-shipped` | `babel-plugin-rastro`, the marks, the sites | role + name, selector path, `attribute` |
| `call-site` | the same, then the caller plugin | the call-site chain |

Each strategy is measured on the build an app using it would have. The caller stamps can
change what a component passes into a stylesheet call, and so a class name the selector path
reads. Selector path and `attribute` are also captured on `call-site`, and the differences from
`as-shipped` at each commit are reported, not judged.

The caller plugin's scope is each app's own source, as the stamps' is: Actual's
`packages/*/src`, and react-admin's `examples/demo/src`. React-admin's library source gets the
site stamps alone, on both builds, for the referee.

The rebuild control applies to each build separately. A commit whose control fails on either
build is void for every strategy, with both pairs it is part of, as for run 2.

### Unchanged, restated so nothing is assumed

- **Screens and flows** are run 2's. A screen or flow state that does not exist at a window
  commit is reported absent, and never replaced. The flow drivers are frozen with the runner. A
  step they cannot take at a later commit stops the walk, and the unreached states are
  reported.
- **Run conditions** are run 2's, the clock included (`2026-10-30T12:00:00Z`). It is kept for
  the seen commits' sake, so their rerun is comparable with run 2.
- **The browser** stays Chrome `157.0.8103.79`, now run from a Chrome for Testing copy outside
  the repo, at `~/rastro-corpus/chrome-157.0.8103.79/` (`CHROME`). The installed Chrome updated
  itself to 158 on 2026-11-19, which the runner refused.

### The freeze

The runner is frozen anew once it is built, and before any run 3 capture, including the
reruns. `freeze.json` then names that commit. The window's commits are built only after it
closes.
