// packages/babel-plugin/src/index.test.ts
// Transform in, transformed source out. Pure — no DOM, no React, no bundler.
import {
  transformSync,
  type PluginObj,
  type TransformOptions,
  type types as BabelTypes,
} from '@babel/core';
import { describe, expect, it } from 'vitest';
import rastroComponentAnnotate, { COMPONENT_ATTRIBUTE, type RastroPluginOptions } from './index.js';

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

  it('stamps nothing but the owning component', () => {
    const out = transform(`function SettingsForm() { return <form />; }`);
    expect(out).not.toContain('data-rastro-source-file');
    expect(out).not.toContain('__rastroMark');
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
    });
    expect(out).toContain('data-x-component="SettingsForm"');
  });

  // What the whole plugin exists for: these names are string literals in the output, so a
  // minifier renaming the FUNCTION cannot touch them (docs/DESIGN.md §4.3).
  it('emits the name as a string literal, which is what survives minification', () => {
    const out = transform(`function SettingsForm() { return <form />; }`);
    expect(out).toMatch(/"SettingsForm"/);
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
