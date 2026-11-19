// scripts/identity-spike/src/mark-plugin.test.ts
// The marks rule 2's "touched" reads. Moved with the plugin from babel-plugin-rastro's tests.
import { transformSync, type PluginItem, type PluginObj, type types as BabelTypes } from '@babel/core';
import { describe, expect, it } from 'vitest';
import { MARK_PROPERTY } from './fiber.ts';
import rastroCorpusMarks, { markFile, type MarkPluginOptions } from './mark-plugin.ts';

function marked(source: string, options: MarkPluginOptions = { root: '/repo' }, filename = '/repo/src/SettingsForm.tsx', after: PluginItem[] = []): string {
  return (
    transformSync(source, {
      filename,
      cwd: '/repo',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      plugins: [[rastroCorpusMarks, options], ...after],
    })?.code ?? ''
  );
}

const markOf = (name: string, file = 'src/SettingsForm.tsx'): string =>
  `${name}.${MARK_PROPERTY} = {\n  name: "${name}",\n  file: "${file}"\n};`;

describe('rastro-corpus-marks', () => {
  it('marks a declared component right after its declaration', () => {
    expect(marked(`function SettingsForm() { return <form />; }`)).toContain(`}\n${markOf('SettingsForm')}`);
  });

  it('marks exported and default-exported declarations', () => {
    const out = marked(`export function A() { return <a />; }\nexport default function B() { return <b />; }`);
    expect(out).toContain(markOf('A'));
    expect(out).toContain(markOf('B'));
  });

  // The binding the developer named is what gets marked, so a wrapped component is marked on
  // its wrapper object. ancestry.ts reads it there (fiber.elementType, or fiber.type).
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
    expect(marked(`class Panel extends Component { render() { return <section />; } }`)).toContain(markOf('Panel'));
  });

  // The case stamping cannot see: a component that writes no host element of its own.
  it('marks a component that only composes other components, and one whose only JSX is a fragment', () => {
    expect(marked(`function PreferenceRow() { return <Row><Switch /></Row>; }`)).toContain(markOf('PreferenceRow'));
    expect(marked(`function Group({ children }) { return <>{children}</>; }`)).toContain(markOf('Group'));
  });

  it('marks each component once, however much JSX it owns', () => {
    expect(marked(`function Form() { return <form><input /><button /></form>; }`).split(`Form.${MARK_PROPERTY}`)).toHaveLength(2);
  });

  it('leaves unmarked what the build plugin would not name: no JSX, or JSX only in a lowercase helper', () => {
    expect(marked(`function Total() { return 1; }\nfunction row() { return <tr />; }\nconst List = () => row();`)).not.toContain(MARK_PROPERTY);
  });

  it('skips a binding no following statement could see', () => {
    expect(marked(`for (const Loop = () => <i />;;) break;`)).not.toContain(MARK_PROPERTY);
  });

  it('carries no file without a root, and marks .jsx/.tsx only', () => {
    expect(marked(`function SettingsForm() { return <form />; }`, {})).toContain(`SettingsForm.${MARK_PROPERTY} = {\n  name: "SettingsForm"\n};`);
    expect(marked(`function A() { return <a />; }`, { root: '/repo' }, '/repo/src/a.js')).not.toContain(MARK_PROPERTY);
  });

  // Placed in Program.enter, so a compiler that rewrites functions afterwards still finds the
  // marks in place. The stand-in hoists a `.map()` callback, as the React Compiler does.
  it('marks before a compiler listed after it rewrites anything', () => {
    const hoist = ({ types: t }: { types: typeof BabelTypes }): PluginObj => ({
      name: 'stand-in-react-compiler',
      visitor: {
        Program: {
          enter(program) {
            program.traverse({
              ArrowFunctionExpression(arrow) {
                if (!arrow.parentPath.isCallExpression()) return;
                const id = program.scope.generateUidIdentifier('temp');
                const body = t.isExpression(arrow.node.body) ? t.blockStatement([t.returnStatement(arrow.node.body)]) : arrow.node.body;
                program.pushContainer('body', t.functionDeclaration(id, arrow.node.params, body));
                arrow.replaceWith(t.identifier(id.name));
              },
            });
          },
        },
      },
    });
    const source = `function ColorPalette({ colors }) { return <ul>{colors.map((c) => <li>{c}</li>)}</ul>; }`;
    const out = marked(source, { root: '/repo' }, '/repo/src/ColorPalette.tsx', [hoist]);
    expect(out).toMatch(/function _temp/);
    expect(out.split(`ColorPalette.${MARK_PROPERTY}`)).toHaveLength(2);
  });
});

describe('markFile', () => {
  it('is root-relative and POSIX', () => {
    expect(markFile('/repo/app', '/repo/app/src/Nav.tsx')).toBe('src/Nav.tsx');
  });

  it('gives no file outside the root, or without one', () => {
    expect(markFile('/repo/app', '/repo/shared/Nav.tsx')).toBeNull();
    expect(markFile(undefined, '/repo/app/src/Nav.tsx')).toBeNull();
  });
});
