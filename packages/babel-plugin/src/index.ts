// packages/babel-plugin/src/index.ts
// Build-time component annotation (docs/DESIGN.md §4.3).
//
// The runtime fiber walk (§4.2.1) reads `fn.name` off React's internals, and a production
// bundle renames `SaveButton` to `t` — so unrelated elements collapse into one identity,
// silently. That is the single most important limitation of the tool, and no runtime trick
// fixes it: React DevTools reads the same internals, stack traces are minified too, and
// source maps are not available at runtime. Names have to be captured before the minifier
// runs, which is what this does.
//
// It stamps the component that OWNS each host element into a data attribute, as a string
// literal that minification cannot touch. The SDK then reconstructs the ancestry by walking
// the DOM instead of the fiber tree:
//
//   function SettingsForm() {          <form  data-rastro-component="SettingsForm">
//     return <form>                      <button data-rastro-component="SaveButton">
//       <SaveButton />         ──▶     → walking up from the button yields
//     </form>;                           ["SaveButton", "SettingsForm"]
//   }                                    → SettingsForm>SaveButton
import { relative, sep } from 'node:path';
import type { NodePath, PluginObj, PluginPass } from '@babel/core';
import type * as BabelTypes from '@babel/types';

/** Where the owning component's name lands. Read by `attributeChain` in `rastro-core`. */
export const COMPONENT_ATTRIBUTE = 'data-rastro-component';

/**
 * Where the defining file lands. This is the rename-proof half: renaming a component changes
 * its name but does not move the file, so source location survives exactly the refactor that
 * mints a new identity everywhere else (§4.3, docs/IDENTITY-RESOLUTION.md).
 */
export const SOURCE_FILE_ATTRIBUTE = 'data-rastro-source-file';

/** Only these are transformed. Annotating a `.ts` file's JSX-free source is pure overhead. */
const JSX_EXTENSIONS = /\.[jt]sx$/;

export interface RastroPluginOptions {
  /** Attribute for the owning component's name. Default `data-rastro-component`. */
  componentAttribute?: string;
  /** Attribute for the defining file. Default `data-rastro-source-file`. */
  sourceFileAttribute?: string;
  /** Emit the source-file attribute at all. Default `true`. */
  includeSourceFile?: boolean;
  /**
   * The directory source paths are relativized against. Defaults to Babel's `root`, which
   * itself falls back to the process's cwd.
   *
   * Set it wherever the build can be launched from more than one directory, because that
   * default is only as pinned as the toolchain makes it. Vite pins it in practice — its root
   * is where `index.html` is resolved from, so a build launched elsewhere fails outright
   * rather than stamping a different path — but a plain Babel, babel-loader, or Next build has
   * no such anchor, and there `root` follows cwd and the stamped path follows with it: one
   * identity set per directory somebody happened to run the build from.
   */
  root?: string;
}

/**
 * The source path as it gets stamped: repo-relative with POSIX separators, or null when the
 * file does not sit under the root at all.
 *
 * Both halves are identity correctness, not tidiness. `relative()` returns the host's
 * separators, so an unnormalized Windows build stamps `src\Nav.tsx` where CI stamps
 * `src/Nav.tsx` — two disjoint identity sets for one line of source, which is the churn this
 * whole path exists to prevent. And a file outside the root comes back as `../../shared/x.tsx`
 * (relative to the launch directory again) or, across Windows drives, as an absolute path,
 * which `SEMANTIC-CONVENTIONS.md` forbids outright: it leaks the build machine's filesystem
 * into telemetry. Stamping nothing costs that element its source-file qualifier and leaves it
 * with the plain component chain, which is what an unannotated build already produces.
 */
export function sourceFilePath(root: string | undefined | null, filename: string): string | null {
  if (root === undefined || root === null || root === '') return null;
  return toStampedPath(relative(root, filename));
}

/** A POSIX path from the filesystem root, or a Windows one from a drive. Neither is stampable. */
const ABSOLUTE = /^([a-zA-Z]:)?\//;

/**
 * One `relative()` result, in the form it gets stamped — or null if it must not be.
 *
 * Split from `sourceFilePath` so each rejection is testable on any platform: `relative()` on
 * Linux cannot produce a backslash or a drive letter, so a guard written against the host's
 * own output would ship untested and CI is Linux-only.
 *
 * `separator` is the host's, and the conversion is conditioned on it rather than replacing
 * every backslash outright, because a backslash is a legal character in a POSIX filename and
 * rewriting it there would invent a directory that does not exist.
 */
export function toStampedPath(relativePath: string, separator: string = sep): string | null {
  const posixPath = separator === '\\' ? relativePath.split('\\').join('/') : relativePath;

  if (posixPath === '') return null;
  if (posixPath === '..' || posixPath.startsWith('../')) return null;
  if (ABSOLUTE.test(posixPath)) return null;

  return posixPath;
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

/**
 * The nearest enclosing component, by name.
 *
 * Walks up from the JSX element through every function and class until one is capitalised.
 * Anonymous functions and lowercase helpers are transparent — the search continues past them,
 * so JSX inside a `renderRow()` helper is attributed to the component that owns it.
 */
function owningComponent(path: NodePath<BabelTypes.JSXOpeningElement>): string | null {
  let current: NodePath | null = path.parentPath;

  while (current !== null) {
    if (isFunctionOrClass(current.node)) {
      const name = boundName(current);
      if (name !== null && isComponentName(name)) return name;
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

  return {
    name: 'rastro-component-annotate',

    visitor: {
      JSXOpeningElement(path, state) {
        const filename = state.filename;
        if (filename === undefined || !JSX_EXTENSIONS.test(filename)) return;
        if (!isHostElement(path.node.name)) return;

        const {
          componentAttribute = COMPONENT_ATTRIBUTE,
          sourceFileAttribute = SOURCE_FILE_ATTRIBUTE,
          includeSourceFile = true,
          root: configuredRoot,
        } = state.opts;

        if (hasAttribute(path.node, componentAttribute)) return;

        const component = owningComponent(path);
        if (component === null) return; // JSX outside any component — nothing meaningful to say

        // Appended, so an explicit attribute or a later spread still wins by source order.
        path.node.attributes.push(attribute(componentAttribute, component));

        if (includeSourceFile && !hasAttribute(path.node, sourceFileAttribute)) {
          // The PROJECT root, not the process's cwd. This path is part of the fingerprint, so
          // relativizing against wherever the build was launched from would mint a different
          // identity for every element depending on the directory — CI running from a monorepo
          // root and a developer running from the package would produce two disjoint identity
          // sets for identical code, churn with no signal behind it.
          //
          // The `root` option first, because Babel's own `root` is only pinned to the extent
          // the toolchain pins it — it defaults to `cwd`, and outside Vite (where the root has
          // to be wherever `index.html` is) nothing anchors it to the project.
          const file = sourceFilePath(configuredRoot ?? state.file.opts.root ?? state.cwd, filename);
          if (file !== null) path.node.attributes.push(attribute(sourceFileAttribute, file));
        }
      },
    },
  };
}
