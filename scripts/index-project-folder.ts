/**
 * Re-indexes one of a project's raw-file-drop folders (submissions,
 * inspiration, contracts) — same pattern as index-library.ts, scoped to a
 * single project.
 *
 * Usage:
 *   npm run index-project-folder -- <project-slug> <submissions|inspiration|contracts>
 */
import fs from "node:fs";
import path from "node:path";
import { indexDocumentFolder } from "./indexDocuments";

const FOLDERS = ["submissions", "inspiration", "contracts"] as const;

const [, , slugArg, folderArg] = process.argv;

if (!slugArg || !folderArg) {
  console.error("Usage: npm run index-project-folder -- <project-slug> <submissions|inspiration|contracts>");
  process.exit(1);
}

if (!(FOLDERS as readonly string[]).includes(folderArg)) {
  console.error(`Invalid folder "${folderArg}" — must be one of: ${FOLDERS.join(", ")}`);
  process.exit(1);
}

const projectDir = path.join(process.cwd(), "projects", slugArg);
if (!fs.existsSync(projectDir)) {
  console.error(`projects/${slugArg} does not exist.`);
  process.exit(1);
}

const targetDir = path.join(projectDir, folderArg);
indexDocumentFolder(targetDir, `projects/${slugArg}/${folderArg}/`);
