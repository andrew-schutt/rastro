// scripts/identity-spike/corpus/lockfile.ts
// What a yarn lockfile installs, apart from how it is written down.
//
// One corpus commit (react-admin's 9) has a lockfile out of step with its manifests, so
// `yarn install --immutable` refuses it. Yarn wants to rewrite only bookkeeping: two entries
// for zod, which resolve to the same package with the same checksum, become one. CORPUS.md
// (amended 2026-11-17) lets that commit install without `--immutable`, and only if the
// rewrite changes nothing that is installed. This is the check.

/** Every package the lockfile resolves to, with its checksum, one string each. */
export function resolvedPackages(lockfile: string): Set<string> {
  const packages = new Set<string>();
  let resolution: string | null = null;
  for (const line of lockfile.split('\n')) {
    if (!line.startsWith(' ')) resolution = null;
    const resolved = /^ {2}resolution: (.+)$/.exec(line);
    if (resolved !== null) {
      resolution = resolved[1]!;
      packages.add(resolution);
    }
    const checksum = /^ {2}checksum: (.+)$/.exec(line);
    if (checksum !== null && resolution !== null) {
      packages.delete(resolution);
      packages.add(`${resolution} ${checksum[1]!}`);
    }
  }
  return packages;
}

/** The packages one lockfile resolves to and the other does not, both ways. Empty when equal. */
export function installDifference(before: string, after: string): string[] {
  const [a, b] = [resolvedPackages(before), resolvedPackages(after)];
  return [...[...a].filter((p) => !b.has(p)).map((p) => `- ${p}`), ...[...b].filter((p) => !a.has(p)).map((p) => `+ ${p}`)];
}
