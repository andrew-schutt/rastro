// examples/stamp-fixture/audit/audit.ts
// Did babel-plugin-rastro stamp every host element it should have, in a BUILT bundle?
//
// Unit tests of the plugin transform one file in isolation. What they cannot see is the build
// around it: another Babel plugin rearranging the code first (the React Compiler hoisting
// `.map()` callbacks out of their component was found this way), a bundler config that skips
// the plugin for some files, a plugin order that changes. This reads what actually shipped.
//
// The build runs audit/site-plugin.ts FIRST, which records each host element's site and its
// owner from the source as written. Every element carrying a site is first-party; for each:
//
//   owner recorded + stamped with it      → correct
//   owner recorded + unstamped            → a miss (the failure this exists to catch)
//   owner recorded + stamped otherwise    → a misattribution
//   no owner + stamped                    → a misattribution: the plugin invented an owner
//   no owner + unstamped                  → module-scope JSX, unstamped by design, counted
//
// The rule is absolute-zero (docs/VALIDATION-PLAN.md §3.2's style): any miss or
// misattribution fails. There is no acceptable rate to invent.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { OWNER_ATTRIBUTE, SITE_ATTRIBUTE } from './site-plugin.ts';

export const COMPONENT_ATTRIBUTE = 'data-rastro-component';

export interface Finding {
  /** `file:line:column` of the JSX in the source as written. */
  site: string;
  /** The owning component according to the source; null when it has none. */
  owner: string | null;
  /** What babel-plugin-rastro stamped, if anything. */
  stampedAs: string | null;
}

export interface AuditReport {
  /** Stamped with the owner the source says. */
  stamped: Finding[];
  /** Owned by a component and not stamped. Must be empty. */
  missed: Finding[];
  /** Stamped with something other than the source's owner. Must be empty. */
  misattributed: Finding[];
  /** No owning component, not stamped — by design. */
  unowned: Finding[];
  /** `react.memo_cache_sentinel` occurrences: nonzero means the React Compiler ran. */
  compilerCacheSites: number;
}

/** A report passes when nothing it cannot excuse is left in it. */
export function passes(report: AuditReport): boolean {
  return (
    report.missed.length === 0 &&
    report.misattributed.length === 0 &&
    report.stamped.length > 0 // a bundle with nothing in it proves nothing
  );
}

const SKIPPED_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);

function isNode(value: unknown): value is t.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function visitObjects(node: t.Node, visit: (object: t.ObjectExpression) => void): void {
  if (node.type === 'ObjectExpression') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visitObjects(child, visit);
    } else if (isNode(value)) {
      visitObjects(value, visit);
    }
  }
}

function stringValue(node: t.Node | undefined): string | null {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** The string-valued properties of an object literal — the props of one jsx() call. */
function stringProps(object: t.ObjectExpression): Map<string, string> {
  const props = new Map<string, string>();
  for (const property of object.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const key = property.key.type === 'Identifier' ? property.key.name : stringValue(property.key);
    const value = stringValue(property.value);
    if (key !== null && value !== null) props.set(key, value);
  }
  return props;
}

/** Audit every `.js` file under a build directory. */
export function auditBundle(buildDir: string): AuditReport {
  const report: AuditReport = { stamped: [], missed: [], misattributed: [], unowned: [], compilerCacheSites: 0 };

  const files = readdirSync(buildDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const code = readFileSync(join(buildDir, file), 'utf8');
    report.compilerCacheSites += code.split('react.memo_cache_sentinel').length - 1;
    if (!code.includes(SITE_ATTRIBUTE)) continue;

    visitObjects(parse(code, { sourceType: 'module' }).program, (object) => {
      const props = stringProps(object);
      const site = props.get(SITE_ATTRIBUTE);
      if (site === undefined) return;

      const finding: Finding = {
        site,
        owner: props.get(OWNER_ATTRIBUTE) ?? null,
        stampedAs: props.get(COMPONENT_ATTRIBUTE) ?? null,
      };
      if (finding.owner === null) {
        (finding.stampedAs === null ? report.unowned : report.misattributed).push(finding);
      } else if (finding.stampedAs === null) report.missed.push(finding);
      else if (finding.stampedAs !== finding.owner) report.misattributed.push(finding);
      else report.stamped.push(finding);
    });
  }

  return report;
}
