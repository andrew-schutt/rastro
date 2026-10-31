// examples/stamp-fixture/audit/audit.test.ts
// Audits this package's two production builds (Vite 7, plugin-react v5). Runs after
// `pnpm -r build`, as CI does. The suite itself is shared: see fixture-suite.ts.
import { join } from 'node:path';
import { describeFixtureAudit } from './fixture-suite.ts';

describeFixtureAudit(join(import.meta.dirname, '..'), 'stamp-fixture');
