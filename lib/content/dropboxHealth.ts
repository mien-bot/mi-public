import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DropboxNode } from "./dropbox";
import { isConflictedCopyName } from "./dropboxConflicts";
import type { RecoveryRecord } from "./recoveryRecord";

export interface DropboxHealth {
  state: "available" | "slow" | "unavailable" | "checking";
  checkedAt: string | null;
  lastSuccessAt: string | null;
  elapsedMs: number;
  cached: boolean;
  complete: boolean;
  cloudSync: "unverified";
  nodes: DropboxNode[];
  conflicts: Array<{ path: string; original: string }>;
  recoveries: Array<{ path: string; target: string; createdAt: string }>;
  warnings: string[];
}
const cache = new Map<string, { value?: DropboxHealth; pending?: Promise<DropboxHealth> }>();
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const MAX_FILE = 20 * 1024 * 1024;
function conflictOriginal(relative: string): string {
  const name = path.posix.basename(relative).replace(/\s\((?:[^)]*?conflicted copy[^)]*?|[^)]*?case-conflict[^)]*?)\)(?=\.[^.]+$|$)/i, "");
  return path.posix.join(path.posix.dirname(relative), name);
}

/** Async containment check, including every ancestor. No junctions, ADS or device paths. */
export async function healthPath(root: string, relative: string, internal = false): Promise<string> {
  const segments = relative.split("/");
  if (!relative || relative.length > 1000 || segments.some(s => !s || s === "." || s === ".." || /[\\:\x00-\x1f<>"|?*]/.test(s) || /[. ]$/.test(s)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s) || (!internal && s.startsWith(".")))) throw new Error("Invalid file path.");
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Linked paths are not supported.");
      const rel = path.relative(realRoot, await fs.realpath(current));
      if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) throw new Error("Path leaves the confirmed folder.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return current;
}

async function boundedRead(file: string): Promise<Buffer | null> {
  let handle;
  try { handle = await fs.open(file, "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE) throw new Error("Review files up to 20 MB here; use Dropbox for larger files.");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw new Error("File changed during reading. Refresh the review.");
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("File changed during reading. Refresh the review.");
    return buffer;
  } finally { await handle.close(); }
}

async function recordAt(root: string, relative: string) {
  if (!/(^|\/)\.mi-recovery\/[a-f0-9-]{36}\.json$/.test(relative)) throw new Error("Invalid recovery record.");
  const manifest = await healthPath(root, relative, true);
  const bytes = await boundedRead(manifest);
  if (!bytes || bytes.length > 4096) throw new Error("Recovery record unavailable.");
  const value = JSON.parse(bytes.toString()) as RecoveryRecord;
  if (value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.id) || path.basename(manifest) !== `${value.id}.json`
    || typeof value.target !== "string" || /[\\/]/.test(value.target)
    || !/^[a-f0-9]{64}$/.test(value.payloadHash) || !(value.expectedHash === null || /^[a-f0-9]{64}$/.test(value.expectedHash))) throw new Error("Invalid recovery record.");
  const parent = path.posix.dirname(path.posix.dirname(relative));
  const target = parent === "." ? value.target : `${parent}/${value.target}`;
  await healthPath(root, target); // records cannot redirect to hidden or arbitrary files
  return { value, target, payload: `${path.posix.dirname(relative)}/${value.id}.payload` };
}

async function scan(root: string, previous?: DropboxHealth): Promise<DropboxHealth> {
  const started = Date.now();
  const result: DropboxHealth = { state: "available", checkedAt: null, lastSuccessAt: previous?.lastSuccessAt ?? null,
    elapsedMs: 0, cached: false, complete: true, cloudSync: "unverified", nodes: [], conflicts: [], recoveries: [], warnings: [] };
  let visited = 0;
  const warn = (message: string) => { result.complete = false; if (!result.warnings.includes(message)) result.warnings.push(message); };
  async function walk(relative: string, depth: number): Promise<DropboxNode[]> {
    if (depth > 6 || visited >= 2000 || Date.now() - started > 8000) { warn("Listing limit reached. Browse deeper folders in Dropbox."); return []; }
    const folder = relative ? await healthPath(root, relative) : await fs.realpath(root);
    const entries = await fs.readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const nodes: DropboxNode[] = [];
    for (const entry of entries) {
      if (++visited > 2000 || Date.now() - started > 8000) { warn("Listing limit reached. Browse deeper folders in Dropbox."); break; }
      if (entry.isSymbolicLink()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name === ".mi-recovery" && entry.isDirectory()) {
        const records = await fs.readdir(await healthPath(root, rel, true));
        if (records.length > 300) warn("Some older recovery records are outside this listing.");
        for (const name of records.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).slice(-100)) {
          if (records.includes(`${name}.done`)) continue;
          if (Date.now() - started > 8000) { warn("Recovery scan is incomplete. Refresh after Dropbox finishes."); break; }
          try {
            const record = await recordAt(root, `${rel}/${name}`);
            // Completed writes need no recovery action. Bounded reading never hydrates
            // arbitrary large project documents as part of ordinary file browsing.
            const target = await boundedRead(await healthPath(root, record.target));
            if (!target || hash(target) !== record.value.payloadHash) result.recoveries.push({ path: `${rel}/${name}`, target: record.target, createdAt: record.value.createdAt });
          } catch { warn("A recovery record needs manual inspection in its .mi-recovery folder."); }
        }
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const node: DropboxNode = { name: entry.name, relativePath: rel, isDirectory: entry.isDirectory() };
      if (entry.isDirectory()) {
        try { node.children = await walk(rel, depth + 1); }
        catch { warn("A subfolder could not be read. Check local availability and refresh."); node.children = []; }
      } else if (entry.isFile() && isConflictedCopyName(entry.name)) {
        const original = conflictOriginal(rel);
        result.conflicts.push({ path: rel, original });
      }
      nodes.push(node);
    }
    return nodes.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  }
  try {
    result.nodes = await walk("", 0);
    result.lastSuccessAt = new Date().toISOString();
  } catch {
    result.state = "unavailable"; result.complete = false;
    result.warnings.push("The confirmed folder is unavailable. Check Dropbox, offline availability, and Settings > Connections.");
    if (previous) { result.nodes = previous.nodes; result.cached = true; }
  }
  result.elapsedMs = Date.now() - started;
  result.checkedAt = new Date().toISOString();
  if (result.state === "available" && result.elapsedMs > 1500) result.state = "slow";
  return result;
}

export async function readDropboxHealth(root: string, refresh = false, waitMs = 1500): Promise<DropboxHealth> {
  const key = path.resolve(root);
  let entry = cache.get(key);
  if (!entry) { if (cache.size >= 50) cache.delete(cache.keys().next().value!); entry = {}; cache.set(key, entry); }
  if (!refresh && entry.value?.checkedAt && Date.now() - Date.parse(entry.value.checkedAt) < 15_000) return { ...entry.value, cached: true };
  if (!entry.pending) {
    const captured = entry;
    captured.pending = scan(root, captured.value).then(value => { captured.value = value; return value; }).finally(() => { captured.pending = undefined; });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([entry.pending!, new Promise<DropboxHealth>(resolve => { timer = setTimeout(() => resolve({
      state: "checking", checkedAt: entry!.value?.checkedAt ?? null, lastSuccessAt: entry!.value?.lastSuccessAt ?? null,
      elapsedMs: waitMs, cached: Boolean(entry!.value), complete: false, cloudSync: "unverified", nodes: entry!.value?.nodes ?? [],
      conflicts: [], recoveries: [], warnings: ["Folder scan is still running. Refresh to check its result."],
    }), waitMs); })]);
  } finally { clearTimeout(timer); }
}

export interface FileReview {
  kind: "recovery" | "conflict";
  path: string;
  target: string;
  currentHash: string | null;
  proposedHash: string;
  currentText: string;
  proposedText: string;
  currentSize: number;
  proposedSize: number;
  canApply: boolean;
  reason: string;
}
const preview = (value: Buffer | null) => !value ? "(File does not exist)" : value.includes(0) ? "Binary file; compare using its file link before confirming." : value.subarray(0, 32_000).toString("utf8") + (value.length > 32_000 ? "\n[Preview truncated]" : "");

export async function reviewDropboxFile(root: string, kind: "recovery" | "conflict", relative: string): Promise<FileReview> {
  let target: string, source: string, expected: string | null | undefined, payloadHash: string | undefined;
  if (kind === "recovery") {
    const record = await recordAt(root, relative);
    target = record.target; source = record.payload; expected = record.value.expectedHash; payloadHash = record.value.payloadHash;
  } else {
    if (!isConflictedCopyName(path.posix.basename(relative))) throw new Error("Choose a Dropbox conflicted copy.");
    source = relative;
    target = conflictOriginal(relative);
  }
  const current = await boundedRead(await healthPath(root, target));
  const proposed = await boundedRead(await healthPath(root, source, kind === "recovery"));
  if (!proposed) throw new Error("Proposed content is unavailable.");
  const currentHash = current ? hash(current) : null, proposedHash = hash(proposed);
  if (payloadHash && proposedHash !== payloadHash) throw new Error("Recovery content failed its integrity check.");
  const canApply = currentHash !== proposedHash && (expected === undefined || currentHash === expected);
  return { kind, path: relative, target, currentHash, proposedHash, currentText: preview(current), proposedText: preview(proposed),
    currentSize: current?.length ?? 0, proposedSize: proposed.length, canApply,
    reason: currentHash === proposedHash ? "This content is already saved locally." : !canApply ? "The destination changed since this save. Keep both versions and resolve in Dropbox." : "The current version will be backed up. The other copy will be retained." };
}

const applying = new Set<string>();

/** Full bounded bytes for human review, always downloaded as an attachment. */
export async function downloadDropboxReview(root: string, reviewed: FileReview, side: "current" | "proposed") {
  const relative = side === "current" ? reviewed.target : reviewed.kind === "recovery" ? (await recordAt(root, reviewed.path)).payload : reviewed.path;
  const bytes = await boundedRead(await healthPath(root, relative, side === "proposed" && reviewed.kind === "recovery"));
  if (!bytes || hash(bytes) !== (side === "current" ? reviewed.currentHash : reviewed.proposedHash)) throw new Error("File changed. Review again.");
  return bytes;
}

/** Only exact reviewed bytes; asynchronous retries never block the Next event loop. */
export async function applyDropboxReview(root: string, reviewed: FileReview): Promise<void> {
  const target = await healthPath(root, reviewed.target);
  if (applying.has(target)) throw new Error("Another save is in progress. Refresh and retry.");
  applying.add(target);
  let staged: string | undefined;
  try {
    const fresh = await reviewDropboxFile(root, reviewed.kind, reviewed.path);
    if (!fresh.canApply || fresh.target !== reviewed.target || fresh.currentHash !== reviewed.currentHash || fresh.proposedHash !== reviewed.proposedHash) throw new Error("Files changed since review. Refresh and review again.");
    const source = reviewed.kind === "recovery" ? (await recordAt(root, reviewed.path)).payload : reviewed.path;
    const bytes = await boundedRead(await healthPath(root, source, reviewed.kind === "recovery"));
    if (!bytes || hash(bytes) !== reviewed.proposedHash) throw new Error("Proposed content changed. Review again.");
    if (reviewed.currentHash !== null) {
      const backupDir = path.join(path.dirname(target), ".mi-backups");
      await fs.mkdir(backupDir, { recursive: true });
      await healthPath(root, path.relative(root, backupDir).split(path.sep).join("/"), true);
      const current = await boundedRead(target);
      if (!current || hash(current) !== reviewed.currentHash) throw new Error("Destination changed. Review again.");
      const backup = await fs.open(path.join(backupDir, `${path.basename(target)}.${randomUUID()}.bak`), "wx");
      try { await backup.writeFile(current); await backup.sync(); } finally { await backup.close(); }
    }
    staged = path.join(path.dirname(target), `.mi-save-${randomUUID()}.tmp`);
    const handle = await fs.open(staged, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      await healthPath(root, reviewed.target);
      const current = await boundedRead(target);
      if ((current ? hash(current) : null) !== reviewed.currentHash) throw new Error("Destination changed. Review again.");
      try { await fs.rename(staged, target); break; }
      catch (error) {
        if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code || "")) throw new Error("File remains locked. Both versions are preserved; retry after Dropbox finishes.");
        await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
    cache.delete(path.resolve(root));
    if (reviewed.kind === "recovery") {
      // A receipt failure happens after the successful save and must not invite a repeat.
      try {
        const receipt = `${await healthPath(root, reviewed.path, true)}.done`;
        await fs.writeFile(receipt, "Saved locally; cloud sync unverified.", { flag: "wx" });
      } catch { /* the destination was already replaced successfully */ }
    }
  } finally { applying.delete(target); if (staged) await fs.rm(staged, { force: true }).catch(() => {}); }
}
