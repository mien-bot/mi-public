import path from "node:path";
import { REPO_ROOT } from "./paths";
import { appendMemoryNoteFile } from "./projectWorkspace";

export type FirmMemoryScope = "leads";

/** Mirrors electron/firmScopedAgentContext.js's development-mode memory path for each scope --
 * the exact file the firm-scoped chat persona is told to consult, so a confirmed write here is
 * what future conversations in that scope actually read back. */
const FIRM_MEMORY_FILENAME: Record<FirmMemoryScope, string> = {
  leads: "lead-precontract.md",
};

export function firmMemoryPath(scope: FirmMemoryScope): string {
  return path.join(REPO_ROOT, ".agent", "memory", "shared", FIRM_MEMORY_FILENAME[scope]);
}

/** Appends a confirmed, reviewed note to the shared, git-tracked firm playbook for `scope`.
 * This is a normal working-tree file write -- it does not commit or push. Alex (or whoever
 * confirmed it) still commits the change in git to actually share it with the rest of the firm. */
export function appendFirmMemoryNote(scope: FirmMemoryScope, note: { title: string; entry: string }): string {
  return appendMemoryNoteFile(firmMemoryPath(scope), note);
}
