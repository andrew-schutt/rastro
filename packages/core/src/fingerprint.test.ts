/**
 * @vitest-environment jsdom
 *
 * packages/core/src/fingerprint.test.ts
 * The DOM half of §4.2.1. The fiber walk needs a real React render, so it is tested in
 * packages/react (fingerprint.dom.test.ts) — `core` stays free of React, dev deps included.
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
  documentIsAnnotated,
  resetAnnotationProbe,
  fingerprint,
  getFiber,
  norm,
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

describe('fingerprint — composition and degradation', () => {
  it('composes <chain>|<role>|"<name>"', () => {
    // No React here, so the chain degrades — the shape and the other two parts are real.
    expect(fingerprint(html('<button>Save Profile</button>'))).toBe(
      `${UNKNOWN_CHAIN}|button|"Save Profile"`,
    );
  });

  it('degrades the component chain to `unknown` on a non-React node', () => {
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

describe('getFiber', () => {
  it('returns null for a plain DOM node with no React fiber', () => {
    expect(getFiber(html('<button>x</button>'))).toBeNull();
  });

  it('finds a fiber hung off the node under the React 17+ key', () => {
    const element = html('<button>x</button>');
    const fiber = { type: null };
    Object.assign(element, { __reactFiber$abc123: fiber });

    expect(getFiber(element)).toBe(fiber);
  });

  it('finds a fiber under the React 16 key', () => {
    const element = html('<button>x</button>');
    const fiber = { type: null };
    Object.assign(element, { __reactInternalInstance$xyz: fiber });

    expect(getFiber(element)).toBe(fiber);
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
    resetAnnotationProbe(document);
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

  it('applies NOISE exactly as the fiber walk does', () => {
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

describe('documentIsAnnotated', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetAnnotationProbe(document);
  });

  it('is false for a document the plugin never touched', () => {
    document.body.innerHTML = '<button>Save</button>';
    expect(documentIsAnnotated(document)).toBe(false);
  });

  it('is true as soon as one element carries the attribute', () => {
    document.body.innerHTML = `<div ${COMPONENT_ATTRIBUTE}="App"><button>Save</button></div>`;
    expect(documentIsAnnotated(document)).toBe(true);
  });

  // The decision is per document, not per element: a portaled modal outside the annotated
  // subtree must NOT silently fall back to the fiber walk, or one page yields two kinds of
  // chain that cannot be compared with each other.
  it('commits the whole document, so an unannotated subtree does not switch strategy', () => {
    document.body.innerHTML =
      `<div ${COMPONENT_ATTRIBUTE}="App"></div><div id="portal"><button>Save</button></div>`;
    expect(documentIsAnnotated(document)).toBe(true);

    const orphan = document.querySelector('#portal button');
    expect(orphan).not.toBeNull();
    // No annotated ancestor: the chain degrades to `unknown` rather than reverting to fiber.
    expect(describeElement(orphan as Element).fingerprint).toBe(`${UNKNOWN_CHAIN}|button|"Save"`);
  });

  it('caches, so the strategy cannot change mid-session', () => {
    document.body.innerHTML = '<button>Save</button>';
    expect(documentIsAnnotated(document)).toBe(false);

    document.body.innerHTML = `<div ${COMPONENT_ATTRIBUTE}="App"></div>`;
    expect(documentIsAnnotated(document)).toBe(false); // still the first answer
  });
});

describe('the two strategies agree where they can', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetAnnotationProbe(document);
  });

  // Parity is the point: an app that adds the build plugin should not re-identify every
  // element it already had data for. This asserts it for the shape both strategies can see.
  it('produces the same fingerprint an equivalent fiber chain would', () => {
    document.body.innerHTML = `
      <div ${COMPONENT_ATTRIBUTE}="App">
        <form ${COMPONENT_ATTRIBUTE}="SettingsForm">
          <button ${COMPONENT_ATTRIBUTE}="SaveButton">Save Profile</button>
        </form>
      </div>`;
    const button = document.querySelector('button');
    expect(button).not.toBeNull();

    const fromAttributes = describeElement(button as Element).fingerprint;
    expect(fromAttributes).toBe('App>SettingsForm>SaveButton|button|"Save Profile"');

    // Same string the fiber walk yields for the same component ancestry (see
    // packages/react/src/fingerprint.dom.test.tsx, which renders it through React).
    expect(fromAttributes).toBe(
      [['App', 'SettingsForm', 'SaveButton'].join('>'), 'button', '"Save Profile"'].join('|'),
    );
  });

  it('still honours data-telemetry-id above either strategy', () => {
    document.body.innerHTML = `
      <div data-telemetry-id="checkout" ${COMPONENT_ATTRIBUTE}="App">
        <button ${COMPONENT_ATTRIBUTE}="SaveButton">Save</button>
      </div>`;
    const button = document.querySelector('button');
    expect(describeElement(button as Element).fingerprint).toBe('id:checkout');
  });
});
