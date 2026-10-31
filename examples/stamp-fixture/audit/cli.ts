// examples/stamp-fixture/audit/cli.ts
// Run the stamp audit on a build made with audit/site-plugin.ts first in its Babel plugins —
// the fixture in CI, or a §3.2 corpus app by hand:
//
//   node examples/stamp-fixture/audit/cli.ts <build dir>
//
// Exits nonzero on any miss or misattribution.
import { resolve } from 'node:path';
import { auditBundle, passes, type Finding } from './audit.ts';

const [buildDir] = process.argv.slice(2);
if (buildDir === undefined) {
  console.error('usage: cli.ts <build dir>');
  process.exit(2);
}

const report = auditBundle(resolve(buildDir));
const show = (label: string, findings: Finding[]): void => {
  console.log(`${label}: ${findings.length}`);
  for (const f of findings.slice(0, 20)) {
    console.log(`  ${f.site} owner=${f.owner ?? '-'} stamped=${f.stampedAs ?? '-'}`);
  }
};

console.log(`stamped correctly: ${report.stamped.length}`);
show('MISSED', report.missed);
show('MISATTRIBUTED', report.misattributed);
console.log(`unowned (unstamped by design): ${report.unowned.length}`);
console.log(`React Compiler cache sites: ${report.compilerCacheSites}`);
process.exit(passes(report) ? 0 : 1);
