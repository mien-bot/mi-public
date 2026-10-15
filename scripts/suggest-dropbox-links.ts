/**
 * Suggests project.yaml `dropbox_path` links by fuzzy-matching each local
 * project's name against real folder names under
 * DROPBOX_ROOT/1.00 PROJECTS/. Read-only — never writes dropbox_path itself
 * (lib/schema.ts: that field is always human-set, never guessed — folder
 * naming schemes between Notion and Dropbox don't line up cleanly enough to
 * trust an auto-match, e.g. address typos/renumbering between systems).
 *
 * Human reviews the suggestions, then confirms via:
 *   npm run mi -- dropbox link <slug> "1.00 PROJECTS/<folder name>"
 *
 * Usage: npm run suggest-dropbox-links
 */
import fs from "node:fs";
import path from "node:path";

// Must load before ../lib/content/paths.ts is imported (dynamically, below)
// — DROPBOX_ROOT is read from process.env at that module's top level (see
// scripts/mi.ts's header comment for the same reasoning re: NOTION_API_KEY).
// Top-level await isn't available in this file's (CJS) output, so the rest
// runs inside main().
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not found — env vars may already be set another way.
}

async function main() {
  const { getAllProjects } = await import("../lib/content/projects");
  const { DROPBOX_ROOT } = await import("../lib/content/paths");
  const { matchProjectName } = await import("../src/domain/project");

  if (!DROPBOX_ROOT) {
    console.error("DROPBOX_ROOT not set in .env.local — can't suggest Dropbox links on this machine.");
    process.exit(1);
  }

  const PROJECTS_SUBDIR = "1.00 PROJECTS";
  const projectsRoot = path.join(DROPBOX_ROOT, PROJECTS_SUBDIR);
  if (!fs.existsSync(projectsRoot)) {
    console.error(`"${projectsRoot}" doesn't exist — check DROPBOX_ROOT in .env.local.`);
    process.exit(1);
  }

  // Non-project buckets that live alongside real project folders in
  // Dropbox — exclude from matching so they never show up as a false "best
  // guess".
  const EXCLUDE = new Set(["2024", "MISC", "PERMIT QAQC", "Project Template"]);

  const folders = fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXCLUDE.has(e.name))
    .map((e) => e.name);

  const candidates = folders.map((name) => ({ id: name, name }));

  const unlinked = getAllProjects().filter((p) => !p.meta.dropbox_path);
  if (unlinked.length === 0) {
    console.log("Every local project already has a dropbox_path set.");
    return;
  }

  for (const project of unlinked) {
    const ranked = matchProjectName(project.meta.name, candidates).slice(0, 3);
    console.log(`\n${project.slug}  ("${project.meta.name}")`);
    if (ranked.length === 0 || ranked[0].score === 0) {
      console.log("  no plausible match");
      continue;
    }
    for (const r of ranked) {
      console.log(`  score ${r.score.toFixed(2)}  ${PROJECTS_SUBDIR}/${r.name}`);
    }
  }

  console.log(
    '\nConfirm a match with: npm run mi -- dropbox link <slug> "1.00 PROJECTS/<folder name>"',
  );
}

main();
