// scripts/identity-spike/corpus/conditions.ts
// docs/CORPUS.md's run conditions, as values and as the script that installs them.
//
// Identical for every commit, every strategy and both apps. The init script runs before any
// app code in the page AND in every worker the page starts: Actual generates its demo budget in
// its backend worker, so seeding only the page's Math.random would leave the data the screens
// show unseeded, and the rebuild control would catch it as churn that has nothing to do with
// identity.

export const VIEWPORT = { width: 1280, height: 800 } as const;

/** English, per CORPUS.md. */
export const LOCALE = 'en-US';

/**
 * The fixed clock: 2026-10-30T12:00:00Z. Frozen, not started there and left running: every
 * read of the clock in a load returns this instant. A clock left running would make each load's
 * relative dates ("3 minutes ago") depend on how long the load took.
 */
export const FIXED_TIME_MS = Date.UTC(2026, 9, 30, 12, 0, 0);

/**
 * UTC. Not in CORPUS.md's first list, added before any corpus number (see its run conditions):
 * without it, dates the apps render depend on the machine running the corpus.
 */
export const TIME_ZONE = 'UTC';

/** One seed for every load. Its value is arbitrary; that it never changes is the point. */
export const SEED = 0x5eed_c0de;

/**
 * Install the seeded `Math.random`, seeded crypto, and the frozen clock in whatever global it runs in: a page,
 * a dedicated worker, or a shared worker. Self-contained source, because it is evaluated there
 * as a string, never imported. Idempotent, because a page and its frames can each run it.
 */
export type ClockMode = 'frozen' | 'running';

/**
 * `crypto.getRandomValues` and `crypto.randomUUID` are seeded too: a CORPUS.md run condition
 * since the 2026-11-09 amendment. Actual's demo data takes its ids from `crypto.randomUUID()`,
 * and transactions that tie on date are ordered by them, so seeding only Math.random left its
 * screens different on every load. Crypto draws from its own stream, so Math.random's sequence
 * is the one the conditions always had. `seedCrypto: false` exists for the test that proves it.
 */
export function initScript(
  seed: number = SEED,
  fixedTimeMs: number = FIXED_TIME_MS,
  clock: ClockMode = 'frozen',
  seedCrypto = true,
): string {
  return `(() => {
  const g = globalThis;
  if (g.__rastroCorpusConditions) return;
  g.__rastroCorpusConditions = true;

  // mulberry32: small, fast, and the same sequence in every engine for one seed.
  let state = ${seed >>> 0};
  Math.random = function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

${seedCrypto ? `  // A second mulberry32 stream, so seeding crypto leaves Math.random's sequence untouched.
  let cryptoState = ${(seed ^ 0x9e3779b9) >>> 0};
  const cryptoRandom = () => {
    cryptoState = (cryptoState + 0x6d2b79f5) | 0;
    let t = Math.imul(cryptoState ^ (cryptoState >>> 15), 1 | cryptoState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (g.crypto) {
    const fill = (array) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(cryptoRandom() * 256);
      return array;
    };
    Object.defineProperty(g.crypto, 'getRandomValues', { value: fill, configurable: true });
    Object.defineProperty(g.crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        const b = fill(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
      },
    });
  }
` : ''}  const RealDate = Date;
  const fixed = ${fixedTimeMs};
  ${clock === 'running'
    ? `const origin = performance.now();
  const now = () => fixed + Math.floor(performance.now() - origin);`
    : 'const now = () => fixed;'}
  function FixedDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return args.length === 0 ? new RealDate(now()) : new RealDate(...args);
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = now;
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  Object.defineProperty(FixedDate.prototype, 'constructor', { value: FixedDate });
  g.Date = FixedDate;
})();`;
}
