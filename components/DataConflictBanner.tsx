import type { ConflictedFile } from "@/lib/content/dropboxConflicts";
import { StatusNotice } from "@/components/UiState";

/**
 * Read-only. Resolution stays manual by design (open Dropbox, review, keep/delete the
 * copy yourself) -- matches the "no silent auto-resolve" philosophy already documented
 * for the agent-harness's own conflict handling.
 */
export function DataConflictBanner({ conflicts }: { conflicts: ConflictedFile[] }) {
  if (conflicts.length === 0) return null;
  return (
    <StatusNotice
      tone="warning"
      title={`Mi found ${conflicts.length} file${conflicts.length === 1 ? "" : "s"} that look${conflicts.length === 1 ? "s" : ""} like unresolved Dropbox sync conflicts.`}
    >
      <p className="text-xs">
        Review and resolve them in Dropbox (keep the version you want, delete the other),
        then refresh. Mi never picks one automatically.
      </p>
      <ul className="mt-2 space-y-1">
        {conflicts.map((conflict) => (
          <li key={conflict.path} className="text-xs">
            <code>{conflict.name}</code>
            <span className="text-muted-foreground"> — likely a duplicate of </span>
            <code>{conflict.likelyOriginalName}</code>
          </li>
        ))}
      </ul>
    </StatusNotice>
  );
}
