import fs from "node:fs";
import path from "node:path";
import { DROPBOX_ROOT } from "./paths";

/**
 * Mirrors the packaged-app gate in electron/projectRuntime.js's
 * resolveInstalledProjectWorkspace and app/api/projects/[slug]/ai/route.ts's
 * projectAgentCwd (same escapes-DROPBOX_ROOT guard, same AGENTS.md/CLAUDE.md
 * check) but read-only and boolean, so it can be called freely while
 * building portfolio attention reasons without throwing. The dev checkout
 * has no such gate (see those two call sites), so this always reports
 * confirmed there.
 */
export function isAgentWorkspaceConfirmed(dropboxPath: string | null): boolean {
  if (process.env.MI_DESKTOP_PACKAGED !== "1") return true;
  if (!DROPBOX_ROOT || !dropboxPath || path.isAbsolute(dropboxPath)) return false;
  if (!fs.existsSync(DROPBOX_ROOT) || !fs.statSync(DROPBOX_ROOT).isDirectory()) return false;

  const resolvedRoot = fs.realpathSync(DROPBOX_ROOT);
  const projectCandidate = path.resolve(resolvedRoot, dropboxPath);
  const relative = path.relative(resolvedRoot, projectCandidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  if (!fs.existsSync(projectCandidate) || !fs.statSync(projectCandidate).isDirectory()) return false;

  const workspace = path.join(fs.realpathSync(projectCandidate), "Mi");
  return fs.existsSync(path.join(workspace, "AGENTS.md")) && fs.existsSync(path.join(workspace, "CLAUDE.md"));
}
