import type { WorkLogEntry } from "@/lib/schema";
import type { ProjectTimeEntryDraft } from "@/lib/projectCopilot";

export interface WorklogRepository {
  load(): WorkLogEntry[];
  save(entries: WorkLogEntry[]): void;
}

export interface WorklogCreateAdapter {
  create(input: ProjectTimeEntryDraft & { projectPageId: string; attendeeIds: string[] }): Promise<{
    id: string;
    url: string;
  }>;
}

export interface WorklogSyncResult {
  status: "preview" | "success" | "already-applied" | "pending-review" | "failed";
  entry?: WorkLogEntry;
  error?: string;
}

/**
 * Confirmation and idempotency boundary for conversational hours entries.
 * A pending sync key is persisted before Notion is called, so an uncertain
 * retry cannot silently duplicate company time.
 */
export async function syncWorklogEntry(input: {
  confirmed: boolean;
  syncKey: string;
  projectPageId: string | null;
  attendeeIds: string[];
  draft: ProjectTimeEntryDraft;
  repository: WorklogRepository;
  adapter: WorklogCreateAdapter;
}): Promise<WorklogSyncResult> {
  if (!input.confirmed) return { status: "preview" };
  if (!input.projectPageId) return { status: "failed", error: "This project is not linked to Notion." };

  let entries = input.repository.load();
  const prior = entries.find((entry) => entry.sync_key === input.syncKey);
  if (prior) {
    return {
      status: prior.notion_event_id ? "already-applied" : "pending-review",
      entry: prior,
      error: prior.notion_event_id
        ? undefined
        : "A prior confirmed attempt is pending review; Mi will not create a possible duplicate.",
    };
  }

  const pending: WorkLogEntry = {
    id: `pending-${input.syncKey}`,
    ...input.draft,
    notion_event_id: null,
    notion_url: null,
    sync_key: input.syncKey,
  };
  const beforeAttempt = entries;
  entries = [...entries, pending];
  let pendingPersisted = false;
  let created: { id: string; url: string } | null = null;
  try {
    input.repository.save(entries);
    pendingPersisted = true;
    created = await input.adapter.create({
      ...input.draft,
      projectPageId: input.projectPageId,
      attendeeIds: input.attendeeIds,
    });
    const confirmed: WorkLogEntry = {
      ...pending,
      id: `notion-${created.id}`,
      notion_event_id: created.id,
      notion_url: created.url,
    };
    entries = entries.map((entry) => entry.id === pending.id ? confirmed : entry);
    input.repository.save(entries);
    return { status: "success", entry: confirmed };
  } catch (cause) {
    if (!pendingPersisted) {
      try { input.repository.save(beforeAttempt); } catch { /* best-effort rollback */ }
    }
    return {
      status: pendingPersisted ? "pending-review" : "failed",
      entry: pendingPersisted ? pending : undefined,
      error: created
        ? `Notion created ${created.id}, but local linkage failed. Review before retrying.`
        : pendingPersisted
          ? "The confirmed request may have reached Notion. Review before retrying."
          : (cause instanceof Error ? cause.message : "The time entry could not be saved."),
    };
  }
}
