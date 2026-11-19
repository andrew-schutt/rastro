/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/src/site-referee.test.ts
 * The site referee, against real React renders of fixtures compiled with the site plugin, as the
 * corpus builds are. Files under `vendor/` are compiled without it, like node_modules.
 */
import { createRequire } from 'node:module';
import { transformSync, type PluginItem } from '@babel/core';
import * as React from 'react';
import { act } from 'react';
import * as compilerRuntime from 'react/compiler-runtime';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { groupSequences, recordSequences } from './site-referee.ts';
import rastroCorpusSites from './site-plugin.ts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const require = createRequire(import.meta.url);
const jsxPlugin = require('@babel/plugin-transform-react-jsx') as PluginItem;
const commonjsPlugin = require('@babel/plugin-transform-modules-commonjs') as PluginItem;
const reactCompiler = require('babel-plugin-react-compiler') as PluginItem;

interface Options {
  stamp?: boolean;
  reactCompiler?: boolean;
}

/** Compile and load one module. `vendor` is what `./vendor.js` resolves to, compiled unstamped. */
function load(source: string, vendor = '', options: Options = {}): Record<string, unknown> {
  const compile = (code: string, filename: string, stamp: boolean): string =>
    transformSync(code, {
      filename,
      cwd: '/app',
      babelrc: false,
      configFile: false,
      plugins: [
        ...(stamp ? [[rastroCorpusSites, { root: '/app' }] as PluginItem] : []),
        ...(options.reactCompiler === true ? [[reactCompiler, { target: '19' }] as PluginItem] : []),
        [jsxPlugin, { runtime: 'automatic' }],
        commonjsPlugin,
      ],
    })?.code ?? '';
  const run = (code: string, externals: Record<string, unknown>): Record<string, unknown> => {
    const module = { exports: {} as Record<string, unknown> };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the loader's whole job
    const evaluate = new Function('require', 'module', 'exports', code) as (
      require: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    evaluate((specifier) => externals[specifier], module, module.exports);
    return module.exports;
  };
  const externals = { react: React, 'react/jsx-runtime': jsxRuntime, 'react/compiler-runtime': compilerRuntime };
  const vendorModule = run(compile(vendor, '/node_modules/vendor/index.jsx', false), externals);
  return run(compile(source, '/app/src/App.jsx', options.stamp ?? true), { ...externals, './vendor.js': vendorModule });
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

/** Render `App` from `source` and group every element matching `selector`, as one collision. */
function judge(source: string, selector = 'button', vendor = '', options: Options = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const App = load(source, vendor, options).App as React.ComponentType;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(React.createElement(App)));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const elements = [...container.querySelectorAll(selector)];
  const recorded = recordSequences(elements);
  return { container, elements, recorded, ...groupSequences(recorded.sequences) };
}

const ROWS = `const ROWS = ['a', 'b', 'c'];`;

describe('the site referee', () => {
  it('collapses the rows of one list into one control', () => {
    const { distinctElements, elements } = judge(`${ROWS}
      export function App() { return <ul>{ROWS.map((r) => <li key={r}><button /></li>)}</ul>; }`);
    expect(elements).toHaveLength(3);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 1 });
  });

  // The key referee's error (run-2-diagnostic.md): a cell's nearest keyed item is in its own
  // row's list of cells, so every row looked like a different list.
  it('counts a grid of rows × keyed columns as one control per column', () => {
    const { distinctElements, groups, elements } = judge(`${ROWS}
      function Notes() { return <button />; }
      function Edit() { return <button />; }
      const COLUMNS = [{ name: 'notes', Cell: Notes }, { name: 'edit', Cell: Edit }];
      export function App() {
        return <table><tbody>{ROWS.map((r) =>
          <tr key={r}>{COLUMNS.map(({ name, Cell }) => <td key={name}><Cell /></td>)}</tr>)}</tbody></table>;
      }`);
    expect(elements).toHaveLength(6);
    expect(distinctElements).toEqual({ atLeast: 2, atMost: 2 });
    // Each group is one column: every other element in document order.
    expect(groups.map((group) => group.map((i) => i % 2))).toEqual([[0, 0, 0], [1, 1, 1]]);
  });

  it('counts the same JSX in a list nested per row as one control', () => {
    const { distinctElements } = judge(`${ROWS}
      export function App() {
        return <div>{ROWS.map((r) => <section key={r}>{[1, 2].map((n) => <p key={n}><button>View notes</button></p>)}</section>)}</div>;
      }`);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 1 });
  });

  it('keeps two controls of one row apart however many rows there are', () => {
    const { distinctElements } = judge(`${ROWS}
      export function App() { return <ul>{ROWS.map((r) => <li key={r}><button /><button /></li>)}</ul>; }`);
    expect(distinctElements).toEqual({ atLeast: 2, atMost: 2 });
  });

  // The key referee could only give 1 to 2 here: a key does not prove a loop. A site does.
  it('tells static keyed siblings apart, where a key cannot', () => {
    const { distinctElements } = judge(`
      export function App() { return <div><section key="left"><button /></section><section key="right"><button /></section></div>; }`);
    expect(distinctElements).toEqual({ atLeast: 2, atMost: 2 });
  });

  it('tells one component used at two call sites apart', () => {
    const { distinctElements } = judge(`
      function Close() { return <button />; }
      export function App() { return <div><header><Close /></header><footer><Close /></footer></div>; }`);
    expect(distinctElements).toEqual({ atLeast: 2, atMost: 2 });
  });

  // The documented limit: one JSX site rendering different controls from data.
  it('counts one site rendering several controls from data as one control', () => {
    const { distinctElements } = judge(`
      export function App() { return <div>{['undo', 'redo'].map((a) => <button key={a} />)}</div>; }`);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 1 });
  });

  // Unstamped code is the range: nothing says whether a library's children are a loop.
  it('gives a range across a loop in unstamped code', () => {
    const vendor = `export function VList({ count, children }) {
      return <ul>{Array.from({ length: count }, (_, i) => <li key={i}>{children}</li>)}</ul>;
    }`;
    const { distinctElements } = judge(`import { VList } from './vendor.js';
      export function App() { return <VList count={3}><button /></VList>; }`, 'button', vendor);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 3 });
  });

  // A stamp handed into unstamped code by a spread is not that code's site. Counted as its
  // site, it would hide the library loop below it from `atMost`.
  it('discounts a stamp a component spreads into unstamped code', () => {
    const vendor = `function Item(props) { return <button {...props} />; }
      export function VList({ count, ...rest }) {
        return <ul>{Array.from({ length: count }, (_, i) => <Item key={i} {...rest} />)}</ul>;
      }`;
    const { distinctElements, recorded } = judge(`import { VList } from './vendor.js';
      export function App() { return <VList count={3} />; }`, 'button', vendor);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 3 });
    expect(recorded.sequences[0]?.stamped).toBe(1);
  });

  it('has no evidence for an element with no stamped fiber, and does not merge it', () => {
    const { distinctElements, unrecorded } = judge(`${ROWS}
      export function App() { return <ul>{ROWS.map((r) => <li key={r}><button /></li>)}</ul>; }`, 'button', '', { stamp: false });
    expect(unrecorded).toBe(3);
    expect(distinctElements).toEqual({ atLeast: 3, atMost: 3 });
  });

  it('never writes the stamp into the DOM', () => {
    const { container } = judge(`export function App() { return <div><button {...{ id: 'x' }} /></div>; }`);
    expect(container.innerHTML).toBe('<div><button id="x"></button></div>');
  });

  it('survives the React Compiler, which runs after it in Actual', () => {
    const { distinctElements } = judge(`${ROWS}
      export function App() { return <ul>{ROWS.map((r) => <li key={r}><button /><button /></li>)}</ul>; }`, 'button', '', { reactCompiler: true });
    expect(distinctElements).toEqual({ atLeast: 2, atMost: 2 });
  });

  it('records plain data, with the sites a person can read', () => {
    const { recorded } = judge(`export function App() { return <div><button /></div>; }`);
    const copy = JSON.parse(JSON.stringify(recorded)) as typeof recorded;
    expect(groupSequences(copy.sequences).distinctElements).toEqual({ atLeast: 1, atMost: 1 });
    expect(copy.sites[0]?.at(-1)).toMatch(/^src\/App\.jsx:1:\d+$/);
  });
});
