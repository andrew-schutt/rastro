// scripts/identity-spike/corpus/lockfile.test.ts
// The install check for a commit whose lockfile yarn rewrites, on react-admin 9's own entries.
import { describe, expect, it } from 'vitest';
import { installDifference, resolvedPackages } from './lockfile.ts';

const entry = (descriptors: string, version: string, checksum: string) =>
  `"${descriptors}":\n  version: ${version}\n  resolution: "zod@npm:${version}"\n  checksum: ${checksum}\n  languageName: node\n  linkType: hard\n`;

// As committed at react-admin 679e5e1, and as yarn would rewrite it.
const committed = [entry('zod@npm:^3.23.8', '3.25.76', 'aaa'), entry('zod@npm:^4.3.6', '4.6.7', 'bbb'), entry('zod@npm:^4.5.4', '4.6.7', 'bbb')].join('\n');
const rewritten = [entry('zod@npm:^3.23.8', '3.25.76', 'aaa'), entry('zod@npm:^4.3.6, zod@npm:^4.5.4', '4.6.7', 'bbb')].join('\n');

describe('installDifference', () => {
  it('reads each resolved package with its checksum', () => {
    expect([...resolvedPackages(committed)]).toEqual(['"zod@npm:3.25.76" aaa', '"zod@npm:4.6.7" bbb']);
  });

  it('finds nothing when only the descriptors are merged, as at react-admin 9', () => {
    expect(installDifference(committed, rewritten)).toEqual([]);
  });

  it('names a package whose version or checksum the rewrite changed', () => {
    const bumped = rewritten.replace('4.6.7', '4.6.8').replace('"zod@npm:4.6.7"', '"zod@npm:4.6.8"');
    expect(installDifference(committed, bumped)).toEqual(['- "zod@npm:4.6.7" bbb', '+ "zod@npm:4.6.8" bbb']);
    expect(installDifference(committed, rewritten.replace('bbb', 'ccc'))).toEqual(['- "zod@npm:4.6.7" bbb', '+ "zod@npm:4.6.7" ccc']);
  });
});
