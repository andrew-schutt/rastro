// scripts/identity-spike/scoring/run-2-diagnostic.ts
// Where run 2's `attribute` false merges live, and whether a JSX site could separate them.
//
//   node scripts/identity-spike/scoring/run-2-diagnostic.ts
//
// A diagnostic on SEEN data, run 2026-11-19 after run 2 was scored, to decide which candidates
// the next run pre-registers. It judges nothing and is not part of any rule. Its findings are in
// results/run-2-diagnostic.md, and are disclosed as seen by every later run.
//
// It reads load 1's screens of every non-void commit, as rule 1 does, and groups each
// fingerprint's elements with the frozen referee (`groupSites`), lower bound only. So its totals
// are run 2's, nested-list bug included. For each falsely merged fingerprint it takes one element
// per referee group and asks two things the capture can answer:
//
// - Where is the element written? The innermost first-party component of its recorded ancestry
//   is its owner. That component's file is parsed at the commit, and the plugin's own
//   `owningComponent` counts the host JSX elements of the element's tag it owns. None means a
//   primitive or a library renders the element, so it carries no stamp of its own. One means
//   every member shares one JSX site. Only several leaves a site anything to separate.
// - Does ANY component information separate the members? Their full first-party ancestries,
//   uncapped, are compared. Identical ancestries are beyond every component-based identity.
//
// Both are proxies. Counting JSX by tag cannot say WHICH of several sites rendered an element,
// and a host element of the right tag in the owner does not prove it rendered this one.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseSync, traverse, type NodePath, type PluginItem, type types as BabelTypes } from '@babel/core';
import { owningComponent } from 'babel-plugin-rastro';
import { BUILD_VARIANTS, CORPUS, type CorpusApp } from '../corpus/manifest.ts';
import { corpusRoot } from '../corpus/runtime.ts';
import type { CapturedElement } from '../src/page.ts';
import { groupSites } from '../src/repeat-oracle.ts';
import { isVoid, readCapture } from './captures.ts';

// Loaded, not named by string: Babel would resolve a name against the corpus app, not this package.
const typescriptPreset = createRequire(import.meta.url)('@babel/preset-typescript') as PluginItem;

/** `<owner> <tag>` → how many host JSX elements of that tag the plugin attributes to the owner. */
type JsxSites = Map<string, number>;

const parsed = new Map<string, JsxSites | null>();

/** The host JSX sites in one file at one commit, or null when the file cannot be read. */
function jsxSites(clone: string, sha: string, file: string): JsxSites | null {
  const key = `${clone} ${sha} ${file}`;
  const cached = parsed.get(key);
  if (cached !== undefined) return cached;
  let code: string;
  try {
    code = execFileSync('git', ['-C', clone, 'show', `${sha}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch {
    parsed.set(key, null);
    return null;
  }
  const sites: JsxSites = new Map();
  const ast = parseSync(code, {
    filename: 'source.tsx',
    babelrc: false,
    configFile: false,
    presets: [[typescriptPreset, { isTSX: true, allExtensions: true }]],
  });
  if (ast === null) throw new Error(`${file} at ${sha} did not parse`);
  traverse(ast, {
    JSXOpeningElement(path: NodePath<BabelTypes.JSXOpeningElement>) {
      const { name } = path.node;
      if (name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name)) return;
      const owner = owningComponent(path)?.name;
      if (owner === undefined) return;
      const site = `${owner} ${name.name}`;
      sites.set(site, (sites.get(site) ?? 0) + 1);
    },
  });
  parsed.set(key, sites);
  return sites;
}

/** Excess distinct elements (distinct − 1, lower bound) per bucket, with a few examples. */
class Tally {
  readonly buckets = new Map<string, { excess: number; fingerprints: number; examples: string[] }>();
  add(bucket: string, excess: number, example: string): void {
    const entry = this.buckets.get(bucket) ?? { excess: 0, fingerprints: 0, examples: [] };
    entry.excess += excess;
    entry.fingerprints += 1;
    if (entry.examples.length < 4) entry.examples.push(example);
    this.buckets.set(bucket, entry);
  }
  toJSON() {
    return Object.fromEntries([...this.buckets].sort((a, b) => b[1].excess - a[1].excess));
  }
}

const markKey = (mark: { name: string; file?: string }) => `${mark.name}@${mark.file ?? '?'}`;

/** Where the members are written, from their owners and the owner's JSX. */
function written(app: CorpusApp, clone: string, sha: string, members: readonly CapturedElement[]): string {
  const owners = members.map((element) => element.ancestry.at(-1));
  if (owners.some((owner) => owner === undefined)) return 'no first-party owner';
  const defined = owners as { name: string; file?: string }[];
  if (new Set(defined.map(markKey)).size > 1) {
    return new Set(defined.map((owner) => owner.name)).size === 1
      ? 'different owners: same name, different files (class 2)'
      : 'different owners: the chain did not see it';
  }
  const tags = new Set(members.map((element) => element.description.tag));
  if (tags.size > 1) return 'one owner: mixed tags';
  const [owner] = defined;
  const [tag] = tags;
  if (owner?.file === undefined || tag === undefined) return 'one owner: no file recorded';
  const root = app.pluginRoot === '.' ? '' : `${app.pluginRoot}/`;
  const sites = jsxSites(clone, sha, root + owner.file);
  if (sites === null) return 'one owner: source unreadable';
  const count = sites.get(`${owner.name} ${tag}`) ?? 0;
  if (count === 0) return 'one owner: not in its JSX (a primitive or library renders it)';
  return count === 1 ? 'one owner: ONE JSX site of that tag' : 'one owner: SEVERAL JSX sites of that tag';
}

/** Whether any component information separates the members, and how close to the element. */
function ceiling(members: readonly CapturedElement[]): string {
  const chains = members.map((element) => element.ancestry.map(markKey));
  const first = chains[0] ?? [];
  if (chains.every((chain) => chain.join('>') === first.join('>'))) return 'ancestry identical';
  const shortest = Math.min(...chains.map((chain) => chain.length));
  let depth = 0;
  while (depth < shortest && chains.every((chain) => chain[chain.length - 1 - depth] === first[first.length - 1 - depth])) {
    depth += 1;
  }
  return depth < 4 ? 'ancestry diverges within 4 of the owner' : 'ancestry diverges more than 4 above the owner';
}

function diagnose(app: CorpusApp) {
  const root = corpusRoot();
  const clone = join(root, app.id);
  const where = new Tally();
  const separable = new Tally();
  const stamp = new Tally();
  const voided: number[] = [];
  let total = 0;
  for (const commit of app.commits) {
    const captures = BUILD_VARIANTS.map((variant) => readCapture(root, app, commit, variant));
    const capture = captures[0];
    if (capture === null || capture === undefined) continue;
    if (isVoid(captures)) {
      voided.push(commit.index);
      continue;
    }
    for (const screen of capture.load.screens) {
      if (!screen.captured) continue;
      const elements = screen.elements;
      const byFingerprint = new Map<string, number[]>();
      elements.forEach((element, i) => {
        const fingerprint = element.fingerprints.attribute;
        byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), i]);
      });
      for (const [fingerprint, indices] of byFingerprint) {
        if (indices.length < 2) continue;
        const grouping = groupSites(indices.map((i) => elements[i]!.site));
        const excess = grouping.distinctElements.atLeast - 1;
        if (excess === 0) continue;
        const members = grouping.groups.map((group) => elements[indices[group[0]!]!]!);
        const named = members[0]!.parts.attribute.name === undefined ? 'unnamed' : 'named';
        const example = `${commit.index} ${screen.screen}: ${fingerprint} (${members.length} distinct)`;
        total += excess;
        where.add(`${named} | ${written(app, clone, commit.sha, members)}`, excess, example);
        separable.add(`${named} | ${ceiling(members)}`, excess, example);
        stamp.add(`${named} | nearest stamp ${members[0]!.parts.attribute.chain?.split('>').at(-1) ?? 'none (unknown)'}`, excess, example);
      }
    }
  }
  return { app: app.id, voided, total, where, separable, stamp };
}

console.log(JSON.stringify(Object.values(CORPUS).map(diagnose), null, 2));
