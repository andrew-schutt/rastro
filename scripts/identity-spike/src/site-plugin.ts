// scripts/identity-spike/src/site-plugin.ts
// The measurement's JSX-site stamps: every JSX element gets one prop naming the place in the
// source it was written, so the collision referee can tell repeats from distinct controls
// (site-referee.ts). Never shipped, and no strategy reads it.
//
// Why a site: the key referee (repeat-oracle.ts) has to guess which keyed lists are loops, and
// in a grid of rows × keyed columns no guess is right for both. A site needs no guess. Every
// copy of one control is one line of JSX run many times, and two different controls are two
// lines. The site is `file:line:column`, deterministic per build, so equal means "the same JSX".
//
// The value is a registered symbol, `Symbol.for(site)`, for two reasons:
//
// - React DOM drops a symbol-valued unknown prop instead of writing an attribute
//   (`setValueForAttribute`), so the stamp never reaches the DOM, the selector path, or any
//   fingerprint. A string would.
// - It is one value per site, hoisted to a module constant, so `memo` comparisons and the React
//   Compiler's memoization see the same value on every render.
//
// The prop goes LAST, after any spread, so an element's own site wins over one carried in props
// it was handed. Stamps a component forwards into code that is not stamped (a library spreading
// `{...props}`) still arrive there. site-referee.ts discounts those.
//
// Fragments are left alone: React accepts only `key` and `children` on one.
import { relative, sep } from 'node:path';
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core';
import { SITE_PROPERTY } from './fiber.ts';

export interface SitePluginOptions {
  /** The directory a site's file is relative to. Without it, the full filename is used. */
  root?: string;
}

interface SitePluginPass extends PluginPass {
  opts: SitePluginOptions;
}

const JSX_EXTENSIONS = /\.[jt]sx$/;

/** `filename` relative to `root`, POSIX. Unique within one build either way, which is all a site needs. */
export function siteFile(root: string | undefined, filename: string): string {
  if (root === undefined || root === '') return filename.split(sep).join('/');
  return relative(root, filename).split(sep).join('/');
}

/** `Fragment` and `React.Fragment`, or any `X.Fragment`: React takes no other props on one. */
function isFragment(name: BabelTypes.JSXOpeningElement['name']): boolean {
  if (name.type === 'JSXIdentifier') return name.name === 'Fragment';
  return name.type === 'JSXMemberExpression' && name.property.name === 'Fragment';
}

export default function rastroCorpusSites(babel: { types: typeof BabelTypes }): PluginObj<SitePluginPass> {
  const t = babel.types;
  return {
    name: 'rastro-corpus-sites',
    visitor: {
      Program: {
        // In Program.enter, before a compiler rewrites anything, like the marks (mark-plugin.ts).
        enter(program, state) {
          const filename = state.filename;
          if (filename === undefined || !JSX_EXTENSIONS.test(filename)) return;
          const file = siteFile(state.opts.root, filename);

          const constants: BabelTypes.VariableDeclarator[] = [];
          program.traverse({
            JSXOpeningElement(path: NodePath<BabelTypes.JSXOpeningElement>) {
              const { node } = path;
              const start = node.loc?.start;
              if (start === undefined || isFragment(node.name)) return;
              const id = program.scope.generateUidIdentifier('rastroSite');
              const site = `${file}:${start.line}:${start.column + 1}`;
              constants.push(
                t.variableDeclarator(
                  id,
                  t.callExpression(t.memberExpression(t.identifier('Symbol'), t.identifier('for')), [t.stringLiteral(site)]),
                ),
              );
              node.attributes.push(t.jsxAttribute(t.jsxIdentifier(SITE_PROPERTY), t.jsxExpressionContainer(t.cloneNode(id))));
            },
          });
          if (constants.length === 0) return;

          // After the imports, so the module's own statements are where they were.
          const declaration = t.variableDeclaration('const', constants);
          const body = program.get('body');
          const lastImport = body.filter((statement) => statement.isImportDeclaration()).at(-1);
          if (lastImport === undefined) program.unshiftContainer('body', declaration);
          else lastImport.insertAfter(declaration);
        },
      },
    },
  };
}
