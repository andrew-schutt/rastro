// scripts/identity-spike/src/site-plugin.test.ts
// The stamps the site referee reads (site-referee.ts).
import { transformSync, type PluginItem } from '@babel/core';
import { describe, expect, it } from 'vitest';
import { SITE_PROPERTY } from './fiber.ts';
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

describe('rastro-corpus-sites', () => {
  it('stamps every JSX element, host and component, with its file, line and column', () => {
    const out = stamped(`function Row() {\n  return <tr><Cell /></tr>;\n}`);
    expect(out).toContain('Symbol.for("src/Table.tsx:2:10")');
    expect(out).toContain('Symbol.for("src/Table.tsx:2:14")');
    expect(out.match(new RegExp(SITE_PROPERTY, 'g'))).toHaveLength(2);
  });

  // An element's own site has to win over a stamp it was handed in a spread.
  it('puts the stamp after every spread', () => {
    expect(stamped(`const B = (p) => <button {...p} />;`)).toMatch(new RegExp(`<button \\{\\.\\.\\.p\\} ${SITE_PROPERTY}=\\{_rastroSite\\} />`));
  });

  it('declares one constant per site, after the imports and before anything that renders', () => {
    const out = stamped(`import a from 'a';\nimport b from 'b';\nconst top = <i />;\nexport const C = () => <b />;`);
    const constant = out.indexOf('const _rastroSite');
    expect(constant).toBeGreaterThan(out.indexOf("import b from 'b'"));
    expect(constant).toBeLessThan(out.indexOf('const top'));
    expect(out).toContain('_rastroSite2');
  });

  it('leaves fragments alone, which take no props', () => {
    const out = stamped(`const L = () => <Fragment><React.Fragment key="k"><i /></React.Fragment><></></Fragment>;`);
    expect(out.match(new RegExp(SITE_PROPERTY, 'g'))).toHaveLength(1);
  });

  it('is deterministic, so one build stamps one site one way', () => {
    const source = `const A = () => <div><a /></div>;`;
    expect(stamped(source)).toBe(stamped(source));
  });

  it('touches only .jsx and .tsx files', () => {
    expect(stamped(`const A = () => <a />;`, { root: '/repo' }, '/repo/src/a.js')).not.toContain(SITE_PROPERTY);
  });

  it('names files relative to the root, or in full without one, and outside it too', () => {
    expect(siteFile('/repo', '/repo/src/a.tsx')).toBe('src/a.tsx');
    expect(siteFile('/repo/examples/demo', '/repo/packages/ra-core/src/a.tsx')).toBe('../../packages/ra-core/src/a.tsx');
    expect(siteFile(undefined, '/repo/src/a.tsx')).toBe('/repo/src/a.tsx');
  });
});
