import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  libraryCollectionMetaSchema,
  libraryDocumentMetadataSchema,
  libraryIndexSchema,
  type LibraryCollectionMeta,
  type LibraryDocument,
} from "@/lib/schema";
import { readCurrentHash } from "./atomicContentWrite";
import { renameDurably } from "./durableRename";
import { LIBRARY_DIR } from "./paths";
import {
  deleteDirectoryRecoverably,
  deleteFileRecoverably,
  writeYamlAtomically,
  type RecoverableWriteResult,
} from "./leadLibraryAtomicWrite";
import {
  assertNoSymlinkOrReparsePoint,
  assertSafeWorkspaceSlug,
  isPathInside,
  resolveExistingFileWithin,
} from "./leadLibraryPathSafety";

export const LIBRARY_DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".dwg", ".doc", ".docx",
]);

export class LibraryWriteError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

export interface LibraryWriteOptions {
  libraryDir?: string;
}

export interface LibraryCollectionWriteResult {
  slug: string;
  meta: LibraryCollectionMeta;
}

export interface LibraryDocumentWriteResult extends RecoverableWriteResult {
  collection: string;
  document: LibraryDocument;
}

function safeSlug(value: unknown): string {
  try {
    return assertSafeWorkspaceSlug(value, "Collection slug");
  } catch (cause) {
    throw new LibraryWriteError((cause as Error).message);
  }
}

function ensureLibraryRoot(root: string): string {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new LibraryWriteError("The local Mi library root is unavailable.", 409);
  }
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new LibraryWriteError("The local Mi library root cannot be a symbolic link.", 409);
  }
  return fs.realpathSync(root);
}

function collectionDirectory(root: string, slug: string): string {
  const target = path.resolve(root, slug);
  if (!isPathInside(root, target)) throw new LibraryWriteError("Collection path escapes the library root.");
  return target;
}

export function createLibraryCollection(
  input: unknown,
  options: LibraryWriteOptions = {},
): LibraryCollectionWriteResult {
  const root = options.libraryDir ?? LIBRARY_DIR;
  ensureLibraryRoot(root);
  const object = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const slug = safeSlug(object.slug);
  const parsedMeta = libraryCollectionMetaSchema.safeParse({ name: object.name });
  if (!parsedMeta.success) {
    throw new LibraryWriteError(parsedMeta.error.issues[0]?.message ?? "Collection name is required.");
  }
  const collision = fs.readdirSync(root, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.toLowerCase() === slug);
  if (collision) throw new LibraryWriteError(`Collection slug "${slug}" already exists.`, 409);

  const target = collectionDirectory(root, slug);
  const temporary = path.join(root, `.mi-new-${slug}-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(temporary);
    writeYamlAtomically(path.join(temporary, "collection.yaml"), parsedMeta.data);
    writeYamlAtomically(path.join(temporary, "index.yaml"), []);
    renameDurably(temporary, target);
  } catch (cause) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    if (cause instanceof LibraryWriteError) throw cause;
    throw new LibraryWriteError((cause as Error).message, 409);
  }
  return { slug, meta: parsedMeta.data };
}

/**
 * Removes a whole library collection: its folder, its indexed documents, and the files
 * themselves.
 *
 * This destroys far more than a single record, so it asks for the collection's exact name
 * back before it will run — the same discipline deleteLead uses, and for the same reason:
 * a slug is easy to mis-click from a list, a typed name is not. The whole directory is
 * copied into `.mi-backups/` first, so even a confirmed mistake is recoverable from disk.
 */
export function deleteLibraryCollection(
  collectionInput: unknown,
  confirmation: { confirmed?: unknown; expectedName?: unknown },
  options: LibraryWriteOptions = {},
): { slug: string; meta: LibraryCollectionMeta; backupPath: string } {
  const root = options.libraryDir ?? LIBRARY_DIR;
  const realRoot = ensureLibraryRoot(root);
  const collection = safeSlug(collectionInput);
  const collectionDir = collectionDirectory(root, collection);
  if (!fs.existsSync(collectionDir) || !fs.statSync(collectionDir).isDirectory()) {
    throw new LibraryWriteError(`Collection "${collection}" was not found.`, 404);
  }
  assertNoSymlinkOrReparsePoint(root, collection);
  if (!isPathInside(realRoot, fs.realpathSync(collectionDir))) {
    throw new LibraryWriteError("Collection path escapes the library root.");
  }
  if (confirmation.confirmed !== true) {
    throw new LibraryWriteError("Collection deletion requires explicit confirmation.");
  }

  const metaPath = path.join(collectionDir, "collection.yaml");
  const meta = libraryCollectionMetaSchema.parse(
    fs.existsSync(metaPath) ? loadYaml(fs.readFileSync(metaPath, "utf8")) : { name: collection },
  );
  if (confirmation.expectedName !== meta.name) {
    throw new LibraryWriteError("Collection name changed. Refresh and confirm deletion again.", 409);
  }

  const { backupPath } = deleteDirectoryRecoverably(collectionDir, path.join(root, ".mi-backups"));
  return { slug: collection, meta, backupPath };
}

/**
 * Removes one document from a collection: the file on disk and its row in `index.yaml`.
 *
 * Both halves matter — dropping only the index row leaves an orphaned file that the next
 * scan re-adds, and deleting only the file leaves an index entry pointing at nothing. The
 * file is backed up recoverably before removal; if the index rewrite then fails, the
 * backup is what makes that recoverable rather than a silent loss.
 */
export function deleteLibraryDocument(
  collectionInput: unknown,
  fileInput: unknown,
  options: LibraryWriteOptions = {},
): { collection: string; file: string; backupPath: string } {
  const root = options.libraryDir ?? LIBRARY_DIR;
  const realRoot = ensureLibraryRoot(root);
  const collection = safeSlug(collectionInput);
  const collectionDir = collectionDirectory(root, collection);
  if (!fs.existsSync(collectionDir) || !fs.statSync(collectionDir).isDirectory()) {
    throw new LibraryWriteError(`Collection "${collection}" was not found.`, 404);
  }
  assertNoSymlinkOrReparsePoint(root, collection);
  if (!isPathInside(realRoot, fs.realpathSync(collectionDir))) {
    throw new LibraryWriteError("Collection path escapes the library root.");
  }

  if (typeof fileInput !== "string") throw new LibraryWriteError("Document path is required.");
  // Resolves the name against the collection and refuses anything outside it or of an
  // unsupported type, which is what keeps a crafted "../../secrets.pdf" from reaching a
  // file it has no business touching. Same call the metadata-update path makes.
  let filePath: string;
  try {
    filePath = resolveExistingFileWithin(collectionDir, fileInput, LIBRARY_DOCUMENT_EXTENSIONS);
  } catch (cause) {
    throw new LibraryWriteError((cause as Error).message);
  }
  const fileName = path.basename(filePath);

  const indexPath = path.join(collectionDir, "index.yaml");
  const current = fs.existsSync(indexPath)
    ? libraryIndexSchema.parse(loadYaml(fs.readFileSync(indexPath, "utf8")) ?? [])
    : [];

  const { backupPath } = deleteFileRecoverably(filePath, path.join(root, ".mi-backups"));
  writeYamlAtomically(indexPath, current.filter((entry) => entry.file !== fileName));
  return { collection, file: fileName, backupPath };
}

export function updateLibraryDocumentMetadata(
  collectionInput: unknown,
  fileInput: unknown,
  metadataInput: unknown,
  options: LibraryWriteOptions = {},
): LibraryDocumentWriteResult {
  const root = options.libraryDir ?? LIBRARY_DIR;
  const realRoot = ensureLibraryRoot(root);
  const collection = safeSlug(collectionInput);
  const collectionDir = collectionDirectory(root, collection);
  if (!fs.existsSync(collectionDir) || !fs.statSync(collectionDir).isDirectory()) {
    throw new LibraryWriteError(`Collection "${collection}" was not found.`, 404);
  }
  assertNoSymlinkOrReparsePoint(root, collection);
  if (!isPathInside(realRoot, fs.realpathSync(collectionDir))) {
    throw new LibraryWriteError("Collection path escapes the library root.");
  }
  if (typeof fileInput !== "string") throw new LibraryWriteError("Document path is required.");
  try {
    resolveExistingFileWithin(collectionDir, fileInput, LIBRARY_DOCUMENT_EXTENSIONS);
  } catch (cause) {
    throw new LibraryWriteError((cause as Error).message);
  }

  const parsedMetadata = libraryDocumentMetadataSchema.safeParse(metadataInput);
  if (!parsedMetadata.success) {
    throw new LibraryWriteError(parsedMetadata.error.issues[0]?.message ?? "Invalid document metadata.");
  }
  const indexPath = path.join(collectionDir, "index.yaml");
  if (!fs.existsSync(indexPath)) throw new LibraryWriteError("Collection index was not found.", 404);
  // Captured at the same moment as the read below (not re-read at write time, which would
  // trivially match whatever's currently on disk and provide no protection) -- no dedicated
  // edit form exists for this record type to capture a hash further upstream, so this closes
  // the race to this function's own read-modify-write window instead.
  const hashAtRead = readCurrentHash(indexPath);
  const raw = loadYaml(fs.readFileSync(indexPath, "utf8"));
  if (!Array.isArray(raw)) throw new LibraryWriteError("Collection index must be a YAML array.");
  const index = raw.findIndex((entry) =>
    Boolean(entry && typeof entry === "object" && (entry as Record<string, unknown>).file === fileInput));
  if (index < 0) throw new LibraryWriteError(`Document "${fileInput}" is not indexed.`, 404);

  const updatedEntry = {
    ...(raw[index] as Record<string, unknown>),
    ...parsedMetadata.data,
  };
  const updatedRaw = [...raw];
  updatedRaw[index] = updatedEntry;
  const validated = libraryIndexSchema.safeParse(updatedRaw);
  if (!validated.success) {
    throw new LibraryWriteError(validated.error.issues[0]?.message ?? "Invalid collection index.");
  }
  const write = writeYamlAtomically(indexPath, updatedRaw, {
    backupDirectory: path.join(collectionDir, ".mi-backups"),
    expectedHash: hashAtRead,
  });
  return {
    ...write,
    collection,
    document: validated.data[index]!,
  };
}
