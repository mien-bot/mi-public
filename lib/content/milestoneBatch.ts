import { hashContent } from "./atomicContentWrite";
import type { Milestone } from "@/lib/schema";

export type MilestoneBatchAction = "archive" | "restore" | "delete";
export type MilestoneBatchItem = {
  id: string; name: string; plannedDate: string;
  notion: { eventPageId: string; name: string; expectedLastEditedTime: string } | null;
};
export type MilestoneBatchPreview = {
  action: MilestoneBatchAction; items: MilestoneBatchItem[]; fingerprint: string;
};
export interface MilestoneBatchRepository {
  load(): { milestones: Milestone[]; hash: string | null; projectPageId: string | null };
  save(milestones: Milestone[], expectedHash: string | null): void;
  canRemove(): boolean;
  readNotion(id: string): Promise<{ name: string; lastEditedTime: string | null; projectPageIds: string[] }>;
  trashNotion(input: NonNullable<MilestoneBatchItem["notion"]>): Promise<void>;
}
const normalizeId = (id: string) => id.replaceAll("-", "").toLowerCase();

export async function previewMilestoneBatch(
  slug: string, action: MilestoneBatchAction, ids: string[], expectedHash: string | null,
  repository: MilestoneBatchRepository,
): Promise<MilestoneBatchPreview> {
  const current = repository.load();
  if (current.hash !== expectedHash) throw new Error("This schedule changed. Reload and review the selection again.");
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("Select 1–100 distinct milestones.");
  const items: MilestoneBatchItem[] = [];
  for (const id of ids) {
    const item = current.milestones.find((entry) => entry.id === id);
    if (!item) throw new Error("A selected milestone no longer exists. Reload the schedule.");
    if (action === "archive" && item.archived_at || action === "restore" && !item.archived_at) throw new Error("Archive state changed. Review the selection again.");
    let notion: MilestoneBatchItem["notion"] = null;
    if (action === "delete" && item.notion_event_id) {
      if (!repository.canRemove()) throw new Error("Notion deletion is disabled by schedule.remove in mi.config.yaml. You can archive these items in Mi instead.");
      const remote = await repository.readNotion(item.notion_event_id);
      if (!current.projectPageId || !remote.projectPageIds.some((id) => normalizeId(id) === normalizeId(current.projectPageId!))) throw new Error("The linked Notion item is no longer related to this confirmed project.");
      if (!remote.lastEditedTime) throw new Error("Notion did not provide an edit timestamp. Deletion cannot be reviewed safely.");
      notion = { eventPageId: item.notion_event_id, name: remote.name, expectedLastEditedTime: remote.lastEditedTime };
    }
    items.push({ id, name: item.name, plannedDate: item.planned_date, notion });
  }
  return { action, items, fingerprint: hashContent(JSON.stringify({ slug, action, expectedHash, items })) };
}

export async function applyMilestoneBatch(
  slug: string, action: MilestoneBatchAction, ids: string[], expectedHash: string | null,
  fingerprint: string, repository: MilestoneBatchRepository,
) {
  // Preflight every selected record before the first write, including remote membership and edits.
  const preview = await previewMilestoneBatch(slug, action, ids, expectedHash, repository);
  if (preview.fingerprint !== fingerprint) throw new Error("The reviewed batch changed. Preview it again before confirming.");
  let hash = expectedHash;
  const results: { id: string; name: string; status: "applied" | "failed" | "partial"; message: string }[] = [];
  for (const item of preview.items) {
    let notionRemoved = false;
    try {
      const current = repository.load();
      if (current.hash !== hash) throw new Error("The schedule changed during this batch. Reload before retrying.");
      if (item.notion) {
        await repository.trashNotion(item.notion);
        notionRemoved = true;
      }
      const next = action === "delete"
        ? current.milestones.filter((entry) => entry.id !== item.id)
        : current.milestones.map((entry) => entry.id === item.id
          ? { ...entry, archived_at: action === "archive" ? new Date().toISOString() : undefined }
          : entry);
      repository.save(next, hash);
      hash = repository.load().hash;
      results.push({ id: item.id, name: item.name, status: "applied", message: action === "delete" ? (notionRemoved ? "Deleted from Mi and moved to Notion Trash." : "Deleted from Mi.") : action === "archive" ? "Archived in Mi." : "Restored in Mi." });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "Could not apply this item.";
      results.push({ id: item.id, name: item.name, status: notionRemoved ? "partial" : "failed", message: notionRemoved ? `Moved to Notion Trash, but Mi's record could not be removed. ${error}` : error });
    }
  }
  return { results, hash };
}
