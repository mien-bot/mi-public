/**
 * Scaffolds a new project folder under projects/<slug>/ with the standard
 * subdirectory layout and placeholder front-matter, so a new project starts
 * from a schema-valid skeleton instead of a blank folder.
 *
 * Usage: npm run new-project -- <slug> "<Project Name>"
 */
import fs from "node:fs";
import path from "node:path";
import { scaffoldProject } from "../lib/content/scaffoldProject";
import { PROJECTS_DIR } from "../lib/content/paths";

const [, , slugArg, nameArg] = process.argv;

if (!slugArg) {
  console.error('Usage: npm run new-project -- <slug> "<Project Name>"');
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(slugArg)) {
  console.error(`Invalid slug "${slugArg}" — use lowercase letters, numbers, and hyphens only.`);
  process.exit(1);
}

const projectName = nameArg ?? slugArg;

if (fs.existsSync(path.join(PROJECTS_DIR, slugArg))) {
  console.error(`projects/${slugArg} already exists — aborting.`);
  process.exit(1);
}

scaffoldProject(slugArg, projectName);

console.log(`Created projects/${slugArg}/ — run \`npm run validate-content\` to confirm it's schema-valid.`);
