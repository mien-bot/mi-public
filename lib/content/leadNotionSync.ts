import { getLastSiteVisitDate, getSiteVisits } from "./leads";
import { getLeadMeetingNotes } from "./leadWorkspace";
import { updateLead } from "./leadMutations";
import { createNotionLead, updateNotionLead } from "@/src/adapters/notion/leads";
import { isWriteAllowed } from "@/src/policies/approvals";
import type { Lead } from "@/lib/schema";

export interface LeadNotionSyncResult {
  notionSynced: boolean;
  notionUrl: string | null;
  notionError: string | null;
  /** Reflects a self-assigned notion_page_id on first sync -- see updateLead call below. */
  lead: Lead;
}

/**
 * Pushes a lead's current state to Notion -- creating its page on the first sync (self-assigning
 * notion_page_id) or updating an already-linked one. Shared by PATCH /api/leads/[slug] and the
 * lead-conversion route, which previously bypassed this entirely by calling updateLead directly
 * -- extracted so both save paths stay in sync with Notion identically instead of one silently
 * skipping it.
 */
export async function syncLeadToNotion(slug: string, lead: Lead): Promise<LeadNotionSyncResult> {
  if (lead.notion_page_id) {
    if (!isWriteAllowed("lead", "status")) {
      return { notionSynced: false, notionUrl: null, notionError: null, lead };
    }
    try {
      await updateNotionLead(
        lead.notion_page_id,
        lead,
        getLastSiteVisitDate(slug),
        getSiteVisits(slug),
        getLeadMeetingNotes(slug),
      );
      return { notionSynced: true, notionUrl: null, notionError: null, lead };
    } catch (cause) {
      return {
        notionSynced: false,
        notionUrl: null,
        notionError: cause instanceof Error ? cause.message : "Notion sync failed.",
        lead,
      };
    }
  }

  if (!isWriteAllowed("lead", "create")) {
    return { notionSynced: false, notionUrl: null, notionError: null, lead };
  }
  try {
    const page = await createNotionLead(
      lead,
      getLastSiteVisitDate(slug),
      getSiteVisits(slug),
      getLeadMeetingNotes(slug),
    );
    const updated = updateLead(slug, { ...lead, notion_page_id: page.id });
    return { notionSynced: true, notionUrl: page.url, notionError: null, lead: updated.lead };
  } catch (cause) {
    return {
      notionSynced: false,
      notionUrl: null,
      notionError: cause instanceof Error ? cause.message : "Notion sync failed.",
      lead,
    };
  }
}
