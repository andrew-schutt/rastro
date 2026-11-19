// scripts/identity-spike/scoring/touched.ts
// Rule 2's "touched", component-level, as pre-registered in this directory's README (item 1).
//
// A commit pair touches an element when the app's own diff changes a line inside the definition
// of any component in the element's recorded ancestry. A component's definition is the
// statement that declares it, by the plugin's own rule (babel-plugin-rastro, `boundName` and
// `declaringStatement`): a capitalised function or class declaration, or a `const` bound to a
// function or class, through any number of wrapping calls (`memo(forwardRef(...))`). Those are
// exactly the components the plugin marks, so every name in an ancestry has one.
//
// Undetermined is its own answer and never collapses into touched: a component that cannot be
// found, or is found twice, gets investigated by hand like untouched churn.
import { parseSync, type types as t } from '@babel/core';
import { extname, posix } from 'node:path';
import type { ComponentMark } from '../src/fiber.ts';

export type Touch = 'touched' | 'untouched' | 'undetermined';

/** One hunk's old side, from `git diff -U0`: `count` lines from `start`. Count 0 is an insertion after `start`. */
export interface Hunk {
  start: number;
  count: number;
}

/** What touching needs from the app's repository, for one commit pair. */
export interface PairDiff {
  /** Files the pair's diff changes, renames counted as delete plus add. */
  changed: ReadonlySet<string>;
  /** Files the pair's diff deletes. A deleted file's components are all touched. */
  deleted: ReadonlySet<string>;
  hunks: (path: string) => Hunk[];
  /** A file at the older commit, or null when it does not exist there. */
  before: (path: string) => string | null;
}

/** Old-side hunks from `git diff -U0` output for one file. */
export function parseHunks(diff: string): Hunk[] {
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)].map(([, start, count]) => ({
    start: Number(start),
    count: count === undefined ? 1 : Number(count),
  }));
}

/** Lines `start`..`end` inclusive. */
export interface Range {
  start: number;
  end: number;
}

/** Does any hunk change a line of `range`, or insert lines strictly inside it? */
export function overlaps(range: Range, hunks: readonly Hunk[]): boolean {
  return hunks.some(({ start, count }) =>
    count === 0 ? start >= range.start && start < range.end : start <= range.end && start + count - 1 >= range.start,
  );
}

const isFunctionOrClass = (node: t.Node | null | undefined): boolean =>
  node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression' || node?.type === 'ClassExpression';

/** A declarator's init, climbing through wrapping calls to the function or class inside. */
function definesComponent(init: t.Expression | null | undefined): boolean {
  let current: t.Node | null | undefined = init;
  while (current?.type === 'CallExpression') {
    current = current.arguments.find((argument) => isFunctionOrClass(argument) || argument.type === 'CallExpression');
  }
  return isFunctionOrClass(current);
}

/** Every declaring statement's line range in `source`, by component name. */
export function componentRanges(source: string, filename: string): Map<string, Range[]> {
  const typescript = ['.ts', '.tsx', '.mts', '.cts'].includes(extname(filename));
  const jsx = extname(filename) !== '.ts';
  const ast = parseSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    sourceType: 'unambiguous',
    parserOpts: { plugins: [...(jsx ? (['jsx'] as const) : []), ...(typescript ? (['typescript'] as const) : [])] },
  });
  const ranges = new Map<string, Range[]>();
  const add = (name: string, node: t.Node) => {
    if (!/^[A-Z]/.test(name) || node.loc === null || node.loc === undefined) return;
    ranges.set(name, [...(ranges.get(name) ?? []), { start: node.loc.start.line, end: node.loc.end.line }]);
  };
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as t.Node;
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) add(n.id.name, n);
    if (n.type === 'VariableDeclaration') {
      for (const declarator of n.declarations) {
        if (declarator.id.type === 'Identifier' && definesComponent(declarator.init)) add(declarator.id.name, n);
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key !== 'loc' && key !== 'leadingComments' && key !== 'trailingComments') visit(value);
    }
  };
  if (ast !== null) visit(ast.program);
  return ranges;
}

/** How one commit pair touches one component, found at `root`-relative `mark.file`. */
export function touchComponent(mark: ComponentMark, root: string, diff: PairDiff): Touch {
  if (mark.file === undefined) return 'undetermined';
  const path = posix.join(root, mark.file);
  if (!diff.changed.has(path)) return 'untouched';
  if (diff.deleted.has(path)) return 'touched';
  const source = diff.before(path);
  if (source === null) return 'undetermined';
  let found: Range[] | undefined;
  try {
    found = componentRanges(source, path).get(mark.name);
  } catch {
    return 'undetermined';
  }
  if (found === undefined || found.length !== 1) return 'undetermined';
  return overlaps(found[0]!, diff.hunks(path)) ? 'touched' : 'untouched';
}

/**
 * An element's touch, from its whole ancestry: touched if any component is, otherwise
 * undetermined if any component is, otherwise untouched. `file` is the file-level answer,
 * reported beside it and never judged.
 */
export function touchAncestry(
  ancestry: readonly ComponentMark[],
  root: string,
  diff: PairDiff,
): { touch: Touch; fileLevel: boolean } {
  const touches = ancestry.map((mark) => touchComponent(mark, root, diff));
  const fileLevel = ancestry.some((mark) => mark.file !== undefined && diff.changed.has(posix.join(root, mark.file)));
  const touch = touches.includes('touched') ? 'touched' : touches.includes('undetermined') ? 'undetermined' : 'untouched';
  return { touch, fileLevel };
}
