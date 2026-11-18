// scripts/identity-spike/src/mark-plugin.ts
// The measurement's Babel plugin: marks every component babel-plugin-rastro names, with its
// name and file, so rule 2 can judge "touched" from the fiber tree (ancestry.ts).
//
// It used to be babel-plugin-rastro's `markComponents` option, for the marked fiber walk. That
// walk was cut after §3.2's run 2, and so was the option (docs/NOTES.md). The marks are still
// how the measurement knows every first-party component above an element, with its file, so
// they moved here. The naming rule is the plugin's own (`owningComponent`), imported rather
// than copied, so the measurement marks exactly the components the plugin stamps.
//
// One `Name.__rastroMark = { name, file }` statement after each named component's declaration,
// like a `displayName` assignment. The mark goes on the binding the developer named, so for
// `memo(...)` and `forwardRef(...)` it is on the wrapper object, where ancestry.ts reads it. The
// function itself is left syntactically untouched, so the React Compiler and Fast Refresh still
// recognise it as a component. Placed in `Program.enter`, before a compiler moves anything.
import { relative, sep } from 'node:path';
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core';
import { owningComponent, type Owner } from 'babel-plugin-rastro';
import { MARK_PROPERTY } from './fiber.ts';

export interface MarkPluginOptions {
  /** The directory a mark's `file` is relative to. Without it, marks carry no file. */
  root?: string;
}

interface MarkPluginPass extends PluginPass {
  opts: MarkPluginOptions;
}

const JSX_EXTENSIONS = /\.[jt]sx$/;

/** `filename` relative to `root`, POSIX, or null when there is no root or it lies outside it. */
export function markFile(root: string | undefined, filename: string): string | null {
  if (root === undefined || root === '') return null;
  const path = relative(root, filename).split(sep).join('/');
  return path === '' || path === '..' || path.startsWith('../') || path.startsWith('/') ? null : path;
}

/**
 * The statement that declares a component's binding, which its mark is inserted after: the
 * declaration itself, or the `const` the binding was found through. Null when the binding is
 * not declared by a statement in a block or the program, where a following statement could not
 * see it.
 */
function declaringStatement(owner: Owner): NodePath | null {
  const node = owner.path.node;
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return owner.path;

  let current: NodePath | null = owner.path.parentPath;
  while (current !== null && current.isCallExpression()) current = current.parentPath;
  const declaration = current?.parentPath ?? null;
  if (declaration === null || !declaration.isVariableDeclaration()) return null;

  const container = declaration.parentPath;
  const ok =
    container !== null &&
    (container.isProgram() || container.isBlockStatement() || container.isExportNamedDeclaration());
  return ok ? declaration : null;
}

export default function rastroCorpusMarks(babel: { types: typeof BabelTypes }): PluginObj<MarkPluginPass> {
  const t = babel.types;
  return {
    name: 'rastro-corpus-marks',
    visitor: {
      Program: {
        enter(program, state) {
          const filename = state.filename;
          if (filename === undefined || !JSX_EXTENSIONS.test(filename)) return;

          // Marked are the components that own JSX of any kind, not only host elements: one
          // that only composes others is still in every element's ancestry below it.
          const owners = new Map<BabelTypes.Node, Owner>();
          const collect = (path: NodePath): void => {
            const owner = owningComponent(path);
            if (owner !== null) owners.set(owner.path.node, owner);
          };
          program.traverse({ JSXElement: collect, JSXFragment: collect });

          const file = markFile(state.opts.root, filename);
          for (const owner of owners.values()) {
            const statement = declaringStatement(owner);
            if (statement === null) continue;
            const value = t.objectExpression([
              t.objectProperty(t.identifier('name'), t.stringLiteral(owner.name)),
              ...(file === null ? [] : [t.objectProperty(t.identifier('file'), t.stringLiteral(file))]),
            ]);
            statement.insertAfter(
              t.expressionStatement(
                t.assignmentExpression('=', t.memberExpression(t.identifier(owner.name), t.identifier(MARK_PROPERTY)), value),
              ),
            );
          }
        },
      },
    },
  };
}
