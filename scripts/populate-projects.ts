/**
 * Bulk-scaffolds a local projects/<slug>/ folder for every Notion project in
 * the committed notion/project-map.json snapshot that doesn't have one yet
 * (matched by notion_page_id, same matching notion/projectMap.ts's
 * getUnifiedProjectList() uses for the chat picker). Pre-fills name/status/
 * client/notion_page_id exactly like the chat's auto-scaffold
 * (app/api/projects/scaffold) does.
 *
 * dropbox_path is always left null here — that's a separate, human-
 * confirmed step (see `npm run suggest-dropbox-links` + `npm run mi --
 * dropbox link`), never guessed.
 *
 * Usage: npm run populate-projects [-- --dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { scaffoldProject } from "../lib/content/scaffoldProject";
import { PROJECTS_DIR } from "../lib/content/paths";
import { getAllProjects } from "../lib/content/projects";

interface ProjectMapEntry {
  notion_page_id: string;
  slug: string;
  name: string;
  status: "not-started" | "in-progress" | "complete" | "abandoned" | "unknown";
  client: string | null;
}

const dryRun = process.argv.includes("--dry-run");

const mapPath = path.join(process.cwd(), "notion", "project-map.json");
if (!fs.existsSync(mapPath)) {
  console.error("notion/project-map.json not found — run `npm run mi -- notion map --write` first.");
  process.exit(1);
}
const map: { projects: ProjectMapEntry[] } = JSON.parse(fs.readFileSync(mapPath, "utf-8"));

const linkedNotionIds = new Set(
  getAllProjects()
    .map((p) => p.meta.notion_page_id)
    .filter((id): id is string => Boolean(id)),
);

let created = 0;
for (const entry of map.projects) {
  if (linkedNotionIds.has(entry.notion_page_id)) continue;

  let slug = entry.slug;
  let suffix = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, slug))) {
    slug = `${entry.slug}-${suffix}`;
    suffix++;
  }

  console.log(`${dryRun ? "[dry-run] would create" : "Creating"} projects/${slug}/ (${entry.name})`);
  if (!dryRun) {
    scaffoldProject(slug, entry.name, {
      client: entry.client,
      status: entry.status === "unknown" ? null : entry.status,
      notionPageId: entry.notion_page_id,
    });
    created++;
  }
}

console.log(
  dryRun
    ? "Dry run complete — no files written."
    : `Created ${created} project folder(s). Run \`npm run validate-content\` to confirm.`,
);
