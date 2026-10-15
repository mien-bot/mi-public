/**
 * Lists real Dropbox folders under DROPBOX_ROOT/1.00 PROJECTS/PERMIT QAQC/ that aren't
 * yet linked to any permit-qaqc/<slug>/qaqc.yaml. Read-only -- never creates an
 * engagement or writes a dropbox_path itself (lib/schema.ts: permitQaqcEngagementSchema's
 * dropbox_path is always human-set, matching every other dropbox_path in this repo).
 *
 * Unlike suggest-dropbox-links.ts (which fuzzy-matches an existing project's name
 * against candidate folders), there's no existing engagement name to match against here
 * on first run -- these Dropbox folders predate any Mi record. This script only reports
 * what's unclaimed; a human creates the engagement (with its real name/submitting firm)
 * and links the exact folder shown here.
 *
 * Usage: npm run suggest-permit-qaqc-links
 */
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not found -- env vars may already be set another way.
}

async function main() {
  const { getAllPermitQaqcEngagements } = await import("../lib/content/permitQaqc");
  const { DROPBOX_ROOT } = await import("../lib/content/paths");
  const { slugifyProjectName } = await import("../lib/notion/projectMap");

  if (!DROPBOX_ROOT) {
    console.error("DROPBOX_ROOT not set in .env.local -- can't scan Permit QAQC folders on this machine.");
    process.exit(1);
  }

  const PERMIT_QAQC_SUBDIR = path.join("1.00 PROJECTS", "PERMIT QAQC");
  const permitQaqcRoot = path.join(DROPBOX_ROOT, PERMIT_QAQC_SUBDIR);
  if (!fs.existsSync(permitQaqcRoot)) {
    console.error(`"${permitQaqcRoot}" doesn't exist -- check DROPBOX_ROOT in .env.local.`);
    process.exit(1);
  }

  const folders = fs
    .readdirSync(permitQaqcRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const linked = new Set(
    getAllPermitQaqcEngagements()
      .map(({ engagement }) => engagement.dropbox_path)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replaceAll("\\", "/").toLowerCase()),
  );

  const unclaimed = folders.filter((name) => {
    const relative = `${PERMIT_QAQC_SUBDIR}/${name}`.replaceAll("\\", "/").toLowerCase();
    return !linked.has(relative);
  });

  if (folders.length === 0) {
    console.log(`No folders found under "${PERMIT_QAQC_SUBDIR}".`);
    return;
  }
  if (unclaimed.length === 0) {
    console.log("Every real Permit QAQC folder is already linked to an engagement.");
    return;
  }

  console.log(`${unclaimed.length} of ${folders.length} Permit QAQC folder(s) have no linked engagement yet:\n`);
  for (const name of unclaimed) {
    const suggestedSlug = slugifyProjectName(name, name);
    const suggestedDropboxPath = `${PERMIT_QAQC_SUBDIR}/${name}`.replaceAll("\\", "/");
    console.log(`  ${name}`);
    console.log(`    suggested slug:         ${suggestedSlug}`);
    console.log(`    suggested dropbox_path: ${suggestedDropboxPath}`);
  }

  console.log(
    "\nThese are suggestions only -- create each engagement in the Permit QAQC UI (name and " +
      "submitting firm as they actually are), then paste in the exact dropbox_path above.",
  );
}

main();
