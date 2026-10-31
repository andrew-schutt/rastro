// examples/stamp-fixture/audit/site-plugin.ts
// The audit's half of the build: a Babel plugin that runs FIRST, on the source as written, and
// records on every host element where it came from and which component owns it:
//
//   data-audit-site="src/patterns.tsx:43:8"   data-audit-owner="ColorList"
//
// babel-plugin-rastro then stamps (or fails to stamp) `data-rastro-component` on the same
// element, and the audit compares the two in the shipped bundle. Recording the owner up front
// is what makes the comparison trustworthy: by the time the bundle exists, the React Compiler
// has rewritten the code and its source maps no longer point at the element they came from.
//
// The owner rule is written here independently of the plugin's own, so a bug in the plugin's
// cannot hide itself. Audit builds only — this adds attributes to the DOM.
import { relative } from 'node:path';
import type { NodePath, PluginObj, PluginPass, types as t } from '@babel/core';

export const SITE_ATTRIBUTE = 'data-audit-site';
export const OWNER_ATTRIBUTE = 'data-audit-owner';

const isCapitalised = (name: string): boolean => /^[A-Z]/.test(name);

/**
 * The owner React itself would recognise: the nearest enclosing function or class whose name
 * is capitalised. A function's name is its own declaration's, or the binding it is assigned to
 * through any number of wrapper calls (`memo(forwardRef(...))`). Lowercase and anonymous
 * functions are transparent; class methods are never components.
 */
export function ownerOf(ancestors: readonly t.Node[]): string | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (node === undefined) continue;
    let name: string | null = null;

    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
      name = node.id.name;
    } else if (
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'ClassExpression'
    ) {
      let j = i - 1;
      while (ancestors[j]?.type === 'CallExpression') j--;
      const binding = ancestors[j];
      if (binding?.type === 'VariableDeclarator' && binding.id.type === 'Identifier') {
        name = binding.id.name;
      }
    }

    if (name !== null && isCapitalised(name)) return name;
  }
  return null;
}

function ancestorsOf(path: NodePath): t.Node[] {
  const ancestors: t.Node[] = [];
  for (let current = path.parentPath; current !== null; current = current.parentPath) {
    ancestors.unshift(current.node);
  }
  return ancestors;
}

export default function auditSitePlugin({ types }: { types: typeof t }): PluginObj<PluginPass & { opts: { root?: string } }> {
  const attribute = (name: string, value: string): t.JSXAttribute =>
    types.jsxAttribute(types.jsxIdentifier(name), types.stringLiteral(value));

  return {
    name: 'rastro-audit-site',
    visitor: {
      Program: {
        enter(program, state) {
          const file = relative(state.opts.root ?? state.cwd, state.filename ?? 'unknown');
          program.traverse({
            JSXOpeningElement(path) {
              const { name, loc } = path.node;
              if (name.type !== 'JSXIdentifier' || isCapitalised(name.name)) return;
              const site = `${file}:${loc?.start.line ?? 0}:${loc?.start.column ?? 0}`;
              path.node.attributes.push(attribute(SITE_ATTRIBUTE, site));
              const owner = ownerOf(ancestorsOf(path));
              if (owner !== null) path.node.attributes.push(attribute(OWNER_ATTRIBUTE, owner));
            },
          });
        },
      },
    },
  };
}
