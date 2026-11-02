// packages/babel-plugin/src/index.test.ts
// Transform in, transformed source out. Pure — no DOM, no React, no bundler.
import {
  transformSync,
  type PluginObj,
  type TransformOptions,
  type types as BabelTypes,
} from '@babel/core';
import { describe, expect, it } from 'vitest';
import rastroComponentAnnotate, {
  COMPONENT_ATTRIBUTE,
  MARK_PROPERTY,
  SOURCE_FILE_ATTRIBUTE,
  sourceFilePath,
  toStampedPath,
  type RastroPluginOptions,
} from './index.js';

function transform(
  source: string,
  options: RastroPluginOptions = {},
  filename = '/repo/src/SettingsForm.tsx',
): string {
  const result = transformSync(source, {
    filename,
    cwd: '/repo',
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [[rastroComponentAnnotate, options]],
  });
  return result?.code ?? '';
}

describe('rastro-component-annotate', () => {
  it('stamps the owning component onto a host element', () => {
    const out = transform(`function SettingsForm() { return <form />; }`);
    expect(out).toContain(`${COMPONENT_ATTRIBUTE}="SettingsForm"`);
  });

  it('stamps the source file, relative to the project root', () => {
    const out = transform(`function SettingsForm() { return <form />; }`);
    expect(out).toContain(`${SOURCE_FILE_ATTRIBUTE}="src/SettingsForm.tsx"`);
  });

  // The path is part of the fingerprint, so a build launched from the monorepo root and one
  // launched from the package directory must not mint two identity sets for the same source.
  // Vite hands Babel a `root` and no `cwd`; this pins that `root` is what wins.
  it('relativizes against the project root, NOT the directory the build ran in', () => {
    const out =
      transformSync(`function SettingsForm() { return <form />; }`, {
        filename: '/repo/packages/app/src/SettingsForm.tsx',
        root: '/repo/packages/app',
        cwd: '/repo',
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [rastroComponentAnnotate],
      })?.code ?? '';
    expect(out).toContain(`${SOURCE_FILE_ATTRIBUTE}="src/SettingsForm.tsx"`);
  });

  it('annotates every host element in the component, not just the root', () => {
    const out = transform(
      `function SettingsForm() { return <form><input /><span /></form>; }`,
    );
    expect(out.match(new RegExp(`${COMPONENT_ATTRIBUTE}="SettingsForm"`, 'g'))).toHaveLength(3);
  });

  // The load-bearing one: the chain is reconstructed from DOM nesting, so nested components
  // must each stamp their own name onto the host elements they render.
  it('attributes nested components separately, which is what makes a chain derivable', () => {
    const out = transform(
      `function SaveButton() { return <button>Save</button>; }
       function SettingsForm() { return <form><SaveButton /></form>; }`,
    );
    expect(out).toContain(`<button ${COMPONENT_ATTRIBUTE}="SaveButton"`);
    expect(out).toContain(`<form ${COMPONENT_ATTRIBUTE}="SettingsForm"`);
  });

  it('leaves component elements alone — an attribute there would become a prop', () => {
    const out = transform(`function SettingsForm() { return <SaveButton />; }`);
    expect(out).not.toContain(COMPONENT_ATTRIBUTE);
  });

  it('names the component, not a lowercase helper that returns JSX', () => {
    const out = transform(
      `function SettingsForm() {
         const renderRow = () => <li />;
         return <ul>{renderRow()}</ul>;
       }`,
    );
    expect(out).toContain(`<li ${COMPONENT_ATTRIBUTE}="SettingsForm"`);
    expect(out).not.toContain('"renderRow"');
  });

  it('handles arrow components assigned to a capitalised binding', () => {
    const out = transform(`const SettingsForm = () => <form />;`);
    expect(out).toContain(`${COMPONENT_ATTRIBUTE}="SettingsForm"`);
  });

  it('handles class components', () => {
    const out = transform(
      `class SettingsForm extends Component { render() { return <form />; } }`,
    );
    expect(out).toContain(`${COMPONENT_ATTRIBUTE}="SettingsForm"`);
  });

  it('sees through memo() and forwardRef() to the binding name', () => {
    const out = transform(`const SaveButton = memo(() => <button />);`);
    expect(out).toContain(`${COMPONENT_ATTRIBUTE}="SaveButton"`);
  });

  it('leaves an author-supplied attribute untouched, so an override always wins', () => {
    const out = transform(
      `function SettingsForm() { return <form ${COMPONENT_ATTRIBUTE}="Checkout" />; }`,
    );
    expect(out).toContain('"Checkout"');
    expect(out).not.toContain('"SettingsForm"');
  });

  it('is idempotent — a double transform adds nothing', () => {
    const once = transform(`function SettingsForm() { return <form />; }`);
    const twice = transform(once);
    expect(twice.match(new RegExp(COMPONENT_ATTRIBUTE, 'g'))).toHaveLength(1);
  });

  it('skips JSX that belongs to no component at all', () => {
    const out = transform(`export const icon = <svg />;`);
    expect(out).not.toContain(COMPONENT_ATTRIBUTE);
  });

  it('skips files that are not .jsx/.tsx', () => {
    const out = transform(
      `function SettingsForm() { return <form />; }`,
      {},
      '/repo/src/SettingsForm.ts',
    );
    expect(out).not.toContain(COMPONENT_ATTRIBUTE);
  });

  it('honours custom attribute names', () => {
    const out = transform(`function SettingsForm() { return <form />; }`, {
      componentAttribute: 'data-x-component',
      includeSourceFile: false,
    });
    expect(out).toContain('data-x-component="SettingsForm"');
    expect(out).not.toContain(SOURCE_FILE_ATTRIBUTE);
  });

  // What the whole plugin exists for: these names are string literals in the output, so a
  // minifier renaming the FUNCTION cannot touch them (docs/DESIGN.md §4.3).
  it('emits the name as a string literal, which is what survives minification', () => {
    const out = transform(`function SettingsForm() { return <form />; }`);
    expect(out).toMatch(/"SettingsForm"/);
  });

  // Babel's `root` defaults to cwd, and outside Vite nothing anchors it to the project — a
  // babel-loader or Next build relativizes against wherever it was launched. The option is
  // where that guarantee can be made without depending on the toolchain.
  it('lets the root be pinned explicitly, over the one Babel was given', () => {
    const out = transformSync(`function SettingsForm() { return <form />; }`, {
      filename: '/repo/packages/app/src/SettingsForm.tsx',
      root: '/repo',
      cwd: '/repo',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      plugins: [[rastroComponentAnnotate, { root: '/repo/packages/app' }]],
    })?.code;
    expect(out).toContain(`${SOURCE_FILE_ATTRIBUTE}="src/SettingsForm.tsx"`);
  });
});

/**
 * A stand-in for the React Compiler's one behaviour that matters here: in `Program.enter` it
 * rewrites every function, hoisting a `.map()` callback out of its component into a top-level
 * `_temp` function. JSX inside that callback no longer has a capitalised ancestor, so a plugin
 * that stamps per element — visiting JSX after the compiler has run — finds no owner and
 * silently stamps nothing. Found building Actual Budget (docs/VALIDATION-PLAN.md §3.2), where
 * the date picker's `<option>`s and list rows lost their identity this way.
 */
function hoistingCompiler({ types: t }: { types: typeof BabelTypes }): PluginObj {
  return {
    name: 'stand-in-react-compiler',
    visitor: {
      Program: {
        enter(program) {
          program.traverse({
            CallExpression(call) {
              const callee = call.node.callee;
              if (
                callee.type !== 'MemberExpression' ||
                callee.property.type !== 'Identifier' ||
                callee.property.name !== 'map'
              ) {
                return;
              }
              const [callback] = call.get('arguments');
              if (callback === undefined || !callback.isArrowFunctionExpression()) return;

              const { params, body } = callback.node;
              const block = t.isExpression(body)
                ? t.blockStatement([t.returnStatement(body)])
                : body;
              const id = program.scope.generateUidIdentifier('temp');
              program.pushContainer('body', t.functionDeclaration(id, params, block));
              callback.replaceWith(t.identifier(id.name));
            },
          });
        },
      },
    },
  };
}

// markComponents: the marks the §3.2 marked fiber walk (strategy 6) reads.
describe('markComponents', () => {
  const marked = (source: string, options: RastroPluginOptions = {}): string =>
    transform(source, { markComponents: true, ...options });
  const markOf = (name: string, file = 'src/SettingsForm.tsx'): string =>
    `${name}.${MARK_PROPERTY} = {\n  name: "${name}",\n  file: "${file}"\n};`;

  it('is off by default', () => {
    expect(transform(`function SettingsForm() { return <form />; }`)).not.toContain(MARK_PROPERTY);
  });

  it('marks a declared component right after its declaration', () => {
    const out = marked(`function SettingsForm() { return <form />; }`);
    expect(out).toContain(`}\n${markOf('SettingsForm')}`);
  });

  it('marks exported and default-exported declarations', () => {
    const out = marked(`export function A() { return <a />; }\nexport default function B() { return <b />; }`);
    expect(out).toContain(markOf('A'));
    expect(out).toContain(markOf('B'));
  });

  // The binding the developer named is what gets marked, so a wrapped component is marked on
  // its wrapper object. rastro-core reads it there (fiber.elementType, or fiber.type).
  it('marks the binding of a memo, forwardRef, or nested wrapper, not the inner function', () => {
    const out = marked(
      `const A = memo(() => <a />);\nconst B = forwardRef((p, r) => <b ref={r} />);\nconst C = memo(forwardRef(function Inner() { return <c />; }));`,
    );
    expect(out).toContain(`const A = memo(() => <a`);
    expect(out).toContain(markOf('A'));
    expect(out).toContain(markOf('B'));
    expect(out).toContain(markOf('C'));
    expect(out).not.toContain('Inner.');
  });

  it('marks a class component', () => {
    const out = marked(`class Panel extends Component { render() { return <section />; } }`);
    expect(out).toContain(markOf('Panel'));
  });

  // The case stamping cannot see: a component that writes no host element of its own.
  it('marks a component that only composes other components', () => {
    const out = marked(`function PreferenceRow() { return <Row><Switch /></Row>; }`);
    expect(out).toContain(markOf('PreferenceRow'));
    expect(out).not.toContain(COMPONENT_ATTRIBUTE);
  });

  it('marks a component whose only JSX is a fragment', () => {
    expect(marked(`function Group({ children }) { return <>{children}</>; }`)).toContain(markOf('Group'));
  });

  it('marks each component once, however much JSX it owns', () => {
    const out = marked(`function Form() { return <form><input /><button /></form>; }`);
    expect(out.split(`Form.${MARK_PROPERTY}`)).toHaveLength(2);
  });

  it('leaves unmarked what it would not name: no JSX, or JSX only in a lowercase helper', () => {
    const out = marked(`function Total() { return 1; }\nfunction row() { return <tr />; }\nconst List = () => row();`);
    expect(out).not.toContain(MARK_PROPERTY);
  });

  it('skips a binding no following statement could see', () => {
    const out = marked(`for (const Loop = () => <i />;;) break;`);
    expect(out).toContain(`${COMPONENT_ATTRIBUTE}="Loop"`);
    expect(out).not.toContain(MARK_PROPERTY);
  });

  it('carries no file when includeSourceFile is off', () => {
    const out = marked(`function SettingsForm() { return <form />; }`, { includeSourceFile: false });
    expect(out).toContain(`SettingsForm.${MARK_PROPERTY} = {\n  name: "SettingsForm"\n};`);
  });

  it('marks .jsx/.tsx only, like stamping', () => {
    const out = transform(`function A() { return <a />; }`, { markComponents: true }, '/repo/src/a.js');
    expect(out).not.toContain(MARK_PROPERTY);
  });

  // Placed in the same Program.enter pass as stamping, so a compiler that rewrites functions
  // afterwards still finds the marks already in place, and the components' own syntax intact.
  it('marks before a compiler listed after it rewrites anything', () => {
    const source = `function ColorPalette({ colors }) { return <ul>{colors.map((c) => <li>{c}</li>)}</ul>; }`;
    const out =
      transformSync(source, {
        filename: '/repo/src/ColorPalette.tsx',
        cwd: '/repo',
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [[rastroComponentAnnotate, { markComponents: true }], hoistingCompiler],
      })?.code ?? '';
    expect(out).toMatch(/function _temp/);
    expect(out.split(`ColorPalette.${MARK_PROPERTY}`)).toHaveLength(2);
  });
});

describe('alongside the React Compiler', () => {
  const source = `function ColorPalette({ colors }) {
    return <ul>{colors.map((c) => <li>{c}</li>)}</ul>;
  }`;

  const transformWith = (options: TransformOptions): string =>
    transformSync(source, {
      filename: '/repo/src/ColorPalette.tsx',
      cwd: '/repo',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      ...options,
    })?.code ?? '';

  const stampedItem = new RegExp(`<li ${COMPONENT_ATTRIBUTE}="ColorPalette"`);

  // The configuration the README documents and Actual ships: the compiler arrives as a preset,
  // this plugin as a plugin, and Babel runs plugins' `Program.enter` before presets'.
  it('stamps JSX before a compiler preset hoists it out of its component', () => {
    const out = transformWith({
      plugins: [rastroComponentAnnotate],
      presets: [() => ({ plugins: [hoistingCompiler] })],
    });
    expect(out).toMatch(/function _temp/); // the stand-in really did hoist
    expect(out).toMatch(stampedItem);
  });

  it('stamps JSX before a compiler plugin listed after it', () => {
    const out = transformWith({ plugins: [rastroComponentAnnotate, hoistingCompiler] });
    expect(out).toMatch(/function _temp/);
    expect(out).toMatch(stampedItem);
  });

  // The limit of the fix, pinned so it cannot change unnoticed: a plugin that rewrites in
  // `Program.enter` and is listed FIRST runs first, and nothing this plugin does can reorder
  // that. The README says to list this plugin before the compiler.
  it('cannot recover the owner when the compiler is listed before it', () => {
    const out = transformWith({ plugins: [hoistingCompiler, rastroComponentAnnotate] });
    expect(out).toMatch(/function _temp/);
    expect(out).not.toMatch(stampedItem);
  });
});

// The path is part of the fingerprint, so every way it can vary between two builds of one
// source tree is an identity split. These are the ways.
describe('sourceFilePath', () => {
  it('is repo-relative', () => {
    expect(sourceFilePath('/repo/app', '/repo/app/src/Nav.tsx')).toBe('src/Nav.tsx');
  });

  it('stamps nothing for a file outside the root, rather than a launch-relative path', () => {
    expect(sourceFilePath('/repo/app', '/repo/shared/Nav.tsx')).toBeNull();
  });

  it('stamps nothing when there is no root to relativize against', () => {
    expect(sourceFilePath('', '/repo/app/src/Nav.tsx')).toBeNull();
    expect(sourceFilePath(undefined, '/repo/app/src/Nav.tsx')).toBeNull();
  });
});

// Driven with a `\` separator, which is the only way to reach the Windows behaviour: CI runs
// on Linux, where `relative()` cannot produce any of these shapes.
describe('toStampedPath', () => {
  // The one standing between a Windows contributor and a second identity set for byte-
  // identical code: `App>Nav@src\Nav.tsx` and `App>Nav@src/Nav.tsx` share nothing.
  it('normalises Windows separators', () => {
    expect(toStampedPath('src\\ui\\Nav.tsx', '\\')).toBe('src/ui/Nav.tsx');
  });

  it('leaves a POSIX filename containing a backslash alone', () => {
    expect(toStampedPath('src/od\\d.tsx', '/')).toBe('src/od\\d.tsx');
  });

  it('refuses a path that escapes the root, which is launch-relative again', () => {
    expect(toStampedPath('../shared/Nav.tsx', '/')).toBeNull();
    expect(toStampedPath('..\\shared\\Nav.tsx', '\\')).toBeNull();
    expect(toStampedPath('..', '/')).toBeNull();
  });

  // SEMANTIC-CONVENTIONS.md: MUST NOT carry an absolute filesystem path. `relative()` returns
  // one when the file is on another Windows drive, and it would land in telemetry as-is.
  it('refuses an absolute path, which would leak the build machine into telemetry', () => {
    expect(toStampedPath('D:\\other\\src\\Nav.tsx', '\\')).toBeNull();
    expect(toStampedPath('/other/src/Nav.tsx', '/')).toBeNull();
  });

  it('keeps a path that merely starts with a dot, which is an ordinary directory', () => {
    expect(toStampedPath('.storybook/Nav.tsx', '/')).toBe('.storybook/Nav.tsx');
  });
});
