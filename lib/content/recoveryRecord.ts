import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface RecoveryRecord {
  version: 1;
  id: string;
  target: string;
  expectedHash: string | null;
  payloadHash: string;
  createdAt: string;
}

export function fileDigest(file: string): string | null {
  let fd: number;
  try { fd = fs.openSync(file, "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    let count: number;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}

/** Immutable recovery evidence beside the destination; never overwrite a previous attempt. */
export function preserveRecovery(source: string, target: string, expectedHash: string | null): string {
  const folder = path.join(path.dirname(target), ".mi-recovery");
  fs.mkdirSync(folder, { recursive: true });
  if (fs.lstatSync(folder).isSymbolicLink()) throw new Error("Recovery folder must not be a link.");
  const id = randomUUID();
  const payload = path.join(folder, `${id}.payload`);
  fs.copyFileSync(source, payload, fs.constants.COPYFILE_EXCL);
  const payloadHash = fileDigest(payload)!;
  if (fileDigest(source) !== payloadHash) throw new Error("Save changed while preserving recovery content.");
  if (expectedHash !== null) {
    const before = path.join(folder, `${id}.before`);
    fs.copyFileSync(target, before, fs.constants.COPYFILE_EXCL);
    if (fileDigest(before) !== expectedHash) throw new Error("Destination changed; review it before retrying.");
    const beforeFd = fs.openSync(before, "r+");
    try { fs.fsyncSync(beforeFd); } finally { fs.closeSync(beforeFd); }
  }
  const fd = fs.openSync(payload, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const record: RecoveryRecord = { version: 1, id, target: path.basename(target), expectedHash, payloadHash, createdAt: new Date().toISOString() };
  const manifest = path.join(folder, `${id}.json`);
  const manifestFd = fs.openSync(manifest, "wx");
  try { fs.writeFileSync(manifestFd, JSON.stringify(record)); fs.fsyncSync(manifestFd); }
  finally { fs.closeSync(manifestFd); }
  return manifest;
}
