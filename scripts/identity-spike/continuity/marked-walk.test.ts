/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/continuity/marked-walk.test.ts
 * Strategy 6 end to end: babel-plugin-rastro's real marks, read by rastro-core's real walk,
 * off fibers rendered by real React, with and without the real React Compiler.
 *
 * The core tests attach marks by hand and the plugin tests read transformed source. Neither
 * shows that what the plugin writes is where the walk looks, for every authoring pattern the
 * plugin names, once a compiler has rewritten the components. This does.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { getFiber, markedComponentChain, MAX_CHAIN_DEPTH, NOISE, type ComponentMark, type ComponentWalk } from 'rastro-core';
import { describe, expect, it } from 'vitest';
import { markedAncestry } from '../src/ancestry.js';
import { compile, loadApp } from './harness.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Each pattern renders exactly one <button>, whose marked chain is `expected`. */
const PATTERNS: { name: string; source: string; expected: string[] }[] = [
  {
    name: 'function declarations',
    source: `function Save() { return <button>Save</button>; }\nexport function App() { return <main><Save /></main>; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a const arrow',
    source: `const Save = () => <button>Save</button>;\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a simple memo of an arrow',
    source: `import { memo } from 'react';\nconst Save = memo(() => <button>Save</button>);\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a memo with a comparator',
    source: `import { memo } from 'react';\nconst Save = memo(() => <button>Save</button>, () => false);\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a forwardRef',
    source: `import { forwardRef } from 'react';\nconst Save = forwardRef((props, ref) => <button ref={ref}>Save</button>);\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'memo(forwardRef(...))',
    source: `import { forwardRef, memo } from 'react';\nconst Save = memo(forwardRef((props, ref) => <button ref={ref}>Save</button>));\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a class component',
    source: `import { Component } from 'react';\nclass Save extends Component { render() { return <button>Save</button>; } }\nexport function App() { return <Save />; }`,
    expected: ['App', 'Save'],
  },
  {
    name: 'a composer that writes no host element',
    source: `function Save() { return <button>Save</button>; }\nfunction Row() { return <Save />; }\nexport function App() { return <div><Row /></div>; }`,
    expected: ['App', 'Row', 'Save'],
  },
  {
    name: 'a list row the compiler hoists out of its component',
    source: `function List({ items }) { return <ul>{items.map((i) => <li key={i}><button>{i}</button></li>)}</ul>; }\nexport function App() { return <List items={['a']} />; }`,
    expected: ['App', 'List'],
  },
];

function render<T>(source: string, reactCompiler: boolean, read: (button: Element) => T): T {
  const App = loadApp(new Map([['src/App.tsx', source]]), 'marked-fiber', { reactCompiler });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(App)));
    return read(container.querySelector('button')!);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

const walk = (source: string, reactCompiler: boolean): ComponentWalk =>
  render(source, reactCompiler, (button) => markedComponentChain(getFiber(button)));

describe.each([false, true])('marks through a real build, React Compiler %s', (reactCompiler) => {
  it.each(PATTERNS)('reads $name', ({ source, expected }) => {
    expect(walk(source, reactCompiler)).toEqual({ componentChain: expected, sourceFile: 'src/App.tsx' });
  });

  // src/ancestry.ts duplicates core's private mark reader for rule 2. Capped and filtered as
  // core does, it must be core's walk exactly, or rule 2 would judge "touched" by other marks.
  it.each(PATTERNS)('the uncapped ancestry agrees with core on $name', ({ source }) => {
    const ancestry = render(source, reactCompiler, markedAncestry);
    const counted = ancestry.filter((mark) => !NOISE.test(mark.name)).slice(-MAX_CHAIN_DEPTH);
    expect({ componentChain: counted.map((mark) => mark.name), sourceFile: counted.at(-1)?.file }).toEqual(
      walk(source, reactCompiler),
    );
  });
});

// What the ancestry exists for: what the fingerprint walks drop, rule 2 still needs.
describe('the uncapped ancestry', () => {
  const DEEP = `import { createContext } from 'react';
const Theme = createContext('light');
function ThemeProvider({ children }) { return <Theme.Provider value="dark">{children}</Theme.Provider>; }
function A({ children }) { return <section>{children}</section>; }
function B({ children }) { return <div>{children}</div>; }
function C({ children }) { return <div>{children}</div>; }
function D({ children }) { return <div>{children}</div>; }
function Save() { return <button>Save</button>; }
export function App() { return <ThemeProvider><A><B><C><D><Save /></D></C></B></A></ThemeProvider>; }`;

  it('keeps every first-party component, past the depth cap and through NOISE, with files', () => {
    const ancestry = render(DEEP, false, markedAncestry);
    expect(ancestry.map((mark: ComponentMark) => mark.name)).toEqual(['App', 'ThemeProvider', 'A', 'B', 'C', 'D', 'Save']);
    expect(ancestry.every((mark) => mark.file === 'src/App.tsx')).toBe(true);
    expect(walk(DEEP, false).componentChain).toEqual(['B', 'C', 'D', 'Save']);
  });
});

// Without this, the compiler rows above could pass because the compiler quietly did nothing.
it('really runs the React Compiler on every pattern', () => {
  for (const { name, source } of PATTERNS) {
    expect(compile('src/App.tsx', source, 'marked-fiber', { reactCompiler: true }), name).toContain('react/compiler-runtime');
  }
});
