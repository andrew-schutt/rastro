// scripts/identity-spike/scoring/worksheets.ts
// What a person needs for the two hand steps, and nothing that would bias them.
//
//   node scripts/identity-spike/scoring/worksheets.ts rule3 <app>   # match rows; then proposals
//   node scripts/identity-spike/scoring/worksheets.ts rule4 <app>   # label every vanished fingerprint
//
// Writes to $RASTRO_CORPUS/worksheets/<app>/. Neither shows a verdict, a collision or a score.
// Rule 3's sheets show descriptions only (README, item 3). Rule 4's show what vanished and what
// appeared, never what a proposer would say. The answers go in this directory, under
// matches/<app>.json and labels/<app>.json, where they are reviewed with the results.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StateRecord } from '../corpus/flows.ts';
import { CORPUS, type AppId, type CorpusApp } from '../corpus/manifest.ts';
import { corpusRoot } from '../corpus/runtime.ts';
import type { ElementDescription } from '../src/describe.ts';
import { isVoid, readCapture } from './captures.ts';
import { worksheet } from './drift.ts';
import { propose, type Matches } from './flow-rule.ts';

const HERE = import.meta.dirname;
const REFERENCE = 10;

const show = (d: ElementDescription) =>
  [
    d.tag,
    d.role === null ? '' : `role=${d.role}`,
    d.label === null ? '' : `label="${d.label}"`,
    d.text === '' ? '' : `text="${d.text}"`,
    ...Object.entries(d.attributes).map(([k, v]) => `${k}=${v}`),
    d.within === null ? '' : `within=${JSON.stringify(d.within)}`,
    `@${d.box.x},${d.box.y} ${d.box.width}×${d.box.height}`,
  ]
    .filter((part) => part !== '')
    .join('  ');

/** False when the commit is void (`isVoid`): it gets no sheet, and neither does any pair it is in. */
function stands(app: CorpusApp, index: number): boolean {
  const commit = app.commits.find((c) => c.index === index)!;
  return !isVoid((['as-shipped', 'mangled'] as const).map((variant) => readCapture(corpusRoot(), app, commit, variant)));
}

function states(app: CorpusApp, index: number): Map<string, StateRecord> {
  const commit = app.commits.find((c) => c.index === index)!;
  const capture = readCapture(corpusRoot(), app, commit, 'as-shipped');
  if (capture === null) throw new Error(`${app.id} commit ${index} has no as-shipped capture`);
  return new Map((capture.load.flow?.states ?? []).filter((s) => s.captured).map((s) => [s.screen, s]));
}

function screens(app: CorpusApp, index: number): Map<string, StateRecord> | null {
  const commit = app.commits.find((c) => c.index === index)!;
  const capture = readCapture(corpusRoot(), app, commit, 'as-shipped');
  return capture === null ? null : new Map(capture.load.screens.filter((s) => s.captured).map((s) => [s.screen, s]));
}

function ruleThree(app: CorpusApp, out: string): void {
  if (!stands(app, REFERENCE)) throw new Error(`${app.id} commit ${REFERENCE} is void, and rule 3 is matched there`);
  const reference = states(app, REFERENCE);
  const lines = [`# Rule 3 matching: ${app.id}, commit ${REFERENCE}`, '', `Flow: ${app.flow.name}. Match each row by its description; put the element index in matches/${app.id}.json.`, ''];
  for (const [state, record] of reference) {
    lines.push(`## ${state}`, '', ...app.flow.rows.filter((r) => r.state === state).map((r) => `- **${r.id}**: ${r.element}`), '');
    record.elements.forEach((element, i) => lines.push(`${i}. ${show(element.description)}${element.visible ? '' : '  (hidden)'}`));
    lines.push('');
  }
  writeFileSync(join(out, `rule3-commit${REFERENCE}.md`), `${lines.join('\n')}\n`);

  const path = join(HERE, 'matches', `${app.id}.json`);
  const matches = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Matches) : null;
  const filled = matches?.[REFERENCE];
  if (filled === undefined || Object.values(filled).some((m) => m.element === null && m.note === undefined)) {
    console.log(`  ${app.id}: match every row at commit ${REFERENCE} first (${path}); proposals for the other commits follow from them`);
    return;
  }
  const proposals: Matches = {};
  for (const commit of app.commits.filter((c) => c.index !== REFERENCE && stands(app, c.index))) {
    const here = states(app, commit.index);
    proposals[commit.index] = Object.fromEntries(
      app.flow.rows.map((row) => {
        const anchor = filled[row.id];
        const element = anchor?.element === null || anchor === undefined ? undefined : reference.get(row.state)?.elements[anchor.element];
        const state = here.get(row.state);
        const proposed = element === undefined || state === undefined ? null : propose(element, state);
        return [row.id, { state: row.state, element: proposed, by: 'proposed' as const, matcher: '' }];
      }),
    );
  }
  writeFileSync(join(out, 'rule3-proposals.json'), `${JSON.stringify(proposals, null, 2)}\n`);
  console.log(`  ${app.id}: proposals in ${join(out, 'rule3-proposals.json')}. Confirm each into ${path}; a null proposal is matched by hand.`);
}

function ruleFour(app: CorpusApp, out: string): void {
  const template: Record<string, Record<string, { kind: string; evidence: string }>> = {};
  for (const commit of app.commits.slice(1)) {
    const before = screens(app, commit.index - 1);
    const after = screens(app, commit.index);
    const pair = `${commit.index - 1}-${commit.index}`;
    if (!stands(app, commit.index - 1) || !stands(app, commit.index)) {
      console.log(`  ${app.id} ${pair}: a void commit; not labelled`);
      continue;
    }
    if (before === null || after === null) {
      console.log(`  ${app.id} ${pair}: a capture is missing; not labelled`);
      continue;
    }
    const { subjects, appeared } = worksheet(before, after);
    const lines = [`# Rule 4 labels: ${app.id}, pair ${pair}`, '', 'Label each vanished fingerprint from the diff: continued (as which appeared one), removed, replaced, or unclear, with the diff line that justifies it.', '', '## Vanished', ''];
    for (const s of subjects) lines.push(`- \`${s.fingerprint}\` on ${s.routes.join(', ')}`, ...s.descriptions.map((d) => `  - ${show(d)}`));
    lines.push('', '## Appeared', '');
    for (const a of appeared) lines.push(`- \`${a.fingerprint}\` on ${a.routes.join(', ')}`, ...a.descriptions.map((d) => `  - ${show(d)}`));
    writeFileSync(join(out, `rule4-${pair}.md`), `${lines.join('\n')}\n`);
    template[pair] = Object.fromEntries(subjects.map((s) => [s.fingerprint, { kind: '', evidence: '' }]));
    console.log(`  ${app.id} ${pair}: ${subjects.length} to label`);
  }
  writeFileSync(join(out, 'rule4-labels-template.json'), `${JSON.stringify(template, null, 2)}\n`);
}

function main([which, appArg]: string[]): void {
  if ((which !== 'rule3' && which !== 'rule4') || appArg === undefined || !(appArg in CORPUS)) {
    throw new Error('usage: worksheets.ts <rule3|rule4> <actual|react-admin>');
  }
  const app = CORPUS[appArg as AppId];
  const out = join(corpusRoot(), 'worksheets', app.id);
  mkdirSync(out, { recursive: true });
  if (which === 'rule3') ruleThree(app, out);
  else ruleFour(app, out);
}

if (process.argv[1] === import.meta.filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
