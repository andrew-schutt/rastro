/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/src/baselines.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from 'rastro-core';
import { roleNameFingerprint, selectorPath, selectorPathFingerprint } from './baselines.js';

const mount = (markup: string): void => {
  document.body.innerHTML = markup;
};
const byId = (id: string): Element => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`no #${id}`);
  return element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('roleNameFingerprint', () => {
  it('is role and accessible name, with nothing about position', () => {
    mount('<div><button type="button" id="b">Save</button></div>');
    expect(roleNameFingerprint(byId('b'))).toBe('button:button|"Save"');
  });

  it('drops the name when there is none, as fingerprint() does', () => {
    mount('<input type="email" id="i">');
    expect(roleNameFingerprint(byId('i'))).toBe('input:email');
  });

  it('merges two look-alike controls anywhere on the page', () => {
    mount('<nav><button id="a">Save</button></nav><form><button id="b">Save</button></form>');
    expect(roleNameFingerprint(byId('a'))).toBe(roleNameFingerprint(byId('b')));
  });

  it('redacts the name with core’s default redactor', () => {
    mount('<button id="b">Email ada@example.com</button>');
    expect(roleNameFingerprint(byId('b'))).toBe(fingerprint(byId('b')).replace(/^[^|]*\|/, ''));
    expect(roleNameFingerprint(byId('b'))).not.toContain('ada@example.com');
  });
});

describe('selectorPath', () => {
  it('lists every element to <body>, innermost first, with sorted classes and position', () => {
    mount('<main class="z a"><p></p><button id="b" class="btn">Go</button></main>');
    expect(selectorPath(byId('b'))).toBe(
      'button.btn:attr_id="b"nth-child="2"nth-of-type="1";' +
        'main.a.z:nth-child="1"nth-of-type="1";' +
        'body:nth-child="2"nth-of-type="1"',
    );
  });

  it('counts nth-of-type over same-tag siblings only', () => {
    mount('<div><span></span><button></button><span></span><button id="b"></button></div>');
    expect(selectorPath(byId('b')).split(';')[0]).toBe('button:attr_id="b"nth-child="4"nth-of-type="2"');
  });

  it('keeps hashed CSS-in-JS class names, as the incumbent stores them', () => {
    mount('<button id="b" class="css-1x2y3z4 sc-bdVaJa">Go</button>');
    expect(selectorPath(byId('b')).split(';')[0]).toBe('button.css-1x2y3z4.sc-bdVaJa:attr_id="b"nth-child="1"nth-of-type="1"');
  });

  it('reads no other attribute: state, aria and the harness oracle stay out', () => {
    mount('<button id="b" role="switch" aria-checked="false" data-el="x" type="button"></button>');
    const before = selectorPath(byId('b'));
    byId('b').setAttribute('aria-checked', 'true');
    byId('b').setAttribute('data-el', 'y');
    expect(selectorPath(byId('b'))).toBe(before);
    expect(before).not.toContain('data-el');
  });

  it('escapes quotes in values and strips them from class names', () => {
    mount('<button id=\'a"b\' class=\'q"x\'></button>');
    expect(selectorPath(document.querySelector('button')!).split(';')[0]).toBe(
      'button.qx:attr_id="a\\"b"nth-child="1"nth-of-type="1"',
    );
  });

  it('crosses a shadow root to its host', () => {
    mount('<div id="host"></div>');
    const shadow = byId('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Go</button>';
    expect(selectorPath(shadow.querySelector('button')!)).toBe(
      'button:nth-child="1"nth-of-type="1";div:attr_id="host"nth-child="1"nth-of-type="1";body:nth-child="2"nth-of-type="1"',
    );
  });
});

describe('selectorPathFingerprint', () => {
  it('composes <path>|<role>|"<name>"', () => {
    mount('<button id="b" type="button">Save</button>');
    expect(selectorPathFingerprint(byId('b'))).toBe(`${selectorPath(byId('b'))}|button:button|"Save"`);
  });

  it('splits two look-alike controls by where they sit', () => {
    mount('<nav><button id="a">Save</button></nav><form><button id="b">Save</button></form>');
    expect(selectorPathFingerprint(byId('a'))).not.toBe(selectorPathFingerprint(byId('b')));
  });
});

// Every strategy honours data-telemetry-id exactly as fingerprint() does, through core's
// overrideOf, so an override can never count as a win for the default alone.
describe.each([
  ['roleNameFingerprint', roleNameFingerprint],
  ['selectorPathFingerprint', selectorPathFingerprint],
])('%s and the data-telemetry-id override', (_name, fingerprintOf) => {
  it('returns id:<value> from the nearest carrier, like fingerprint()', () => {
    mount('<div data-telemetry-id="outer"><button id="b">Save</button><span data-telemetry-id="inner"><a href="#" id="a">x</a></span></div>');
    expect(fingerprintOf(byId('b'))).toBe('id:outer');
    expect(fingerprintOf(byId('a'))).toBe('id:inner');
    expect(fingerprintOf(byId('a'))).toBe(fingerprint(byId('a')));
  });

  it('derives as usual under an empty carrier', () => {
    mount('<button data-telemetry-id="" id="b">Save</button>');
    expect(fingerprintOf(byId('b'))).not.toMatch(/^id:/);
  });
});
