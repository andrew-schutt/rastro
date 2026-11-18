/**
 * @vitest-environment jsdom
 *
 * packages/react/src/fingerprint.dom.test.tsx
 * The fingerprint (§4.2.1) against real React renders.
 *
 * §4.2.1 calls the before/after-refactor suite below "the most valuable test file in the
 * repo", and it is the reason: it is the false-split regression guard. `fingerprint` itself
 * lives in `rastro-core`, which stays React-free, so its behaviour on rendered trees is tested
 * here, where React already is.
 *
 * Each component stamps its host elements by hand, exactly as `babel-plugin-rastro` would: the
 * owning component's name in `data-rastro-component`. The plugin's own placement, and the two
 * together through a real build, are tested in packages/babel-plugin and examples/stamp-fixture.
 */
import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPONENT_ATTRIBUTE, UNKNOWN_CHAIN, fingerprint } from 'rastro-core';

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

/** What the plugin adds to every host element a component writes. */
const by = (component: string) => ({ [COMPONENT_ATTRIBUTE]: component });

// A small, realistic tree: the example from §4.2.1 and the conventions.
function SaveButton({
  label = 'Save Profile',
  testId,
}: { label?: string; testId?: string }): ReactElement {
  return <button {...by('SaveButton')} data-testid={testId}>{label}</button>;
}
function ProfileForm({ children }: { children?: ReactNode }): ReactElement {
  return <form {...by('ProfileForm')}>{children ?? <SaveButton />}</form>;
}
function Settings({ children, className = 'settings' }: { children?: ReactNode; className?: string }): ReactElement {
  return <div {...by('Settings')} className={className}>{children ?? <ProfileForm />}</div>;
}

const EXPECTED = 'Settings>ProfileForm>SaveButton|button|"Save Profile"';

describe('the stamped chain, rendered', () => {
  it('derives the §4.2.1 example fingerprint end to end', () => {
    expect(print(<Settings />)).toBe(EXPECTED);
  });

  it('caps the chain depth so a change high in the tree cannot rename a button', () => {
    const Level = (name: string) =>
      function L({ children }: { children: ReactNode }): ReactElement {
        return <section {...by(name)}>{children}</section>;
      };
    const [L1, L2, L3, L4, L5] = ['L1', 'L2', 'L3', 'L4', 'L5'].map(Level) as [
      ReturnType<typeof Level>, ReturnType<typeof Level>, ReturnType<typeof Level>,
      ReturnType<typeof Level>, ReturnType<typeof Level>,
    ];

    // Only the four innermost survive: L1 and L2 drop, so restructuring above them is invisible.
    expect(print(<L1><L2><L3><L4><L5><SaveButton /></L5></L4></L3></L2></L1>)).toBe(
      'L3>L4>L5>SaveButton|button|"Save Profile"',
    );
  });

  it('degrades to `unknown` for an element nothing stamped', () => {
    expect(print(<button>Save Profile</button>)).toBe(`${UNKNOWN_CHAIN}|button|"Save Profile"`);
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
    // The wrapper is written in ProfileForm, so it carries ProfileForm's stamp, which collapses.
    function WrappedForm(): ReactElement {
      return (
        <form {...by('ProfileForm')}>
          <div {...by('ProfileForm')} className="new-layout-wrapper">
            <SaveButton />
          </div>
        </form>
      );
    }
    expect(print(<Settings><WrappedForm /></Settings>)).toBe(EXPECTED);
  });

  it('survives a CSS class / styling change', () => {
    expect(print(<Settings className="settings settings--v2 tw-flex" />)).toBe(EXPECTED);
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
      return <div {...by('ErrorBoundary')}>{children}</div>;
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
 * The known failure modes, asserted so they stay visible decisions rather than surprises.
 * Each is a false SPLIT or a false MERGE.
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
      return <button {...by('SubmitButton')}>Save Profile</button>;
    }

    expect(print(<Settings><ProfileForm><SubmitButton /></ProfileForm></Settings>)).toBe(
      'Settings>ProfileForm>SubmitButton|button|"Save Profile"',
    );
  });

  it('KNOWN MERGE: two unlabelled buttons in one component are one identity', () => {
    // The merge §3.2's run 2 measured on real apps: icon buttons with no accessible name.
    function Toolbar(): ReactElement {
      return (
        <div {...by('Toolbar')}>
          <button {...by('Toolbar')} id="bold" />
          <button {...by('Toolbar')} id="italic" />
        </div>
      );
    }

    expect(print(<Toolbar />, '#bold')).toBe('Toolbar|button');
    expect(print(<Toolbar />, '#italic')).toBe(print(<Toolbar />, '#bold'));
  });

  it('KNOWN MERGE: same-named components in different files are one identity', () => {
    // The cost of dropping the source file (SEMANTIC-CONVENTIONS 0.5): a `Card` in billing/ and
    // a `Card` in settings/ stamp the same name, and nothing else tells them apart.
    function BillingCard(): ReactElement { return <button {...by('Card')}>Edit</button>; }
    function SettingsCard(): ReactElement { return <button {...by('Card')}>Edit</button>; }

    expect(print(<BillingCard />)).toBe(print(<SettingsCard />));
  });
});
