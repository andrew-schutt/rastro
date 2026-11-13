// scripts/identity-spike/corpus/flows.ts
// Rule 3's two flows, walked as CORPUS.md's 2026-11-09 amendment says a flow is walked.
//
// A flow is a fixed list of steps. Each one is a real interaction (CDP `Input`, never a
// synthetic event), then the condition that defines the state it reaches. The walk starts from a
// real load of the flow's first screen and after that moves only by its own steps. A state that is
// not reached stops the walk there: that state and every later one are reported as not reached,
// and the step is never retried with a different interaction.
//
// Which elements are judged is manifest.ts's flow table, held to CORPUS.md. This file only says
// how to reach each state the table names, and `flows.test.ts` holds the two together.
import { ACCOUNT_REGISTER, button, DRIVERS, FIRST_ON_BUDGET_ACCOUNT, SIGNED_IN } from './apps.ts';
import type { Page, Settle } from './browser.ts';
import type { AppId } from './manifest.ts';
import type { ScreenCapture } from './rebuild.ts';

export interface FlowStep {
  /** What the step does, in the words a stopped walk is reported with. */
  does: string;
  act: (page: Page, base: string) => Promise<void>;
  /**
   * In-page expression, true once the step's state shows what defines it (CORPUS.md: "the
   * suggestion list or the Status menu is open, the new row is in the register…"). Checked after
   * the page settles. False stops the walk.
   */
  reached: string;
  /** The CORPUS.md state this step reaches and captures, named as the flow's table names it. */
  captures?: string;
  /**
   * CORPUS.md: "Where a row says 'first', the capture records the visible label of the item it
   * got." Row id → in-page expression for that item. Recorded once the state is reached.
   */
  firsts?: Readonly<Record<string, string>>;
}

export interface FlowDriver {
  steps: readonly FlowStep[];
}

export interface StateRecord extends ScreenCapture {
  location?: string;
  settle?: Settle;
}

export interface FlowRecord {
  /** Every state the flow's table names, in order: captured, or reported as not reached. */
  states: StateRecord[];
  /** Row id → the visible label of the "first" item the walk got, or null if there was none. */
  firsts: Record<string, string | null>;
  /** Set when the walk stopped before its last step. */
  stopped?: { step: string; error: string };
}

/** An element's visible text, whitespace collapsed, or null when there is no element. */
const text = (element: string) => `(${element})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`;

/**
 * The name of an item that renders a name and then a figure: its first non-blank text node.
 * Actual's suggestions and sidebar accounts carry a balance after the name, and the name is
 * what a user would call the item. Not for anything whose label spans several text nodes.
 */
const nameOf = (element: string) => `(() => {
  const element = ${element};
  if (!element) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent.trim();
    if (value) return value;
  }
  return null;
})()`;

/** Real input, then nothing else: the step's state is judged by `reached`, after settling. */
const click = (element: string) => async (page: Page) => page.click(element);

// --- Actual: add a transaction to an account -------------------------------------------------

const NEW_ROW = `document.querySelector('[data-testid="new-transaction"]')`;
const newRowCell = (cell: string) => `${NEW_ROW}?.querySelector('[data-testid="${cell}"]')`;
const SUGGESTIONS = `document.querySelector('[data-testid="autocomplete"]')`;
/**
 * The first suggestion that is a payee or a category. The category list opens with "Split
 * Transaction" above every category: an action on the transaction, not a category, and A18 is
 * "the first suggested category". Group headings ("Suggested Payees") are not items either.
 */
const FIRST_PAYEE = `${SUGGESTIONS}?.querySelector('[data-testid$="-payee-item"]')`;
const FIRST_CATEGORY = `${SUGGESTIONS}?.querySelector('[data-testid$="-category-item"]')`;
/**
 * A new-row field holding a value, edited or not: an open field is an input, a closed one is
 * text. An empty Category reads "Categorize", its placeholder.
 */
const filled = (cell: string) => `(() => {
  const cell = ${newRowCell(cell)};
  const value = (cell?.querySelector('input')?.value ?? cell?.textContent ?? '').trim();
  return value !== '' && value !== 'Categorize';
})()`;

/** CORPUS.md's fixed input: the payment is 12.34. */
export const ACTUAL_PAYMENT = '12.34';

const actual: FlowDriver = {
  steps: [
    {
      does: 'load /budget',
      act: async (page, base) => { await DRIVERS.actual.open(page, base, '/budget'); },
      reached: `location.pathname === '/budget' && Boolean(${FIRST_ON_BUDGET_ACCOUNT})`,
      captures: 'sidebar',
      firsts: { A1: nameOf(FIRST_ON_BUDGET_ACCOUNT) },
    },
    {
      does: 'click the first on-budget account',
      act: click(FIRST_ON_BUDGET_ACCOUNT),
      reached: `${ACCOUNT_REGISTER} && Boolean(${button('Add New')})`,
      captures: 'register',
    },
    {
      does: 'click "Add New"',
      act: click(button('Add New')),
      reached: `Boolean(${NEW_ROW})`,
      captures: 'new transaction row',
    },
    {
      does: "click the new row's Payee field",
      act: click(newRowCell('payee')),
      reached: `Boolean(${FIRST_PAYEE})`,
      captures: 'payee suggestions open',
      firsts: { A17: nameOf(FIRST_PAYEE) },
    },
    {
      does: 'click the first suggested payee',
      act: click(FIRST_PAYEE),
      reached: `!${SUGGESTIONS} && ${filled('payee')}`,
    },
    {
      does: "click the new row's Category field",
      act: click(newRowCell('category')),
      reached: `Boolean(${FIRST_CATEGORY})`,
      captures: 'category suggestions open',
      firsts: { A18: nameOf(FIRST_CATEGORY) },
    },
    {
      does: 'click the first suggested category',
      act: click(FIRST_CATEGORY),
      reached: `!${SUGGESTIONS} && ${filled('category')}`,
    },
    {
      does: "click the new row's Payment field",
      act: click(newRowCell('debit')),
      reached: `Boolean(${newRowCell('debit')}?.contains(document.activeElement)) && document.activeElement.tagName === 'INPUT'`,
    },
    {
      // The field holds "0.00" and does not select it on focus, so typing alone would append.
      does: `select the Payment field's text and type ${ACTUAL_PAYMENT}`,
      act: async (page) => {
        await page.selectAll();
        await page.type(ACTUAL_PAYMENT);
      },
      reached: `document.activeElement.value === ${JSON.stringify(ACTUAL_PAYMENT)}`,
    },
    {
      does: 'click "Add"',
      act: click(newRowCell('add-button')),
      // The new transaction, in the register itself rather than in the entry row.
      reached: `[...document.querySelectorAll('[data-testid="row"]')].some((row) =>
        !${NEW_ROW}?.contains(row) && row.querySelector('[data-testid="debit"]')?.textContent.trim() === ${JSON.stringify(ACTUAL_PAYMENT)})`,
      captures: 'after Add',
    },
    {
      does: 'click "Budget" in the sidebar',
      act: click(`document.querySelector('a[href="/budget"]')`),
      reached: `location.pathname === '/budget'`,
    },
  ],
};

// --- react-admin demo: mark a pending order delivered ----------------------------------------

const ORDERS_LINK = `document.querySelector('.MuiDrawer-root a[href="#/orders"]')`;
const tab = (name: string) =>
  `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim().startsWith(${JSON.stringify(`${name} (`)}))`;
const tabSelected = (name: string) => `${tab(name)}?.getAttribute('aria-selected') === 'true'`;
const FIRST_ROW = `document.querySelector('tbody tr.RaDataTable-row')`;
const ORDER_ROUTE = `/^#\\/orders\\/\\d+$/.test(location.hash)`;
const STATUS = `[...document.querySelectorAll('[role="combobox"]')].find((c) =>
  (c.getAttribute('aria-labelledby') ?? '').split(' ').some((id) => document.getElementById(id)?.textContent.trim() === 'Status'))`;
const option = (name: string) =>
  `[...document.querySelectorAll('[role="listbox"] [role="option"]')].find((o) => o.textContent.trim() === ${JSON.stringify(name)})`;

const reactAdmin: FlowDriver = {
  steps: [
    {
      does: 'load /',
      act: async (page, base) => { await DRIVERS['react-admin'].open(page, base, '/'); },
      reached: `${SIGNED_IN} && Boolean(${ORDERS_LINK})`,
      captures: 'sidebar',
    },
    {
      // The Sales menu is open by default, so its Orders link is the click. Clicking "Sales"
      // first would close it.
      does: 'click "Orders"',
      act: click(ORDERS_LINK),
      reached: `location.hash === '#/orders' && Boolean(${FIRST_ROW})`,
      captures: '/orders',
    },
    {
      // The table names this state apart from /orders, so it is reached by its own interaction:
      // the tab the flow opens the order from. It is the default tab, so the click may change
      // nothing, which is itself what the capture records.
      does: 'click the "ordered" tab',
      act: click(tab('ordered')),
      reached: `${tabSelected('ordered')} && Boolean(${FIRST_ROW})`,
      captures: '/orders, ordered tab',
      firsts: {
        R10: text(`${FIRST_ROW}?.querySelector('.column-reference')`),
        R11: text(`${FIRST_ROW}?.querySelector('a[href^="#/customers/"]')`),
      },
    },
    {
      // On its date cell: the row's centre is its customer link (R11), which opens the customer.
      does: 'click the first row',
      act: click(`${FIRST_ROW}?.querySelector('.column-date')`),
      reached: `${ORDER_ROUTE} && Boolean(${STATUS})`,
      captures: '/orders/:id',
      firsts: { R18: text(`document.querySelector('main a[href^="#/products/"]')`) },
    },
    {
      does: 'click "Status"',
      act: click(STATUS),
      reached: `Boolean(${option('delivered')})`,
      captures: 'Status menu open',
    },
    {
      does: 'click "delivered"',
      act: click(option('delivered')),
      reached: `!document.querySelector('[role="listbox"]') && ${STATUS}?.textContent.trim() === 'delivered'`,
    },
    {
      does: 'click "Save"',
      act: click(`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Save')`),
      reached: `location.hash === '#/orders'`,
    },
    {
      does: 'click the "delivered" tab',
      act: click(tab('delivered')),
      reached: tabSelected('delivered'),
    },
  ],
};

export const FLOWS: Readonly<Record<AppId, FlowDriver>> = { actual, 'react-admin': reactAdmin };

/**
 * Walk a flow once. `capture` records the whole document as it stands, like a screen.
 * `states` is the flow table's state list, so a state the walk never got to is still reported.
 */
export async function walkFlow(
  page: Page,
  base: string,
  flow: FlowDriver,
  states: readonly string[],
  capture: (state: string) => Promise<StateRecord>,
): Promise<FlowRecord> {
  const record: FlowRecord = { states: [], firsts: {} };
  for (const step of flow.steps) {
    let settle: Settle;
    try {
      await step.act(page, base);
      settle = await page.settle();
      if (!(await page.evaluate<boolean>(`Boolean(${step.reached})`))) {
        throw new Error(`not reached${settle.settled ? '' : ' (and the page did not settle)'}`);
      }
    } catch (error) {
      record.stopped = { step: step.does, error: error instanceof Error ? error.message : String(error) };
      break;
    }
    for (const [row, expression] of Object.entries(step.firsts ?? {})) {
      record.firsts[row] = await page.evaluate<string | null>(expression).catch(() => null);
    }
    if (step.captures !== undefined) record.states.push({ ...(await capture(step.captures)), settle });
  }
  const reached = new Set(record.states.map((state) => state.screen));
  for (const state of states) {
    if (reached.has(state)) continue;
    const error = record.stopped === undefined
      ? 'not reached: no step captures it'
      : `not reached: the walk stopped at "${record.stopped.step}"`;
    record.states.push({ screen: state, captured: false, error, elements: [] });
  }
  return record;
}
