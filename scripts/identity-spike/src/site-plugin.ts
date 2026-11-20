// scripts/identity-spike/src/site-plugin.ts
// The measurement's JSX-site stamps: every JSX element is recorded with the place in the source
// it was written, so the collision referee can tell repeats from distinct controls
// (site-referee.ts). Never shipped, and no strategy reads it.
//
// Why a site: the key referee (repeat-oracle.ts) has to guess which keyed lists are loops, and
// in a grid of rows × keyed columns no guess is right for both. A site needs no guess. Every
// copy of one control is one line of JSX run many times, and two different controls are two
// lines. The site is `file:line:column`, deterministic per build, so equal means "the same JSX".
//
// THE STAMP IS NOT A PROP. Each JSX expression is wrapped in a call that records its element's
// props object in a page-wide WeakMap (`SITE_REGISTRY`), and returns the element unchanged.
// React keeps that same object as the fiber's `memoizedProps`, which is where the referee looks
// it up. The first version added a prop instead, and Actual crashed: a component passes its
// props to emotion's `css()`, which turns every value into a string. Any value in props can
// reach code like that. Nothing here changes what the app's own code sees.
//
// A spread or `cloneElement` makes a new props object, which carries no site. So a component
// forwarding its props into code the build did not stamp hands nothing on.
//
// Fragments are left alone: React keeps only a fragment's children, never its props object.
import { relative, sep } from 'node:path';
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core';
import { SITE_REGISTRY } from './fiber.ts';

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

/** `Fragment` and `React.Fragment`, or any `X.Fragment`. */
function isFragment(name: BabelTypes.JSXOpeningElement['name']): boolean {
  if (name.type === 'JSXIdentifier') return name.name === 'Fragment';
  return name.type === 'JSXMemberExpression' && name.property.name === 'Fragment';
}

/**
 * The helper each file declares: record the element's props, return the element. A function
 * declaration, so it is hoisted above any module-level JSX.
 */
function helperSource(name: string): string {
  return (
    `function ${name}(element, site) {` +
    ` if (element !== null && typeof element === 'object' && typeof element.props === 'object' && element.props !== null)` +
    ` (globalThis.${SITE_REGISTRY} || (globalThis.${SITE_REGISTRY} = new WeakMap())).set(element.props, site);` +
    ' return element; }'
  );
}

export default function rastroCorpusSites(babel: {
  types: typeof BabelTypes;
  template: typeof import('@babel/core').template;
}): PluginObj<SitePluginPass> {
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
          const helper = program.scope.generateUidIdentifier('rastroSite');
          const wrapped = new WeakSet<BabelTypes.Node>();
          let any = false;

          program.traverse({
            JSXElement: {
              // On exit, so children are wrapped first. The element node itself is kept, inside
              // the call, and remembered so the requeued node is not wrapped twice.
              exit(path: NodePath<BabelTypes.JSXElement>) {
                const { node } = path;
                const start = node.openingElement.loc?.start;
                if (wrapped.has(node) || start === undefined || isFragment(node.openingElement.name)) return;
                wrapped.add(node);
                any = true;
                const site = `${file}:${start.line}:${start.column + 1}`;
                const call = t.callExpression(t.cloneNode(helper), [node, t.stringLiteral(site)]);
                const inJsx = path.parentPath.isJSXElement() || path.parentPath.isJSXFragment() || path.parentPath.isJSXAttribute();
                path.replaceWith(inJsx ? t.jsxExpressionContainer(call) : call);
              },
            },
          });
          if (!any) return;
          program.unshiftContainer('body', babel.template.statement.ast(helperSource(helper.name)));
        },
      },
    },
  };
}
