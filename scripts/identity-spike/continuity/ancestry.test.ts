/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/continuity/ancestry.test.ts
 * Rule 2's ancestry end to end: the mark plugin's real marks, read by `markedAncestry`, off
 * fibers rendered by real React, with and without the real React Compiler.
 *
 * The mark plugin's tests read transformed source. They do not show that what it writes is
 * where the ancestry looks, for every authoring pattern the build plugin names, once a compiler
 * has rewritten the components. This does.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { markedAncestry } from '../src/ancestry.js';
import type { ComponentMark } from '../src/fiber.ts';
import { compile, loadApp } from './harness.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Each pattern renders exactly one <button>, whose marked ancestry is `expected`. */
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
  const App = loadApp(new Map([['src/App.tsx', source]]), 'attribute', { reactCompiler, marks: true });
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

const names = (ancestry: ComponentMark[]) => ancestry.map((mark) => mark.name);

describe.each([false, true])('marks through a real build, React Compiler %s', (reactCompiler) => {
  it.each(PATTERNS)('reads $name, with files', ({ source, expected }) => {
    const ancestry = render(source, reactCompiler, markedAncestry);
    expect(names(ancestry)).toEqual(expected);
    expect(ancestry.every((mark) => mark.file === 'src/App.tsx')).toBe(true);
  });
});

// What the ancestry exists for: what the fingerprint's chain drops, rule 2 still needs.
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
    expect(names(ancestry)).toEqual(['App', 'ThemeProvider', 'A', 'B', 'C', 'D', 'Save']);
    expect(ancestry.every((mark) => mark.file === 'src/App.tsx')).toBe(true);
  });
});

// Without this, the compiler rows above could pass because the compiler quietly did nothing.
it('really runs the React Compiler on every pattern', () => {
  for (const { name, source } of PATTERNS) {
    expect(compile('src/App.tsx', source, 'attribute', { reactCompiler: true, marks: true }), name).toContain('react/compiler-runtime');
  }
});
