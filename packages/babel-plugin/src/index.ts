// packages/babel-plugin/src/index.ts
// Build-time component annotation (docs/DESIGN.md §4.3).
//
// A component's name has to be captured before the minifier runs: a production bundle renames
// `SaveButton` to `t`, and nothing at runtime can recover it. React DevTools reads the same
// internals, stack traces are minified too, and source maps are not available at runtime.
//
// So this stamps the component that OWNS each host element into a data attribute, as a string
// literal that minification cannot touch. The SDK then reconstructs the ancestry by walking
// the DOM:
//
//   function SettingsForm() {          <form  data-rastro-component="SettingsForm">
//     return <form>                      <button data-rastro-component="SaveButton">
//       <SaveButton />         ──▶     → walking up from the button yields
//     </form>;                           ["SaveButton", "SettingsForm"]
//   }                                    → SettingsForm>SaveButton
//
// That chain is all it stamps. It used to stamp the defining file, and could attach marks for a
// fiber walk. Both were removed after §3.2's run 2 (docs/NOTES.md).
import type { NodePath, PluginObj, PluginPass } from '@babel/core';
import type * as BabelTypes from '@babel/types';

/** Where the owning component's name lands. Read by `attributeChain` in `rastro-core`. */
export const COMPONENT_ATTRIBUTE = 'data-rastro-component';

/** Only these are transformed. Annotating a `.ts` file's JSX-free source is pure overhead. */
const JSX_EXTENSIONS = /\.[jt]sx$/;

export interface RastroPluginOptions {
  /** Attribute for the owning component's name. Default `data-rastro-component`. */
  componentAttribute?: string;
}

interface RastroPluginPass extends PluginPass {
  opts: RastroPluginOptions;
}

/**
 * Is this a component name?
 *
 * React's own rule: capitalised is a component, lowercase is a host element or a helper. A
 * lowercase helper that returns JSX is deliberately skipped rather than named, so its markup
 * is attributed to the component that contains it — which is the identity a user would
 * recognise.
 */
function isComponentName(name: string): boolean {
  const first = name[0];
  return first !== undefined && first >= 'A' && first <= 'Z';
}

/** Is this node something that can own JSX — a function or a class? */
function isFunctionOrClass(node: BabelTypes.Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod'
  );
}

/**
 * The name a function or class is known by — declared, or assigned to a binding.
 *
 * The call-expression climb is what makes `const SaveButton = memo(() => …)` work: the arrow's
 * immediate parent is the `memo(...)` call, not the declarator. Wrappers nest in practice
 * (`memo(forwardRef(...))`), so it climbs through as many as it finds.
 */
function boundName(path: NodePath): string | null {
  const node = path.node;
  if (
    (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
    node.id !== null &&
    node.id !== undefined
  ) {
    return node.id.name;
  }

  let current: NodePath | null = path.parentPath;
  while (current !== null && current.isCallExpression()) current = current.parentPath;

  if (current !== null && current.isVariableDeclarator()) {
    const id = current.node.id;
    if (id.type === 'Identifier') return id.name;
  }

  return null;
}

/** A component the plugin names, and the function or class that defines it. */
export interface Owner {
  name: string;
  path: NodePath;
}

/**
 * The nearest enclosing component, by name: the plugin's naming rule.
 *
 * Exported for the identity spike (`scripts/identity-spike`), whose measurement marks every
 * component this names. Sharing the rule keeps the measurement from drifting from the plugin.
 *
 * Walks up from the JSX element through every function and class until one is capitalised.
 * Anonymous functions and lowercase helpers are transparent — the search continues past them,
 * so JSX inside a `renderRow()` helper is attributed to the component that owns it.
 */
export function owningComponent(path: NodePath): Owner | null {
  let current: NodePath | null = path.parentPath;

  while (current !== null) {
    if (isFunctionOrClass(current.node)) {
      const name = boundName(current);
      if (name !== null && isComponentName(name)) return { name, path: current };
    }
    current = current.parentPath;
  }

  return null;
}

/**
 * A host element (`div`, `button`) rather than a component (`<SaveButton />`).
 *
 * ⚠ Deliberately host-only. Annotating `<SaveButton />` would pass the attribute as a *prop*,
 * and a component that does not spread its props onto a DOM node would silently drop it —
 * while one that spreads onto a non-DOM target could warn or break. Host-only is also
 * sufficient: every component that renders anything eventually renders a host element, so DOM
 * nesting reconstructs the chain without ever touching a component's props.
 */
function isHostElement(name: BabelTypes.JSXOpeningElement['name']): boolean {
  return name.type === 'JSXIdentifier' && !isComponentName(name.name);
}

/** Does this element already carry `attribute`? Authors win, and double-transforms are safe. */
function hasAttribute(element: BabelTypes.JSXOpeningElement, attribute: string): boolean {
  return element.attributes.some(
    (attr) =>
      attr.type === 'JSXAttribute' &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name === attribute,
  );
}

export default function rastroComponentAnnotate(babel: {
  types: typeof BabelTypes;
}): PluginObj<RastroPluginPass> {
  const t = babel.types;

  const attribute = (name: string, value: string): BabelTypes.JSXAttribute =>
    t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));

  const stamp = (path: NodePath<BabelTypes.JSXOpeningElement>, state: RastroPluginPass): void => {
    const filename = state.filename;
    if (filename === undefined || !JSX_EXTENSIONS.test(filename)) return;
    if (!isHostElement(path.node.name)) return;

    const { componentAttribute = COMPONENT_ATTRIBUTE } = state.opts;
    if (hasAttribute(path.node, componentAttribute)) return;

    const component = owningComponent(path)?.name ?? null;
    if (component === null) return; // JSX outside any component — nothing meaningful to say

    // Appended, so an explicit attribute or a later spread still wins by source order.
    path.node.attributes.push(attribute(componentAttribute, component));
  };

  return {
    name: 'rastro-component-annotate',

    visitor: {
      // The whole file is stamped up front, in `Program.enter`, not element by element as the
      // main traversal reaches each one. The owner is read off the source's lexical structure,
      // so it has to be read before any other plugin rearranges that structure — and the React
      // Compiler rewrites every function in its own `Program.enter`, hoisting `.map()`
      // callbacks into top-level `_temp` functions. Visited per element, JSX inside those
      // callbacks has already lost its capitalised ancestor and is silently left unstamped:
      // exactly the list rows identity has the most trouble with.
      //
      // ⚠ This wins only if this plugin's `Program.enter` runs first. Babel runs plugins
      // before presets and plugins in listed order, so list this plugin before the compiler
      // (or pass the compiler as a preset). Listed after it, nothing here can recover.
      Program: {
        enter(program, state) {
          program.traverse({ JSXOpeningElement: (path) => stamp(path, state) });
        },
      },
    },
  };
}
