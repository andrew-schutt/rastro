/**
 * @vitest-environment jsdom
 *
 * packages/core/src/fingerprint.test.ts
 * The DOM half of §4.2.1. The fiber walk needs a real React render, so it is tested in
 * packages/react (fingerprint.dom.test.ts) — `core` stays free of React, dev deps included.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  NOISE,
  UNKNOWN_CHAIN,
  accName,
  describeElement,
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
