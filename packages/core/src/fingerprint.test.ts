/**
 * @vitest-environment jsdom
 *
 * packages/core/src/fingerprint.test.ts
 * §4.2.1 on plain DOM: the fingerprint reads build-time stamps and the element itself, and
 * nothing of React's, so `core` stays free of React, dev deps included.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMPONENT_ATTRIBUTE,
  MAX_NAME_LENGTH,
  NOISE,
  UNKNOWN_CHAIN,
  accName,
  attributeChain,
  describeElement,
  fingerprint,
  norm,
  overrideOf,
  roleOf,
} from './fingerprint.js';
import { REDACTED, noopRedactor } from './redact.js';

const html = (markup: string): Element => {
  document.body.innerHTML = markup;
  const first = document.body.firstElementChild;
  if (first === null) throw new Error('no element');
  return first;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('fingerprint — the data-telemetry-id override', () => {
  it('returns `id:<value>` when the element carries data-telemetry-id', () => {
    expect(fingerprint(html('<button data-telemetry-id="save">Save</button>'))).toBe('id:save');
  });

  it('returns `id:<value>` when an ANCESTOR carries data-telemetry-id', () => {
    const root = html('<div data-telemetry-id="widget"><button id="b">Save</button></div>');
    const button = root.querySelector('#b');

    expect(fingerprint(button!)).toBe('id:widget');
  });

  it('prefers the override over every derived signal', () => {
    const element = html('<button data-telemetry-id="save" aria-label="Something else">x</button>');

    expect(fingerprint(element)).toBe('id:save');
  });

  it('uses the NEAREST override when they nest', () => {
    const root = html('<div data-telemetry-id="outer"><span data-telemetry-id="inner" id="s">x</span></div>');

    expect(fingerprint(root.querySelector('#s')!)).toBe('id:inner');
  });

  it('ignores an empty override rather than emitting `id:`', () => {
    expect(fingerprint(html('<button data-telemetry-id="">Save</button>'))).toBe(
      `${UNKNOWN_CHAIN}|button|"Save"`,
    );
  });
});

// The same rule, exported so every §3.2 strategy honours the override exactly as the default.
describe('overrideOf', () => {
  it('returns the nearest carrier’s value, on the element or an ancestor', () => {
    const root = html('<div data-telemetry-id="outer"><span data-telemetry-id="inner" id="s">x</span><b id="b">y</b></div>');

    expect(overrideOf(root.querySelector('#s')!)).toBe('inner');
    expect(overrideOf(root.querySelector('#b')!)).toBe('outer');
  });

  it('returns undefined when nothing carries one', () => {
    expect(overrideOf(html('<button>Save</button>'))).toBeUndefined();
  });

  // The nearest carrier is the one the developer wrote. An empty one switches the override
  // off there; it does not fall through to an outer carrier.
  it('treats an empty nearest carrier as no override, without looking further out', () => {
    const root = html('<div data-telemetry-id="outer"><button data-telemetry-id="" id="b">Save</button></div>');

    expect(overrideOf(root.querySelector('#b')!)).toBeUndefined();
    expect(fingerprint(root.querySelector('#b')!)).toBe(`${UNKNOWN_CHAIN}|button|"Save"`);
  });
});

describe('fingerprint — composition and degradation', () => {
  it('composes <chain>|<role>|"<name>"', () => {
    // No stamps here, so the chain degrades — the shape and the other two parts are real.
    expect(fingerprint(html('<button>Save Profile</button>'))).toBe(
      `${UNKNOWN_CHAIN}|button|"Save Profile"`,
    );
  });

  it('degrades the component chain to `unknown` on an element the plugin did not stamp', () => {
    expect(fingerprint(html('<a href="/x">Home</a>'))).toBe(`${UNKNOWN_CHAIN}|a|"Home"`);
  });

  it('drops the trailing segment when there is no accessible name', () => {
    expect(fingerprint(html('<input type="email" />'))).toBe(`${UNKNOWN_CHAIN}|input:email`);
  });

  it('exposes the raw parts so fingerprints can be re-derived without re-collecting', () => {
    const description = describeElement(html('<button aria-label="Save Profile">x</button>'));

    expect(description).toEqual({
      fingerprint: `${UNKNOWN_CHAIN}|button|"Save Profile"`,
      componentChain: [],
      role: 'button',
      accessibleName: 'Save Profile',
    });
  });

  it('reports no component chain for an override, since none was derived', () => {
    const description = describeElement(html('<button data-telemetry-id="save">x</button>'));

    expect(description.componentChain).toEqual([]);
    expect(description.accessibleName).toBeUndefined();
  });
});

describe('roleOf', () => {
  it('prefers an explicit role attribute', () => {
    expect(roleOf(html('<div role="button">x</div>'))).toBe('button');
  });

  it('returns `input:email` for <input type="email">', () => {
    expect(roleOf(html('<input type="email" />'))).toBe('input:email');
  });

  it('falls back to the lowercased tag name', () => {
    expect(roleOf(html('<BUTTON>x</BUTTON>'))).toBe('button');
  });

  it('ignores an empty role attribute', () => {
    expect(roleOf(html('<div role="">x</div>'))).toBe('div');
  });
});

describe('accName', () => {
  it('prefers aria-label', () => {
    expect(accName(html('<button aria-label="Close dialog">×</button>'))).toBe('Close dialog');
  });

  it('resolves aria-labelledby to the referenced element text', () => {
    const root = html('<div><h2 id="t">Billing</h2><button id="b" aria-labelledby="t">x</button></div>');

    expect(accName(root.querySelector('#b')!)).toBe('Billing');
  });

  it('resolves only the first id when aria-labelledby lists several', () => {
    const root = html('<div><span id="a">One</span><span id="b">Two</span><button id="c" aria-labelledby="a b">x</button></div>');

    expect(accName(root.querySelector('#c')!)).toBe('One');
  });

  it('falls back to text content', () => {
    expect(accName(html('<button>Save Profile</button>'))).toBe('Save Profile');
  });

  it('falls back to title, then alt', () => {
    expect(accName(html('<img title="Company logo" />'))).toBe('Company logo');
    expect(accName(html('<img alt="Company logo" />'))).toBe('Company logo');
  });

  it('returns undefined when the element has no label at all', () => {
    expect(accName(html('<input type="text" />'))).toBeUndefined();
  });

  it('collapses whitespace', () => {
    expect(accName(html('<button>  Save   \n  Profile  </button>'))).toBe('Save Profile');
  });

  it('caps at MAX_NAME_LENGTH', () => {
    expect(accName(html(`<button>${'a'.repeat(120)}</button>`))?.length).toBe(MAX_NAME_LENGTH);
  });

  // The §4.9 caveat: an accessible name is a first-class PII leak.
  it('redacts before the name enters the fingerprint', () => {
    const element = html('<button>Delete account for jane@x.com</button>');

    expect(accName(element)).toBe(`Delete account for ${REDACTED}`);
    expect(fingerprint(element)).toContain(REDACTED);
    expect(fingerprint(element)).not.toContain('jane@x.com');
  });

  it('redacts BEFORE truncating, so an email cannot survive by being cut in half', () => {
    const long = `${'a'.repeat(MAX_NAME_LENGTH - 5)} someone@example.com`;

    expect(accName(html(`<button>${long}</button>`))).not.toContain('someone@');
  });

  describe('name from content', () => {
    it.each(['button', 'a', 'summary', 'label', 'h2', 'legend'])(
      'takes text content as the name for <%s>',
      (tag) => {
        expect(accName(html(`<${tag}>Save Profile</${tag}>`))).toBe('Save Profile');
      },
    );

    // The container fix: a form's text blob is unstable and not an accessible name.
    it.each(['form', 'div', 'section', 'nav', 'ul'])(
      'does NOT take text content as the name for <%s>',
      (tag) => {
        const element = html(`<${tag}><label>Email</label><button>Save</button></${tag}>`);

        expect(accName(element)).toBeUndefined();
      },
    );

    it('keeps a container stable when the copy inside it changes', () => {
      const before = fingerprint(html('<form><label>Email</label><button>Save</button></form>'));
      const after = fingerprint(html('<form><label>E-mail address</label><button>Submit</button></form>'));

      expect(before).toBe(after);
      expect(before).toBe(`${UNKNOWN_CHAIN}|form`);
    });

    it('still honours an author-supplied label on a container', () => {
      // A container the developer bothered to name HAS a real name.
      expect(accName(html('<form aria-label="Profile settings"><input /></form>'))).toBe(
        'Profile settings',
      );
    });

    it('follows an explicit role over the tag name', () => {
      expect(accName(html('<div role="button">Save</div>'))).toBe('Save');
      expect(accName(html('<div role="group">Save</div>'))).toBeUndefined();
    });
  });

  it('honours a swapped-in Redactor', () => {
    const element = html('<button>jane@x.com</button>');

    expect(accName(element, noopRedactor)).toBe('jane@x.com');
  });
});

describe('norm', () => {
  it('collapses whitespace and trims', () => {
    expect(norm('  a \n\t b  ')).toBe('a b');
  });

  it('caps length', () => {
    expect(norm('x'.repeat(200))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('NOISE', () => {
  it.each(['Provider', 'Consumer', 'Context', 'Fragment', 'Anonymous', 'ForwardRef', 'Memo'])(
    'filters the framework name %s',
    (name) => {
      expect(NOISE.test(name)).toBe(true);
    },
  );

  it.each(['ErrorBoundary', 'SuspenseBoundary'])('filters %s', (name) => {
    expect(NOISE.test(name)).toBe(true);
  });

  // The widening: real wrappers are never named bare `Provider`.
  it.each(['ThemeProvider', 'QueryClientProvider', 'AuthProvider', 'RastroProvider'])(
    'filters the real-world wrapper %s',
    (name) => {
      expect(NOISE.test(name)).toBe(true);
    },
  );

  it.each(['SaveButton', 'ProfileForm', 'Settings', 'ProviderPicker', 'Nav'])(
    'keeps the meaningful component %s',
    (name) => {
      expect(NOISE.test(name)).toBe(false);
    },
  );
});

describe('attributeChain', () => {
  /** Build a nesting of host elements, each stamped like the plugin would stamp it. */
  function stamped(...owners: (string | null)[]): Element {
    let parent: Element = document.body;
    let leaf: Element = document.body;
    for (const owner of owners) {
      const node = document.createElement('div');
      if (owner !== null) node.setAttribute(COMPONENT_ATTRIBUTE, owner);
      parent.appendChild(node);
      parent = node;
      leaf = node;
    }
    return leaf;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the ancestry from the DOM, outermost first', () => {
    expect(attributeChain(stamped('App', 'SettingsForm', 'SaveButton'))).toEqual([
      'App',
      'SettingsForm',
      'SaveButton',
    ]);
  });

  // The plugin stamps EVERY host element, so a component that renders nested markup repeats.
  // Without this the chain would read App>SettingsForm>SettingsForm>SettingsForm.
  it('collapses consecutive repeats, which the plugin necessarily produces', () => {
    expect(
      attributeChain(stamped('App', 'SettingsForm', 'SettingsForm', 'SettingsForm')),
    ).toEqual(['App', 'SettingsForm']);
  });

  it('collapses repeats even across a filtered wrapper', () => {
    expect(attributeChain(stamped('SettingsForm', 'ThemeProvider', 'SettingsForm'))).toEqual([
      'SettingsForm',
    ]);
  });

  it('skips NOISE names, so adding a provider does not churn the chain', () => {
    expect(attributeChain(stamped('App', 'AuthProvider', 'SettingsForm'))).toEqual([
      'App',
      'SettingsForm',
    ]);
  });

  it('keeps the nearest components when the ancestry is deeper than the cap', () => {
    const leaf = stamped('Root', 'A', 'B', 'C', 'D', 'E');
    expect(attributeChain(leaf)).toEqual(['B', 'C', 'D', 'E']);
  });

  it('skips unstamped elements rather than breaking the chain', () => {
    expect(attributeChain(stamped('App', null, 'SaveButton'))).toEqual(['App', 'SaveButton']);
  });

  it('is empty when nothing is annotated', () => {
    expect(attributeChain(stamped(null, null))).toEqual([]);
  });
});

describe('the stamped chain in the fingerprint', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('composes the stamped chain with role and name', () => {
    document.body.innerHTML = `
      <div ${COMPONENT_ATTRIBUTE}="App">
        <form ${COMPONENT_ATTRIBUTE}="SettingsForm">
          <button ${COMPONENT_ATTRIBUTE}="SaveButton">Save Profile</button>
        </form>
      </div>`;
    const button = document.querySelector('button');
    expect(button).not.toBeNull();

    expect(describeElement(button as Element)).toEqual({
      fingerprint: 'App>SettingsForm>SaveButton|button|"Save Profile"',
      componentChain: ['App', 'SettingsForm', 'SaveButton'],
      role: 'button',
      accessibleName: 'Save Profile',
    });
  });

  // A portaled modal sits outside the stamped tree. It degrades to role and name, and there is
  // no second chain source to fall back to, so one page can never mix two kinds of chain.
  it('degrades an element outside every stamped ancestor to `unknown`', () => {
    document.body.innerHTML =
      `<div ${COMPONENT_ATTRIBUTE}="App"></div><div id="portal"><button>Save</button></div>`;
    const orphan = document.querySelector('#portal button');
    expect(orphan).not.toBeNull();
    expect(describeElement(orphan as Element).fingerprint).toBe(`${UNKNOWN_CHAIN}|button|"Save"`);
  });

  // The measured failure mode (§3.2 run 2): two different buttons in one component, with no
  // accessible name, are one identity. Asserted so it stays visible until something fixes it.
  it('merges two unlabelled buttons that one component renders', () => {
    document.body.innerHTML = `
      <div ${COMPONENT_ATTRIBUTE}="Toolbar">
        <button ${COMPONENT_ATTRIBUTE}="Toolbar" id="bold"></button>
        <button ${COMPONENT_ATTRIBUTE}="Toolbar" id="italic"></button>
      </div>`;
    const bold = document.querySelector('#bold') as Element;
    const italic = document.querySelector('#italic') as Element;
    expect(fingerprint(bold)).toBe('Toolbar|button');
    expect(fingerprint(italic)).toBe(fingerprint(bold));
  });

  it('still honours data-telemetry-id above the stamped chain', () => {
    document.body.innerHTML = `
      <div data-telemetry-id="checkout" ${COMPONENT_ATTRIBUTE}="App">
        <button ${COMPONENT_ATTRIBUTE}="SaveButton">Save</button>
      </div>`;
    const button = document.querySelector('button');
    expect(describeElement(button as Element).fingerprint).toBe('id:checkout');
  });

  it('ignores a source-file attribute an older plugin stamped', () => {
    document.body.innerHTML = `<button ${COMPONENT_ATTRIBUTE}="SaveButton" data-rastro-source-file="src/Save.tsx">Save</button>`;
    expect(fingerprint(document.querySelector('button') as Element)).toBe('SaveButton|button|"Save"');
  });
});
