/**
 * Finds the stale `Mi/notes.md` left in Dropbox project workspaces by an older Mi version.
 *
 * That file was a second copy of `memory/notes.md`, written once by a mirror that no longer
 * runs (electron/memoryMirror.js). The live writer only ever appends to `Mi/memory/notes.md`,
 * so the root copy freezes at whatever it said the day it was written -- and an agent that
 * reads it gets project knowledge that is silently months out of date.
 *
 * Read-only by default: it lists what it found and changes nothing. Pass --delete to remove
 * the stale copies, and only ever the ones with a live `memory/notes.md` beside them, after
 * copying each to `Mi/.mi-backups/`. A root file with no live counterpart is reported and
 * always kept -- it may be the only copy of something.
 *
 * Usage:
 *   npm run find-orphan-project-notes
 *   npm run find-orphan-project-notes -- --delete
 */
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not found -- env vars may already be set another way.
}

interface Finding {
  slug: string;
  rootFile: string;
  liveFile: string | null;
  identical: boolean;
  rootModified: string;
  liveModified: string | null;
}

function readIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const remove = process.argv.includes("--delete");
  const { getAllProjects } = await import("../lib/content/projects");
  const { DROPBOX_ROOT } = await import("../lib/content/paths");

  if (!DROPBOX_ROOT) {
    console.error("Set DROPBOX_ROOT in .env.local before running this.");
    process.exitCode = 1;
    return;
  }

  const findings: Finding[] = [];
  for (const project of getAllProjects()) {
    const dropboxPath = project.meta.dropbox_path;
    if (!dropboxPath) continue;
    const miDir = path.resolve(DROPBOX_ROOT, dropboxPath, "Mi");
    // Never step outside the confirmed root, even if a dropbox_path is malformed.
    if (!path.resolve(miDir).startsWith(path.resolve(DROPBOX_ROOT))) continue;

    const rootFile = path.join(miDir, "notes.md");
    if (!fs.existsSync(rootFile)) continue;
    const liveFile = path.join(miDir, "memory", "notes.md");
    const liveExists = fs.existsSync(liveFile);
    const rootContent = readIfPresent(rootFile);
    const liveContent = liveExists ? readIfPresent(liveFile) : null;
    findings.push({
      slug: project.slug,
      rootFile,
      liveFile: liveExists ? liveFile : null,
      identical: rootContent !== null && rootContent === liveContent,
      rootModified: fs.statSync(rootFile).mtime.toISOString().slice(0, 10),
      liveModified: liveExists ? fs.statSync(liveFile).mtime.toISOString().slice(0, 10) : null,
    });
  }

  if (findings.length === 0) {
    console.log("No stale Mi/notes.md found in any linked project workspace.");
    return;
  }

  console.log(`Found ${findings.length} project workspace(s) with a root Mi/notes.md:\n`);
  for (const finding of findings) {
    const state = !finding.liveFile
      ? "NO memory/notes.md beside it -- keeping, this may be the only copy"
      : finding.identical
        ? "identical to memory/notes.md -- safe to remove"
        : `DIFFERS from memory/notes.md (root ${finding.rootModified}, live ${finding.liveModified})`;
    console.log(`- ${finding.slug}: ${state}`);
    console.log(`    ${finding.rootFile}`);
  }

  if (!remove) {
    console.log("\nNothing was changed. Re-run with --delete to remove the stale copies.");
    return;
  }

  let removed = 0;
  for (const finding of findings) {
    if (!finding.liveFile) continue;
    const backupDir = path.join(path.dirname(finding.rootFile), ".mi-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `notes.md.${Date.now()}.bak`);
    fs.copyFileSync(finding.rootFile, backup, fs.constants.COPYFILE_EXCL);
    fs.rmSync(finding.rootFile);
    removed += 1;
    console.log(`\nRemoved ${finding.slug}: ${finding.rootFile}\n  backup: ${backup}`);
  }
  const kept = findings.length - removed;
  console.log(`\nRemoved ${removed} stale copy/copies.${kept > 0 ? ` Kept ${kept} with no live counterpart.` : ""}`);
}

void main();
