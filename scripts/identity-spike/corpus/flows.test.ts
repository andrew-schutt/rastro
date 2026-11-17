// scripts/identity-spike/corpus/flows.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Page } from './browser.ts';
import { FLOWS, walkFlow, type FlowDriver, type StateRecord } from './flows.ts';
import { CORPUS, flowStates, type AppId } from './manifest.ts';

describe('the flow drivers against manifest.ts', () => {
  for (const id of Object.keys(CORPUS) as AppId[]) {
    const { flow } = CORPUS[id];
    const steps = FLOWS[id].steps;

    it(`${id}: captures every state the table names, once each, in the table's order`, () => {
      expect(steps.flatMap((step) => (step.captures === undefined ? [] : [step.captures]))).toEqual(flowStates(flow));
    });

    it(`${id}: records a label for exactly the rows that say "first"`, () => {
      const firsts = steps.flatMap((step) => Object.keys(step.firsts ?? {}));
      expect(firsts).toEqual(flow.rows.filter((row) => /\bfirst\b/.test(row.element)).map((row) => row.id));
    });

    it(`${id}: every in-page expression runs, and on an empty page finds nothing`, () => {
      document.body.innerHTML = '';
      // Indirect eval: the expressions are written for a page's global scope, as CDP runs them.
      const run = (expression: string): unknown => (0, eval)(expression);
      for (const step of steps) {
        expect(run(`Boolean(${step.reached})`), step.does).toBe(false);
        for (const expression of Object.values(step.firsts ?? {})) expect(run(expression), step.does).toBeNull();
      }
    });
  }
});

/** A page whose `reached` checks answer from `reachable`, and whose clicks are logged. */
function fakePage(reachable: (expression: string) => boolean, log: string[]): Page {
  const fail = () => Promise.reject(new Error('not in this fake'));
  return {
    evaluate: <T,>(expression: string) =>
      Promise.resolve((expression.startsWith('Boolean(') ? reachable(expression) : `label of ${expression}`) as T),
    settle: () => Promise.resolve({ settled: true, ms: 0 }),
    click: (expression) => {
      log.push(`click ${expression}`);
      return Promise.resolve();
    },
    goto: fail,
    waitFor: fail,
    type: fail,
    selectAll: fail,
    errors: () => [],
    screenshot: fail,
    workers: fail,
    close: fail,
  };
}

const FLOW: FlowDriver = {
  steps: [
    { does: 'open', act: (page) => page.click('open'), reached: 'one', captures: 'first state', firsts: { X1: 'x1' } },
    { does: 'pick', act: (page) => page.click('pick'), reached: 'two' },
    { does: 'save', act: (page) => page.click('save'), reached: 'three', captures: 'second state' },
    { does: 'leave', act: (page) => page.click('leave'), reached: 'four', captures: 'third state' },
  ],
};
const STATES = ['first state', 'second state', 'third state'];

async function walk(reachable: (expression: string) => boolean, flow = FLOW) {
  const log: string[] = [];
  const captured: string[] = [];
  const capture = (state: string): Promise<StateRecord> => {
    captured.push(state);
    return Promise.resolve({ screen: state, captured: true, elements: [] });
  };
  const record = await walkFlow(fakePage(reachable, log), 'http://app', flow, STATES, capture);
  return { record, log, captured };
}

describe('walkFlow', () => {
  it('walks every step, captures each named state, and records the firsts', async () => {
    const { record, log, captured } = await walk(() => true);

    expect(log).toEqual(['click open', 'click pick', 'click save', 'click leave']);
    expect(captured).toEqual(STATES);
    expect(record.states.map((s) => [s.screen, s.captured])).toEqual(STATES.map((s) => [s, true]));
    expect(record.firsts).toEqual({ X1: 'label of x1' });
    expect(record.stopped).toBeUndefined();
  });

  it('stops at a state that is not reached, never retries, and reports every later state', async () => {
    const { record, log, captured } = await walk((expression) => !expression.includes('three'));

    expect(log).toEqual(['click open', 'click pick', 'click save']);
    expect(captured).toEqual(['first state']);
    expect(record.stopped).toEqual({ step: 'save', error: 'not reached' });
    expect(record.states.map((s) => [s.screen, s.captured, s.error])).toEqual([
      ['first state', true, undefined],
      ['second state', false, 'not reached: the walk stopped at "save"'],
      ['third state', false, 'not reached: the walk stopped at "save"'],
    ]);
  });

  it('stops when an interaction fails, and keeps its error', async () => {
    const flow: FlowDriver = {
      steps: [FLOW.steps[0]!, { does: 'pick', act: () => Promise.reject(new Error('nothing on screen')), reached: 'two' }],
    };
    const { record } = await walk(() => true, flow);

    expect(record.stopped).toEqual({ step: 'pick', error: 'nothing on screen' });
    expect(record.states.filter((s) => !s.captured).map((s) => s.screen)).toEqual(['second state', 'third state']);
  });

  it('reports a state no step captures, rather than dropping it', async () => {
    const flow: FlowDriver = { steps: FLOW.steps.slice(0, 3) };
    const { record } = await walk(() => true, flow);

    expect(record.stopped).toBeUndefined();
    expect(record.states.at(-1)).toMatchObject({ screen: 'third state', captured: false, error: 'not reached: no step captures it' });
  });
});
