import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml } from "js-yaml";
import { ContentConflictError, readCurrentHash } from "./atomicContentWrite";
import { renameDurably, retryWhileLocked } from "./durableRename";

export interface RecoverableWriteResult {
  filePath: string;
  backupPath: string | null;
}

export interface RecoverableDeleteResult {
  filePath: string;
  backupPath: string;
}

function uniqueSuffix(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

export function writeYamlAtomically(
  filePath: string,
  value: unknown,
  options: { backupDirectory?: string; expectedHash?: string | null } = {},
): RecoverableWriteResult {
  if (options.expectedHash !== undefined) {
    const currentHash = readCurrentHash(filePath);
    if (currentHash !== options.expectedHash) {
      throw new ContentConflictError(filePath, options.expectedHash, currentHash);
    }
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialized = dumpYaml(value, { lineWidth: 100, noRefs: true });
  const temporaryPath = `${filePath}.${uniqueSuffix()}.tmp`;
  let backupPath: string | null = null;

  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    if (fs.existsSync(filePath)) {
      const backupDirectory = options.backupDirectory ?? path.join(path.dirname(filePath), ".mi-backups");
      fs.mkdirSync(backupDirectory, { recursive: true });
      const backupTarget = path.join(backupDirectory, `${path.basename(filePath)}.${uniqueSuffix()}.bak`);
      retryWhileLocked(() => fs.copyFileSync(filePath, backupTarget, fs.constants.COPYFILE_EXCL));
      backupPath = backupTarget;
    }
    renameDurably(temporaryPath, filePath);
    return { filePath, backupPath };
  } catch (cause) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath);
    throw cause;
  }
}

export function deleteFileRecoverably(
  filePath: string,
  backupDirectory = path.join(path.dirname(filePath), ".mi-backups"),
): RecoverableDeleteResult {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(filePath)}.${uniqueSuffix()}.deleted.bak`,
  );
  retryWhileLocked(() => fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL));
  try {
    retryWhileLocked(() => fs.rmSync(filePath));
  } catch (cause) {
    fs.rmSync(backupPath, { force: true });
    throw cause;
  }
  return { filePath, backupPath };
}

/** Same recoverable-copy-then-remove discipline as deleteFileRecoverably, for a whole folder (e.g. leads/<slug>/ with its site-visits/contracts/photos). */
export function deleteDirectoryRecoverably(
  dirPath: string,
  backupDirectory = path.join(path.dirname(dirPath), ".mi-backups"),
): RecoverableDeleteResult {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(dirPath)}.${uniqueSuffix()}.deleted`,
  );
  fs.cpSync(dirPath, backupPath, { recursive: true, errorOnExist: true });
  try {
    // maxRetries is fs.rmSync's own answer to the same Windows lock durableRename works around.
    fs.rmSync(dirPath, { recursive: true, maxRetries: 5, retryDelay: 100 });
  } catch (cause) {
    fs.rmSync(backupPath, { recursive: true, force: true });
    throw cause;
  }
  return { filePath: dirPath, backupPath };
}
