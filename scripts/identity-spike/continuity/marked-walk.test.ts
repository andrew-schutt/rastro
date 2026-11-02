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
import { getFiber, markedComponentChain, type ComponentWalk } from 'rastro-core';
import { describe, expect, it } from 'vitest';
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

function walk(source: string, reactCompiler: boolean): ComponentWalk {
  const App = loadApp(new Map([['src/App.tsx', source]]), 'marked-fiber', { reactCompiler });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(App)));
    return markedComponentChain(getFiber(container.querySelector('button')!));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

describe.each([false, true])('marks through a real build, React Compiler %s', (reactCompiler) => {
  it.each(PATTERNS)('reads $name', ({ source, expected }) => {
    expect(walk(source, reactCompiler)).toEqual({ componentChain: expected, sourceFile: 'src/App.tsx' });
  });
});

// Without this, the compiler rows above could pass because the compiler quietly did nothing.
it('really runs the React Compiler on every pattern', () => {
  for (const { name, source } of PATTERNS) {
    expect(compile('src/App.tsx', source, 'marked-fiber', { reactCompiler: true }), name).toContain('react/compiler-runtime');
  }
});
