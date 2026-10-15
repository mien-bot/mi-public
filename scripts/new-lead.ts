/**
 * Scaffolds a new leads/<slug>/ folder from a schema-valid skeleton.
 *
 * Usage: npm run new-lead -- <slug> "<Lead Name>"
 */
import { scaffoldLead } from "../lib/content/scaffoldLead";

const [, , slugArg, nameArg] = process.argv;

if (!slugArg) {
  console.error('Usage: npm run new-lead -- <slug> "<Lead Name>"');
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(slugArg)) {
  console.error(`Invalid slug "${slugArg}" — use lowercase letters, numbers, and hyphens only.`);
  process.exit(1);
}

const leadName = nameArg ?? slugArg;

try {
  scaffoldLead(slugArg, leadName);
} catch (err) {
  console.error(err instanceof Error ? err.message : "Failed to scaffold lead.");
  process.exit(1);
}

console.log(`Created leads/${slugArg}/ — run \`npm run validate-content\` to confirm it's schema-valid.`);
