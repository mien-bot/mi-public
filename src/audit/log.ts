import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@/lib/content/paths";

export interface AuditEntry {
  timestamp: string;
  command: string;
  actor: string;
  slug: string;
  diff: unknown;
  applied: boolean;
}

const AUDIT_LOG_PATH = path.join(REPO_ROOT, ".mi", "audit", "notion-sync.log");

/** Appends one JSON line to .mi/audit/notion-sync.log, creating the folder lazily. */
export function recordAudit(entry: Omit<AuditEntry, "timestamp">): void {
  fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.appendFileSync(AUDIT_LOG_PATH, line + "\n", "utf-8");
}
