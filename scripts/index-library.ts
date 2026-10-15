/**
 * Creates (if needed) and re-indexes a library/<collection>/ document
 * collection: the "just drop PDFs" counterpart to codes/ — no per-file
 * write-up required.
 *
 * Usage:
 *   npm run index-library -- <collection-slug>
 */
import path from "node:path";
import { indexDocumentFolder } from "./indexDocuments";

const [, , slugArg] = process.argv;

if (!slugArg) {
  console.error("Usage: npm run index-library -- <collection-slug>");
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(slugArg)) {
  console.error(`Invalid slug "${slugArg}" — use lowercase letters, numbers, and hyphens only.`);
  process.exit(1);
}

const collectionDir = path.join(process.cwd(), "library", slugArg);
indexDocumentFolder(collectionDir, `library/${slugArg}/`);
