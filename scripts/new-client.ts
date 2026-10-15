/**
 * Scaffolds a new clients/<slug>.yaml from a schema-valid skeleton.
 *
 * Usage: npm run new-client -- <slug> "<Client Name>"
 */
import fs from "node:fs";
import path from "node:path";

const [, , slugArg, nameArg] = process.argv;

if (!slugArg) {
  console.error('Usage: npm run new-client -- <slug> "<Client Name>"');
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(slugArg)) {
  console.error(`Invalid slug "${slugArg}" — use lowercase letters, numbers, and hyphens only.`);
  process.exit(1);
}

const clientName = nameArg ?? slugArg;
const clientsDir = path.join(process.cwd(), "clients");
const filePath = path.join(clientsDir, `${slugArg}.yaml`);

if (fs.existsSync(filePath)) {
  console.error(`clients/${slugArg}.yaml already exists — aborting.`);
  process.exit(1);
}

fs.mkdirSync(clientsDir, { recursive: true });

fs.writeFileSync(
  filePath,
  `name: "${clientName}"
short_summary: ""
industry: ""
primary_contact_name: ""
contact_email: ""
contact_phone: ""
first_engaged: null
status: prospect
# This client's page id in Notion, for future linking. Leave null until a
# human confirms the match — never guess it.
notion_page_id: null
`,
  "utf-8",
);

console.log(`Created clients/${slugArg}.yaml — run \`npm run validate-content\` to confirm it's schema-valid.`);
