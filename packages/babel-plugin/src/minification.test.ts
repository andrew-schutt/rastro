// packages/babel-plugin/src/minification.test.ts
// The integration test for the plugin's entire reason to exist.
//
// index.test.ts proves the attributes are emitted. That is not the claim. The claim is that
// they SURVIVE a production build, where component names do not — so this runs the annotated
// source through a real bundler-minifier and asserts on the bytes that would actually ship.
//
// Each case is paired with its counterfactual: the same source built WITHOUT the plugin. That
// is what makes the test load-bearing rather than decorative — it demonstrates that the plugin
// is what preserves the names, not some accident of the toolchain.
import { transformSync } from '@babel/core';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import rastroComponentAnnotate, {
  COMPONENT_ATTRIBUTE,
  SOURCE_FILE_ATTRIBUTE,
} from './index.js';

/** Distinctive names, so a match in the output cannot be a coincidence. */
const SOURCE = `
  function SaveButtonComponent() { return <button>Save</button>; }
  function SettingsFormComponent() { return <form><SaveButtonComponent /></form>; }
  export default function AppRootComponent() {
    return <div><SettingsFormComponent /></div>;
  }
`;

const COMPONENTS = ['SaveButtonComponent', 'SettingsFormComponent', 'AppRootComponent'];

function annotate(source: string): string {
  return (
    transformSync(source, {
      filename: '/repo/src/SettingsForm.tsx',
      cwd: '/repo',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx'] },
      plugins: [rastroComponentAnnotate],
    })?.code ?? ''
  );
}

/** A real production build: bundled, minified, identifiers mangled. */
async function bundleMinified(source: string): Promise<string> {
  const result = await esbuild.build({
    stdin: { contents: source, loader: 'jsx', resolveDir: import.meta.dirname, sourcefile: 'in.jsx' },
    bundle: true,
    minify: true,
    write: false,
    format: 'iife',
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'F',
  });
  return result.outputFiles[0]?.text ?? '';
}

describe('surviving minification', () => {
  it('erases every component name when the plugin does not run', async () => {
    const out = await bundleMinified(SOURCE);

    // The failure this plugin exists to fix, demonstrated rather than asserted in prose:
    // after minification there is no trace of what any of these components were called.
    for (const name of COMPONENTS) {
      expect(out).not.toContain(name);
    }
  });

  it('preserves every component name when it does', async () => {
    const out = await bundleMinified(annotate(SOURCE));

    for (const name of COMPONENTS) {
      expect(out).toContain(`"${name}"`);
    }
  });

  it('preserves the names as data, while the functions themselves are still mangled', async () => {
    const out = await bundleMinified(annotate(SOURCE));

    // Both halves matter. The declarations ARE renamed — the plugin does not defeat
    // minification, which would cost bundle size and defeat the point of minifying. It moves
    // the identity out of the identifier and into a string literal, which nothing renames.
    for (const name of COMPONENTS) {
      expect(out).not.toContain(`function ${name}`);
      expect(out).toContain(`"${name}"`);
    }
  });

  it('keeps the attribute keys intact, so the runtime can find them', async () => {
    const out = await bundleMinified(annotate(SOURCE));

    expect(out).toContain(COMPONENT_ATTRIBUTE);
    expect(out).toContain(SOURCE_FILE_ATTRIBUTE);
  });

  it('preserves the source file, which is the rename-proof anchor', async () => {
    const out = await bundleMinified(annotate(SOURCE));

    expect(out).toContain('"src/SettingsForm.tsx"');
  });

  it('stamps nested components distinctly, so the DOM chain is recoverable after minifying', async () => {
    const out = await bundleMinified(annotate(SOURCE));

    // The button and the form must carry DIFFERENT component names in the shipped bundle —
    // that difference is the entire chain. If minification collapsed them, walking the DOM
    // would yield one identity for both, which is the mass false merge being designed against.
    expect(out).toContain(`"button",{"${COMPONENT_ATTRIBUTE}":"SaveButtonComponent"`);
    expect(out).toContain(`"form",{"${COMPONENT_ATTRIBUTE}":"SettingsFormComponent"`);
  });
});
