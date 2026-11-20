// scripts/identity-spike/src/site-plugin.test.ts
// The stamps the site referee reads (site-referee.ts).
import { transformSync, type PluginItem } from '@babel/core';
import { describe, expect, it } from 'vitest';
import rastroCorpusSites, { siteFile, type SitePluginOptions } from './site-plugin.ts';

function stamped(source: string, options: SitePluginOptions = { root: '/repo' }, filename = '/repo/src/Table.tsx', after: PluginItem[] = []): string {
  return (
    transformSync(source, {
      filename,
      cwd: '/repo',
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx', 'typescript'] },
      plugins: [[rastroCorpusSites, options], ...after],
    })?.code ?? ''
  );
}

const calls = (out: string): number => (out.match(/_rastroSite\(</g) ?? []).length;

describe('rastro-corpus-sites', () => {
  it('records every JSX element, host and component, with its file, line and column', () => {
    const out = stamped(`function Row() {\n  return <tr><Cell /></tr>;\n}`);
    expect(out).toContain('"src/Table.tsx:2:10"');
    expect(out).toContain('"src/Table.tsx:2:14"');
    expect(calls(out)).toBe(2);
  });

  // The first version added a prop, and Actual crashed: a component handed its props to a
  // serializer. Nothing the app's code can see may change.
  it('adds no prop and no attribute: the element is passed through a call, unchanged', () => {
    const out = stamped(`const B = (p) => <button {...p} id="x" />;`);
    expect(out).toContain('<button {...p} id="x" />');
  });

  it('wraps a child element in an expression container, so it stays a child', () => {
    expect(stamped(`const A = () => <a><b /></a>;`)).toMatch(/<a>\{_rastroSite\(<b \/>, "src\/Table\.tsx:1:20"\)\}<\/a>/);
  });

  it('declares the helper once, as a hoisted function, before any module-level JSX', () => {
    const out = stamped(`import a from 'a';\nconst top = <i />;\nexport const C = () => <b />;`);
    expect(out.match(/function _rastroSite\(/g)).toHaveLength(1);
    expect(out.indexOf('function _rastroSite(')).toBeLessThan(out.indexOf('const top'));
  });

  it('leaves fragments alone, which React keeps no props object for', () => {
    const out = stamped(`const L = () => <Fragment><React.Fragment key="k"><i /></React.Fragment><></></Fragment>;`);
    expect(calls(out)).toBe(1);
  });

  it('is deterministic, so one build stamps one site one way', () => {
    const source = `const A = () => <div><a /></div>;`;
    expect(stamped(source)).toBe(stamped(source));
  });

  it('touches only .jsx and .tsx files, and adds no helper where there is no JSX', () => {
    expect(stamped(`const A = () => <a />;`, { root: '/repo' }, '/repo/src/a.js')).not.toContain('_rastroSite');
    expect(stamped(`export const n = 1;`)).not.toContain('_rastroSite');
  });

  it('names files relative to the root, or in full without one, and outside it too', () => {
    expect(siteFile('/repo', '/repo/src/a.tsx')).toBe('src/a.tsx');
    expect(siteFile('/repo/examples/demo', '/repo/packages/ra-core/src/a.tsx')).toBe('../../packages/ra-core/src/a.tsx');
    expect(siteFile(undefined, '/repo/src/a.tsx')).toBe('/repo/src/a.tsx');
  });
});
