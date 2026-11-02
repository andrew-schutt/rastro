/**
 * @vitest-environment jsdom
 *
 * packages/react/src/fingerprint.dom.test.tsx
 * The fiber walk (§4.2.1 steps 1–2), against real React renders.
 *
 * §4.2.1 calls the before/after-refactor suite below "the most valuable test file in the
 * repo", and it is the reason: it is the false-split regression guard. `fingerprint` itself
 * lives in `rastro-core`, which stays React-free — the React-specific half of its behaviour
 * is tested here, where React already is.
 */
import { Component, StrictMode, forwardRef, memo, type ReactElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MARK_PROPERTY,
  UNKNOWN_CHAIN,
  componentChain,
  describeElement,
  fingerprint,
  getFiber,
  markedComponentChain,
  markedFiberWalk,
} from 'rastro-core';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Render, then fingerprint the first element matching `selector`. */
function print(ui: ReactElement, selector = 'button'): string {
  act(() => root.render(ui));
  const element = container.querySelector(selector);
  if (element === null) throw new Error(`nothing matched ${selector}`);
  return fingerprint(element);
}

// A small, realistic tree: the example from §4.2.1 and the conventions.
function SaveButton({
  label = 'Save Profile',
  testId,
}: { label?: string; testId?: string }): ReactElement {
  return <button data-testid={testId}>{label}</button>;
}
function ProfileForm({ children }: { children?: ReactNode }): ReactElement {
  return <form>{children ?? <SaveButton />}</form>;
}
function Settings({ children }: { children?: ReactNode }): ReactElement {
  return <div className="settings">{children ?? <ProfileForm />}</div>;
}

const EXPECTED = 'Settings>ProfileForm>SaveButton|button|"Save Profile"';

describe('the fiber walk', () => {
  it('finds a fiber on a React-rendered node', () => {
    act(() => root.render(<Settings />));

    expect(getFiber(container.querySelector('button')!)).not.toBeNull();
  });

  it('derives the §4.2.1 example fingerprint end to end', () => {
    expect(print(<Settings />)).toBe(EXPECTED);
  });

  it('orders the chain outermost → innermost', () => {
    act(() => root.render(<Settings />));
    const chain = componentChain(getFiber(container.querySelector('button')!));

    expect(chain).toEqual(['Settings', 'ProfileForm', 'SaveButton']);
  });

  it('unwraps forwardRef to the real component name', () => {
    const Fancy = forwardRef<HTMLButtonElement>(function FancyButton(_props, ref) {
      return <button ref={ref}>Save Profile</button>;
    });

    expect(print(<Fancy />)).toBe('FancyButton|button|"Save Profile"');
  });

  it('unwraps memo to the real component name', () => {
    const Memoized = memo(function MemoButton(): ReactElement {
      return <button>Save Profile</button>;
    });

    expect(print(<Memoized />)).toBe('MemoButton|button|"Save Profile"');
  });

  it('prefers displayName over the function name', () => {
    function Internal(): ReactElement {
      return <button>Save Profile</button>;
    }
    Internal.displayName = 'PublicName';

    expect(print(<Internal />)).toBe('PublicName|button|"Save Profile"');
  });

  it('caps the chain depth so a change high in the tree cannot rename a button', () => {
    function L1({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }
    function L2({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }
    function L3({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }
    function L4({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }
    function L5({ children }: { children: ReactNode }): ReactElement { return <>{children}</>; }

    act(() =>
      root.render(
        <L1><L2><L3><L4><L5><SaveButton /></L5></L4></L3></L2></L1>,
      ),
    );
    const chain = componentChain(getFiber(container.querySelector('button')!));

    // Only the four innermost survive: L1 is dropped, so restructuring above it is invisible.
    expect(chain).toEqual(['L3', 'L4', 'L5', 'SaveButton']);
  });

  it('degrades to `unknown` for a node React did not render', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="plain">Save Profile</button>');
    const plain = document.getElementById('plain')!;

    expect(fingerprint(plain)).toBe(`${UNKNOWN_CHAIN}|button|"Save Profile"`);
    plain.remove();
  });
});

/**
 * THE REGRESSION GUARD (§4.2.1).
 *
 * Each case is a "same element, small refactor" pair whose fingerprint MUST hold. A failure
 * here means the identity drifted, which silently splits one node into two in every flow,
 * funnel, and friction metric downstream.
 */
describe('stability across refactors', () => {
  it('survives an unrelated wrapper div being added around the element', () => {
    // Host elements are skipped, so an extra layout div changes nothing.
    expect(
      print(
        <Settings>
          <ProfileForm>
            <div className="new-layout-wrapper">
              <SaveButton />
            </div>
          </ProfileForm>
        </Settings>,
      ),
    ).toBe(EXPECTED);
  });

  it('survives a CSS class / styling change', () => {
    // Same component, restyled: displayName keeps the identity while the markup changes.
    function SettingsRestyled({ children }: { children?: ReactNode }): ReactElement {
      return <div className="settings settings--v2 tw-flex">{children}</div>;
    }
    SettingsRestyled.displayName = 'Settings';

    expect(print(<Settings><ProfileForm><SaveButton /></ProfileForm></Settings>)).toBe(EXPECTED);
    expect(
      print(<SettingsRestyled><ProfileForm><SaveButton /></ProfileForm></SettingsRestyled>),
    ).toBe(EXPECTED);
  });

  it('survives a sibling element being reordered', () => {
    // Position is deliberately NOT in the fingerprint (§4.2.1's tradeoff dial), so reordering
    // is invisible — which is the whole point.
    const before = print(
      <Settings>
        <ProfileForm>
          <SaveButton />
          <button>Cancel</button>
        </ProfileForm>
      </Settings>,
      'form > button',
    );
    const after = print(
      <Settings>
        <ProfileForm>
          <button>Cancel</button>
          <SaveButton />
        </ProfileForm>
      </Settings>,
      'form > button:last-of-type',
    );

    expect(before).toBe(EXPECTED);
    expect(after).toBe(EXPECTED);
  });

  it('survives a noise component appearing in the ancestry', () => {
    function ErrorBoundary({ children }: { children: ReactNode }): ReactElement {
      return <>{children}</>;
    }

    // NOISE filters `.*Boundary`, so wrapping in one does not rename the button.
    expect(
      print(
        <Settings>
          <ProfileForm>
            <ErrorBoundary>
              <SaveButton />
            </ErrorBoundary>
          </ProfileForm>
        </Settings>,
      ),
    ).toBe(EXPECTED);
  });

  it('survives StrictMode, which double-renders every component', () => {
    expect(print(<StrictMode><Settings /></StrictMode>)).toBe(EXPECTED);
  });

  it('survives the element gaining an unrelated attribute', () => {
    const before = print(<Settings><ProfileForm><SaveButton /></ProfileForm></Settings>);
    const after = print(
      <Settings><ProfileForm><SaveButton testId="save" /></ProfileForm></Settings>,
    );

    expect(after).toBe(before);
  });
});

/**
 * The known v1 failure modes, asserted so they stay visible decisions rather than surprises.
 * Each of these is a false SPLIT or a false MERGE, and each has a named fix in the plan.
 */
describe('known failure modes', () => {
  it('KNOWN SPLIT: a copy edit changes the fingerprint (i18n has the same effect)', () => {
    const before = print(<Settings><ProfileForm><SaveButton label="Save Profile" /></ProfileForm></Settings>);
    const after = print(<Settings><ProfileForm><SaveButton label="Save changes" /></ProfileForm></Settings>);

    expect(before).not.toBe(after);
    // §4.2.1 accepts this cost: dropping the name would merge the forty buttons saying "Save".
    expect(after).toBe('Settings>ProfileForm>SaveButton|button|"Save changes"');
  });

  it('KNOWN SPLIT: renaming the owning component changes the fingerprint', () => {
    function SubmitButton(): ReactElement {
      return <button>Save Profile</button>;
    }

    expect(print(<Settings><ProfileForm><SubmitButton /></ProfileForm></Settings>)).toBe(
      'Settings>ProfileForm>SubmitButton|button|"Save Profile"',
    );
  });

  it('KNOWN MERGE: minified single-letter names collapse distinct elements together', () => {
    // What a production build without the §4.3 plugin produces: fn.name becomes `t`, `a`,
    // `e` — and a minifier picks those per-module, so two unrelated components in different
    // modules genuinely end up sharing one.
    const Save = function e(): ReactElement { return <button>Go</button>; };
    const Delete = function e(): ReactElement { return <button>Go</button>; };

    // Two unrelated components, one fingerprint. This is the single most important
    // limitation of v1, and why §4.3's build-time plugin exists.
    expect(print(<Save />)).toBe('e|button|"Go"');
    expect(print(<Delete />)).toBe(print(<Save />));
  });
});

// §3.2 strategy 6, against real React. Marks are attached by hand here, exactly where
// babel-plugin-rastro's `markComponents` attaches them: on the binding the developer named.
// The plugin's own placement, and the two together through a real build, are tested in
// packages/babel-plugin and scripts/identity-spike.
describe('the marked fiber walk (§3.2 strategy 6)', () => {
  const mark = <T extends object>(component: T, name: string, file?: string): T => {
    (component as Record<string, unknown>)[MARK_PROPERTY] = file === undefined ? { name } : { name, file };
    return component;
  };
  const walk = (ui: ReactElement, selector = 'button'): ReturnType<typeof markedComponentChain> => {
    act(() => root.render(ui));
    return markedComponentChain(getFiber(container.querySelector(selector)!));
  };

  // Stand-ins for library code: named, so the unmarked fiber walk sees them, but unmarked.
  function LibTrigger({ children }: { children: ReactNode }): ReactElement {
    return <button>{children}</button>;
  }
  function LibPressable({ children }: { children: ReactNode }): ReactElement {
    return <LibTrigger>{children}</LibTrigger>;
  }
  function LibFocusRing({ children }: { children: ReactNode }): ReactElement {
    return <LibPressable>{children}</LibPressable>;
  }

  it('counts only marked components, so library internals take no slot', () => {
    const Page = mark(function Page(): ReactElement { return <main><Picker /></main>; }, 'Page', 'src/Page.tsx');
    const Picker = mark(function Picker(): ReactElement { return <LibFocusRing>Theme</LibFocusRing>; }, 'Picker', 'src/Picker.tsx');
    const App = mark(function App(): ReactElement { return <Page />; }, 'App', 'src/App.tsx');

    expect(walk(<App />)).toEqual({ componentChain: ['App', 'Page', 'Picker'], sourceFile: 'src/Picker.tsx' });
    // The unmarked walk, for contrast: the library fills the four slots.
    expect(componentChain(getFiber(container.querySelector('button')!))).toEqual([
      'Picker', 'LibFocusRing', 'LibPressable', 'LibTrigger',
    ]);
  });

  it('caps at MAX_CHAIN_DEPTH marked components, innermost kept, and takes the innermost file', () => {
    const D = mark(function D(): ReactElement { return <button>x</button>; }, 'D', 'src/D.tsx');
    const C = mark(function C(): ReactElement { return <D />; }, 'C', 'src/C.tsx');
    const B = mark(function B(): ReactElement { return <C />; }, 'B', 'src/B.tsx');
    const A = mark(function A(): ReactElement { return <B />; }, 'A', 'src/A.tsx');
    const Top = mark(function Top(): ReactElement { return <A />; }, 'Top', 'src/Top.tsx');

    expect(walk(<Top />)).toEqual({ componentChain: ['A', 'B', 'C', 'D'], sourceFile: 'src/D.tsx' });
  });

  it('applies NOISE to marked names', () => {
    const ThemeProvider = mark(function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
      return <div>{children}</div>;
    }, 'ThemeProvider');
    const Save = mark(function Save(): ReactElement { return <button>Save</button>; }, 'Save');

    expect(walk(<ThemeProvider><Save /></ThemeProvider>).componentChain).toEqual(['Save']);
  });

  it('carries no file when the mark has none, and nothing for an unmarked tree', () => {
    const Save = mark(function Save(): ReactElement { return <button>Save</button>; }, 'Save');
    expect(walk(<Save />)).toEqual({ componentChain: ['Save'] });
    expect(walk(<LibTrigger>x</LibTrigger>)).toEqual({ componentChain: [] });
    expect(markedComponentChain(null)).toEqual({ componentChain: [] });
  });

  // A memo without a comparator renders as one fiber whose `type` is the inner function and
  // whose `elementType` is the memo object. The mark is on the memo object.
  it('sees a mark on a simple memo, which only fiber.elementType reaches', () => {
    const Row = mark(memo(() => <button>Row</button>), 'Row', 'src/Row.tsx');
    expect(walk(<Row />).componentChain).toEqual(['Row']);
    // Strategy 3 sees nothing there: the inner arrow has no name.
    expect(componentChain(getFiber(container.querySelector('button')!))).toEqual([]);
  });

  it('sees a mark on a memo with a comparator, a forwardRef, and memo(forwardRef), once each', () => {
    const Compared = mark(memo(() => <button>a</button>, () => false), 'Compared');
    const Forwarded = mark(forwardRef<HTMLButtonElement>((_p, ref) => <button ref={ref}>b</button>), 'Forwarded');
    const Both = mark(memo(forwardRef<HTMLButtonElement>((_p, ref) => <button ref={ref}>c</button>)), 'Both');

    expect(walk(<Compared />).componentChain).toEqual(['Compared']);
    expect(walk(<Forwarded />).componentChain).toEqual(['Forwarded']);
    expect(walk(<Both />).componentChain).toEqual(['Both']);
  });

  // `memo(Inner)` where Inner is its own declaration: the binding the plugin marks is Inner.
  // With a comparator that is two fibers resolving to Inner, counted twice as strategy 3 does.
  it('unwraps memo to a separately marked component as componentChain does, duplicate included', () => {
    const Inner = mark(function Inner(): ReactElement { return <button>i</button>; }, 'Inner');
    const Simple = memo(Inner);
    const Compared = memo(Inner, () => false);

    expect(walk(<Simple />).componentChain).toEqual(['Inner']);
    expect(walk(<Compared />).componentChain).toEqual(['Inner', 'Inner']);
    expect(componentChain(getFiber(container.querySelector('button')!))).toEqual(['Inner', 'Inner']);
  });

  it('reads a class component’s own mark, never one inherited from its superclass', () => {
    class Base extends Component { override render(): ReactNode { return <button>base</button>; } }
    mark(Base, 'Base');
    class Derived extends Base {}

    expect(walk(<Base />).componentChain).toEqual(['Base']);
    expect(walk(<Derived />).componentChain).toEqual([]);
  });

  it('ignores a malformed mark rather than inventing a name', () => {
    const Bad = function Bad(): ReactElement { return <button>x</button>; };
    (Bad as unknown as Record<string, unknown>)[MARK_PROPERTY] = { name: '' };
    const Worse = function Worse(): ReactElement { return <Bad />; };
    (Worse as unknown as Record<string, unknown>)[MARK_PROPERTY] = 'Worse';

    expect(walk(<Worse />).componentChain).toEqual([]);
  });

  // The reason marks exist: names in a production build are mangled, the marks are not.
  it('reads marks, not names, so minified components keep their identity', () => {
    const t = mark(function t(): ReactElement { return <button>Save</button>; }, 'SaveButton');
    const e = mark(function e(): ReactElement { return <form>{h(t)}</form>; }, 'SettingsForm');
    const h = (c: () => ReactElement): ReactElement => { const C = c; return <C />; };

    expect(walk(h(e)).componentChain).toEqual(['SettingsForm', 'SaveButton']);
  });

  it('composes through describeElement exactly as the default walk does', () => {
    const Save = mark(function Save(): ReactElement { return <button>Save</button>; }, 'Save', 'src/Save.tsx');
    const App = mark(function App(): ReactElement { return <main><Save /></main>; }, 'App', 'src/App.tsx');
    act(() => root.render(<App />));
    const button = container.querySelector('button')!;

    expect(describeElement(button, undefined, markedFiberWalk)).toEqual({
      fingerprint: 'App>Save@src/Save.tsx|button|"Save"',
      componentChain: ['App', 'Save'],
      role: 'button',
      accessibleName: 'Save',
      sourceFile: 'src/Save.tsx',
    });
    // fingerprint() itself never reads marks: strategy 6 is a candidate, not the default.
    expect(fingerprint(button)).toBe('App>Save|button|"Save"');
  });

  it('still lets data-telemetry-id win', () => {
    const Save = mark(function Save(): ReactElement { return <button data-telemetry-id="save">Save</button>; }, 'Save');
    act(() => root.render(<Save />));

    expect(describeElement(container.querySelector('button')!, undefined, markedFiberWalk).fingerprint).toBe('id:save');
  });
});
