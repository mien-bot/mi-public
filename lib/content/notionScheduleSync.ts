import type { Milestone, ScheduleDraftItem } from "@/lib/schema";

export interface ScheduleSyncResult {
  client_request_id: string;
  name: string;
  status: "preview" | "success" | "failed" | "already-applied" | "pending-review";
  notion_event_id?: string;
  notion_url?: string;
  error?: string;
}

export interface ScheduleSyncRepository {
  load(): Milestone[];
  save(milestones: Milestone[]): void;
}

export interface LocalScheduleSaveResult {
  id: string;
  alreadySaved: boolean;
}

/**
 * Shared "save Mi-local" write, used by both the schedule route and the chat
 * copilot route so a future Milestone field addition needs updating once.
 * Idempotent on `client_request_id` — a repeat call is a no-op.
 */
export function saveScheduleItemLocally(
  item: ScheduleDraftItem,
  repository: ScheduleSyncRepository,
): LocalScheduleSaveResult {
  const milestones = repository.load();
  const id = `local-${item.client_request_id}`;
  const alreadySaved = milestones.some((milestone) => milestone.id === id);
  if (!alreadySaved) {
    repository.save([
      ...milestones,
      {
        id,
        name: item.name,
        planned_date: item.date,
        actual_date: null,
        notion_event_id: null,
        sync_key: null,
      },
    ]);
  }
  return { id, alreadySaved };
}

export interface ScheduleCreateAdapter {
  create(input: {
    projectPageId: string;
    name: string;
    date: string;
    type: ScheduleDraftItem["type"];
    startTime: string | null;
    endTime: string | null;
    status: "Not started";
  }): Promise<{ id: string; url: string }>;
}

/**
 * The server-side confirmation boundary for every Mi -> STUDIO Schedule create.
 * Items are applied sequentially and persisted after each success so a retry
 * can skip its stable client_request_id instead of duplicating the page.
 */
export async function syncScheduleItems(input: {
  confirmed: boolean;
  projectPageId: string | null;
  items: ScheduleDraftItem[];
  repository: ScheduleSyncRepository;
  adapter: ScheduleCreateAdapter;
}): Promise<ScheduleSyncResult[]> {
  if (!input.confirmed) {
    return input.items.map((item) => ({
      client_request_id: item.client_request_id,
      name: item.name,
      status: "preview",
    }));
  }
  if (!input.projectPageId) throw new Error("This project is not linked to Notion.");

  let milestones = input.repository.load();
  const results: ScheduleSyncResult[] = [];
  for (const item of input.items) {
    const prior = milestones.find((milestone) => milestone.sync_key === item.client_request_id);
    if (prior) {
      results.push({
        client_request_id: item.client_request_id,
        name: item.name,
        status: prior.notion_event_id ? "already-applied" : "pending-review",
        notion_event_id: prior.notion_event_id ?? undefined,
        error: prior.notion_event_id ? undefined : "A prior confirmed attempt is pending review; Mi will not create a possible duplicate.",
      });
      continue;
    }

    const pending: Milestone = {
      id: `pending-${item.client_request_id}`,
      name: item.name,
      planned_date: item.date,
      actual_date: null,
      notion_event_id: null,
      sync_key: item.client_request_id,
    };
    const beforeAttempt = milestones;
    milestones = [...milestones, pending];
    let created: { id: string; url: string } | null = null;
    let pendingPersisted = false;
    try {
      // Persist a pending key before the external action. A crash can then
      // require manual review, but a retry cannot silently create a duplicate.
      input.repository.save(milestones);
      pendingPersisted = true;
      created = await input.adapter.create({
        projectPageId: input.projectPageId,
        name: item.name,
        date: item.date,
        type: item.type,
        startTime: item.start_time,
        endTime: item.end_time,
        status: "Not started",
      });
      const milestone: Milestone = {
        id: `notion-${created.id}`,
        name: item.name,
        planned_date: item.date,
        actual_date: null,
        notion_event_id: created.id,
        sync_key: item.client_request_id,
      };
      milestones = milestones.map((entry) => entry.id === pending.id ? milestone : entry);
      input.repository.save(milestones);
      results.push({
        client_request_id: item.client_request_id,
        name: item.name,
        status: "success",
        notion_event_id: created.id,
        notion_url: created.url,
      });
    } catch (cause) {
      if (!pendingPersisted) {
        // The external request was never attempted, so restoring the prior
        // local state is safe and a later retry cannot duplicate Notion.
        milestones = beforeAttempt;
        try { input.repository.save(milestones); } catch { /* best-effort repair after a local persistence failure */ }
      }
      results.push({
        client_request_id: item.client_request_id,
        name: item.name,
        status: pendingPersisted ? "pending-review" : "failed",
        notion_event_id: created?.id,
        notion_url: created?.url,
        error: created
          ? `Notion created ${created.id}, but local linkage failed. The pending key blocks retry until reviewed.`
          : pendingPersisted
            ? "The confirmed request may have reached Notion. The pending key blocks retry until the result is reviewed."
            : (cause instanceof Error ? cause.message : "Local schedule persistence failed before Notion was called."),
      });
    }
  }
  return results;
}
