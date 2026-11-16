import type { Milestone, ScheduleDraftItem } from "@/lib/schema";
import { milestoneCategory } from "@/lib/scheduleInsights";

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
/** The wall-clock time in the item's own offset, which is the time the person chose. */
function startTimeOf(item: ScheduleDraftItem): { start_time?: string } {
  const time = /T(\d{2}:\d{2})/.exec(item.start_time ?? "")?.[1];
  return time ? { start_time: time } : {};
}

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
        type: item.type,
        ...startTimeOf(item),
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
    status: "Not started" | "Done";
    completedDate?: string | null;
  }): Promise<{ id: string; url: string }>;
}

export const sendKeyFor = (milestone: Pick<Milestone, "id">) => `send-${milestone.id}`;

/** Notion answered and refused, so nothing was created and a retry cannot duplicate it. */
const notionRefused = (cause: unknown) => cause instanceof Error && /Notion API 4\d\d/.test(cause.message);

/**
 * Sends one existing Mi-only item to STUDIO Schedule and links it, keeping its id. A key is saved
 * before calling Notion. If Notion may have received the item, the key stays and blocks a
 * retry until a person has checked, so a lost reply cannot make a second row.
 */
export async function sendLocalMilestoneToNotion(input: {
  id: string;
  projectPageId: string | null;
  startTime: string | null;
  endTime: string | null;
  repository: ScheduleSyncRepository;
  adapter: ScheduleCreateAdapter;
  /** Fails before anything is marked, so a setup problem never reads as a possible send. */
  ready?: () => Promise<unknown>;
}): Promise<ScheduleSyncResult> {
  if (!input.projectPageId) throw new Error("This project is not linked to Notion.");
  const milestones = input.repository.load();
  const milestone = milestones.find((item) => item.id === input.id);
  if (!milestone) throw new Error("Milestone not found.");
  const report = { client_request_id: milestone.id, name: milestone.name };
  if (milestone.notion_event_id) return { ...report, status: "already-applied", notion_event_id: milestone.notion_event_id };
  if (milestone.sync_key) {
    return { ...report, status: "pending-review", error: "An earlier send may have reached Notion. Check STUDIO Schedule before sending again." };
  }
  try {
    await input.ready?.();
  } catch (cause) {
    return { ...report, status: "failed", error: cause instanceof Error ? cause.message : "Mi could not reach STUDIO Schedule." };
  }
  const withKey = (changes: Partial<Milestone>) => milestones.map((item) => item.id === milestone.id ? { ...item, ...changes } : item);
  input.repository.save(withKey({ sync_key: sendKeyFor(milestone) }));
  let created: { id: string; url: string };
  try {
    created = await input.adapter.create({
      projectPageId: input.projectPageId,
      name: milestone.name,
      date: milestone.planned_date.slice(0, 10),
      type: milestoneCategory(milestone),
      startTime: input.startTime,
      endTime: input.endTime,
      status: milestone.actual_date ? "Done" : "Not started",
      completedDate: milestone.actual_date,
    });
  } catch (cause) {
    if (notionRefused(cause)) {
      input.repository.save(withKey({ sync_key: null }));
      return { ...report, status: "failed", error: cause instanceof Error ? cause.message : "Notion refused this item." };
    }
    return { ...report, status: "pending-review", error: "Notion did not answer, so this may or may not have arrived. Check STUDIO Schedule before sending again." };
  }
  try {
    input.repository.save(withKey({ sync_key: sendKeyFor(milestone), notion_event_id: created.id }));
  } catch {
    return { ...report, status: "pending-review", notion_event_id: created.id, notion_url: created.url, error: "Notion has this item, but Mi could not record the link. Sync this project from Notion." };
  }
  return { ...report, status: "success", notion_event_id: created.id, notion_url: created.url };
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
      type: item.type,
      ...startTimeOf(item),
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
        type: item.type,
        ...startTimeOf(item),
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
