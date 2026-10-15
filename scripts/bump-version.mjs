/**
 * Bumps package.json's patch version in place — run automatically before
 * every installer build (see the dist:win:installer script) so each
 * installer that ships gets a distinct version/filename. Deliberately not
 * `npm version` (that refuses to run on a dirty git working tree, which is
 * the normal state while iterating on a build).
 */
import fs from "node:fs";
import path from "node:path";

const packageJsonPath = path.join(process.cwd(), "package.json");
const raw = fs.readFileSync(packageJsonPath, "utf8");
const pkg = JSON.parse(raw);

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!match) {
  console.error(`package.json version "${pkg.version}" isn't plain semver (major.minor.patch) — bump it by hand.`);
  process.exit(1);
}
const [, major, minor, patch] = match;
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
pkg.version = nextVersion;

// Preserve the trailing newline npm itself writes.
fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`Bumped version -> ${nextVersion}`);
