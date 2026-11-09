// scripts/identity-spike/corpus/apps.ts
// How each corpus app is entered and how each pre-registered screen is reached.
//
// The screens themselves come from manifest.ts, which is held to CORPUS.md. This file only says
// how to get to them: every route by a full load (CORPUS.md: "in its default state after
// load"), and the one screen CORPUS.md names by description rather than by route by doing what
// the description says.
import type { Page, Settle } from './browser.ts';
import type { AppId } from './manifest.ts';

export interface AppDriver {
  /** Actual needs cross-origin isolation for SharedArrayBuffer (CORPUS.md: COOP/COEP). */
  crossOriginIsolated: boolean;
  /** See `PageOptions.bypassServiceWorker`: true where the service worker is only a cache. */
  bypassServiceWorker: boolean;
  /** From a fresh browser context to the app's first screen, signed in or demo started. */
  enter: (page: Page, base: string) => Promise<void>;
  /** Reach one of manifest.ts's screens. */
  open: (page: Page, base: string, screen: string) => Promise<Settle>;
}

/** An in-page expression for the first button whose trimmed text is exactly `label`. */
const button = (label: string) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;

async function expectLocation(page: Page, test: string, what: string): Promise<void> {
  const ok = await page.evaluate<boolean>(test);
  if (!ok) throw new Error(`${what} (at ${await page.evaluate<string>('location.href')})`);
}

const actual: AppDriver = {
  crossOriginIsolated: true,
  bypassServiceWorker: true,
  enter: async (page, base) => {
    await page.goto(`${base}/`);
    await page.waitFor(button('Try the demo'), 'the welcome screen');
    // CORPUS.md: "Try the demo" (no server).
    await page.click(button('Try the demo'));
    await page.settle();
    await expectLocation(page, `location.pathname === '/budget'`, 'Try the demo did not open the budget');
  },
  open: async (page, base, screen) => {
    if (screen.startsWith('/')) return page.goto(`${base}${screen}`);
    if (screen !== 'first on-budget account register') throw new Error(`actual: no driver for ${screen}`);
    // "The register of the first account listed under 'On budget'": the sidebar lists the
    // section's link, then its accounts, so it is the first account link after the section's.
    // Clicked, as a user would open it, after the budget's own full load.
    await page.goto(`${base}/budget`);
    await page.click(`(() => {
      const links = [...document.querySelectorAll('a[href^="/accounts/"]')];
      const section = links.findIndex((a) => a.getAttribute('href') === '/accounts/onbudget');
      const first = links.slice(section + 1)[0];
      return section === -1 || !first || first.getAttribute('href') === '/accounts/offbudget' ? null : first;
    })()`);
    const settled = await page.settle();
    await expectLocation(
      page,
      `/^\\/accounts\\/[0-9a-f-]{36}$/.test(location.pathname)`,
      'the first on-budget account did not open its register',
    );
    return settled;
  },
};

const SIGNED_IN = `document.querySelector('.RaLayout-appFrame') && !document.querySelector('input[name=username]')`;

const reactAdmin: AppDriver = {
  crossOriginIsolated: false,
  // Its service worker is Mock Service Worker: the demo's backend, not a cache.
  bypassServiceWorker: false,
  enter: async (page, base) => {
    await page.goto(`${base}/`);
    await page.waitFor(`document.querySelector('input[name=username]')`, 'the login form');
    // CORPUS.md: sign-in accepts any credentials.
    for (const [field, value] of [['username', 'demo'], ['password', 'demo']] as const) {
      await page.click(`document.querySelector('input[name=${field}]')`);
      await page.type(value);
    }
    await page.click(button('Sign in'));
    // Not the URL: once signed in, the demo can render its whole layout while the hash still
    // reads #/login. The layout appearing, and the form going, is what signed in looks like.
    await page.waitFor(SIGNED_IN, 'sign-in to complete');
    await page.settle();
  },
  // The demo routes by hash, and a hash change is a same-document navigation, not a load.
  // CORPUS.md captures each screen "in its default state after load", so every screen is
  // reached through about:blank, which makes the next navigation a real load.
  open: async (page, base, screen) => {
    await page.goto('about:blank');
    const settled = await page.goto(`${base}/#${screen}`);
    await page.waitFor(SIGNED_IN, `${screen} to render signed in`);
    return settled;
  },
};

export const DRIVERS: Readonly<Record<AppId, AppDriver>> = { actual, 'react-admin': reactAdmin };
