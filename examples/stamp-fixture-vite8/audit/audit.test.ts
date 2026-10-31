// examples/stamp-fixture-vite8/audit/audit.test.ts
// Audits the same fixture app built with Vite 8 and plugin-react v6. Runs after `pnpm -r build`,
// as CI does. The suite is examples/stamp-fixture's, so both builds are judged identically.
import { join } from 'node:path';
import { describeFixtureAudit } from '../../stamp-fixture/audit/fixture-suite.ts';

describeFixtureAudit(join(import.meta.dirname, '..'), 'stamp-fixture-vite8');
