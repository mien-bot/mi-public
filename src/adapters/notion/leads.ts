import { notionFetch } from "./client";
import type { Lead, LeadContractStage, LeadSource, LeadStatus, MeetingNote, SiteVisitEntry } from "@/lib/schema";

/**
 * Unlike studioProjects.ts/schedule.ts (which find their database by searching
 * for a title shared with the integration), the Leads database id comes
 * straight from NOTION_LEADS_DATABASE_ID in .env.local, per the user's
 * explicit instruction -- title search stays as the fallback discovery tool
 * (scripts/notion-probe.ts) rather than the runtime lookup.
 */
export function getLeadsDatabaseId(): string {
  const id = process.env.NOTION_LEADS_DATABASE_ID;
  if (!id) {
    throw new Error("NOTION_LEADS_DATABASE_ID not set — add it to .env.local first.");
  }
  return id;
}

/**
 * Confirmed 2026-07-26 via scripts/notion-probe.ts + a live /v1/databases
 * read against the real "Leads" database -- these are its actual property
 * names/types and select options, not guesses. Source/Status option labels
 * map 1:1 onto leadSourceSchema/leadStatusSchema after Title Case <-> kebab
 * conversion.
 */
const SOURCE_OPTION_TO_ENUM: Record<string, LeadSource> = {
  Referral: "referral",
  Website: "website",
  "Past Client": "past-client",
  "Cold Outreach": "cold-outreach",
  Social: "social",
  Other: "other",
};
const SOURCE_ENUM_TO_OPTION: Record<LeadSource, string> = {
  referral: "Referral",
  website: "Website",
  "past-client": "Past Client",
  "cold-outreach": "Cold Outreach",
  social: "Social",
  other: "Other",
};

const STATUS_OPTION_TO_ENUM: Record<string, LeadStatus> = {
  New: "new",
  Qualified: "qualified",
  "Proposal Sent": "proposal-sent",
  Won: "won",
  Lost: "lost",
  "On Hold": "on-hold",
};
const STATUS_ENUM_TO_OPTION: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  "proposal-sent": "Proposal Sent",
  won: "Won",
  lost: "Lost",
  "on-hold": "On Hold",
};

/**
 * These six properties (Dropbox Folder, Last Site Visit, Contract Stage,
 * Contract Notes, Meeting Notes, Referred By) were added to the live Notion
 * Leads database via an explicitly authorized schema PATCH (see
 * scripts/notion-leads-schema.ts). See mi.config.yaml's
 * notion.allowed_write_fields.lead, which gates whether these actually get
 * pushed.
 */
const CONTRACT_STAGE_ENUM_TO_OPTION: Record<LeadContractStage, string> = {
  "not-sent": "Not Sent",
  sent: "Sent",
  "under-negotiation": "Under Negotiation",
  signed: "Signed",
};
const CONTRACT_STAGE_OPTION_TO_ENUM: Record<string, LeadContractStage> = {
  "Not Sent": "not-sent",
  Sent: "sent",
  "Under Negotiation": "under-negotiation",
  Signed: "signed",
};

/** Notion caps a single rich_text object at 2000 chars — split instead of truncating so long notes survive. */
function richTextChunks(text: string, maxLen = 2000): { text: { content: string } }[] {
  if (!text) return [{ text: { content: "" } }];
  const chunks: { text: { content: string } }[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push({ text: { content: text.slice(i, i + maxLen) } });
  }
  return chunks;
}

interface NotionRichText {
  plain_text: string;
}
interface NotionTitleProp {
  type: "title";
  title: NotionRichText[];
}
interface NotionRichTextProp {
  type: "rich_text";
  rich_text: NotionRichText[];
}
interface NotionSelectProp {
  type: "select";
  select: { name: string } | null;
}
interface NotionDateProp {
  type: "date";
  date: { start: string; end: string | null } | null;
}
interface NotionNumberProp {
  type: "number";
  number: number | null;
}
interface NotionEmailProp {
  type: "email";
  email: string | null;
}
interface NotionPhoneProp {
  type: "phone_number";
  phone_number: string | null;
}
interface NotionRelationProp {
  type: "relation";
  relation: { id: string }[];
}

type NotionLeadProperty =
  | NotionTitleProp
  | NotionRichTextProp
  | NotionSelectProp
  | NotionDateProp
  | NotionNumberProp
  | NotionEmailProp
  | NotionPhoneProp
  | NotionRelationProp
  | { type: string };

export interface NotionLeadPage {
  id: string;
  url: string;
  properties: Record<string, NotionLeadProperty>;
}
interface NotionQueryResponse {
  results: NotionLeadPage[];
  has_more: boolean;
  next_cursor: string | null;
}

/** The Notion-side view of a lead row, decoded from its real properties. Converted Project stays a raw relation (page ids) -- resolving that to a local project slug is a human-confirmed link, never inferred here. */
export interface NotionLeadEntry {
  id: string;
  url: string;
  name: string;
  source: LeadSource | null;
  status: LeadStatus | null;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  dateReceived: string | null;
  estimatedValue: number | null;
  notes: string;
  lostReason: string;
  convertedDate: string | null;
  convertedProjectPageIds: string[];
  dropboxPath: string;
  contractStage: LeadContractStage | null;
  contractNotes: string;
  meetingNotes: string;
  referrerName: string;
}

function richText(prop: NotionLeadProperty | undefined): string {
  if (prop?.type !== "rich_text") return "";
  return (prop as NotionRichTextProp).rich_text.map((t: NotionRichText) => t.plain_text).join("");
}

function normalizeLeadPage(page: NotionLeadPage): NotionLeadEntry {
  const p = page.properties;
  const title = p.Name as NotionTitleProp | undefined;
  const source = p.Source as NotionSelectProp | undefined;
  const status = p.Status as NotionSelectProp | undefined;
  const dateReceived = p["Date Received"] as NotionDateProp | undefined;
  const convertedDate = p["Converted Date"] as NotionDateProp | undefined;
  const estimatedValue = p["Estimated Value"] as NotionNumberProp | undefined;
  const contactEmail = p["Contact Email"] as NotionEmailProp | undefined;
  const contactPhone = p["Contact Phone"] as NotionPhoneProp | undefined;
  const convertedProject = p["Converted Project"] as NotionRelationProp | undefined;
  const contractStage = p["Contract Stage"] as NotionSelectProp | undefined;

  return {
    id: page.id,
    url: page.url,
    name: (title?.title ?? []).map((t) => t.plain_text).join("") || "(untitled)",
    source: source?.select?.name ? SOURCE_OPTION_TO_ENUM[source.select.name] ?? null : null,
    status: status?.select?.name ? STATUS_OPTION_TO_ENUM[status.select.name] ?? null : null,
    contactName: richText(p["Contact Name"]),
    contactEmail: contactEmail?.email ?? null,
    contactPhone: contactPhone?.phone_number ?? null,
    dateReceived: dateReceived?.date?.start ?? null,
    estimatedValue: estimatedValue?.number ?? null,
    notes: richText(p.Notes),
    lostReason: richText(p["Lost Reason"]),
    convertedDate: convertedDate?.date?.start ?? null,
    convertedProjectPageIds: (convertedProject?.relation ?? []).map((r) => r.id),
    dropboxPath: richText(p["Dropbox Folder"]),
    contractStage: contractStage?.select?.name
      ? CONTRACT_STAGE_OPTION_TO_ENUM[contractStage.select.name] ?? null
      : null,
    contractNotes: richText(p["Contract Notes"]),
    meetingNotes: richText(p["Meeting Notes"]),
    referrerName: richText(p["Referred By"]),
  };
}

/** Reads one exact, already-confirmed lead page. It never searches by lead name. */
export async function getNotionLead(pageId: string): Promise<NotionLeadEntry> {
  if (typeof pageId !== "string" || !pageId.trim()) {
    throw new Error("A confirmed Notion lead page id is required.");
  }
  const page = await notionFetch<NotionLeadPage>(`/pages/${encodeURIComponent(pageId.trim())}`);
  return normalizeLeadPage(page);
}

/** Lists every row in the Leads database, paginated. Read-only. */
export async function listNotionLeads(): Promise<NotionLeadEntry[]> {
  const databaseId = getLeadsDatabaseId();
  const entries: NotionLeadEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    entries.push(...response.results.map(normalizeLeadPage));
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return entries;
}

/**
 * Builds the Notion properties payload for a lead. Deliberately omits
 * Converted Project -- that relation links to a Studio Projects page id, a
 * different identity space than this repo's converted_project_slug, and
 * mapping between them is a human-confirmed link this adapter doesn't infer.
 */
export function buildLeadProperties(
  lead: Lead,
  lastSiteVisitDate: string | null = null,
  _siteVisits: SiteVisitEntry[] = [],
  _meetings: MeetingNote[] = [],
): Record<string, unknown> {
  void _siteVisits;
  void _meetings;
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: lead.name } }] },
    Source: { select: { name: SOURCE_ENUM_TO_OPTION[lead.source] } },
    Status: { select: { name: STATUS_ENUM_TO_OPTION[lead.status] } },
    "Date Received": { date: { start: lead.date_received } },
    "Contact Name": { rich_text: [{ text: { content: lead.contact_name ?? "" } }] },
    "Referred By": { rich_text: [{ text: { content: lead.referrer_name } }] },
    "Contact Email": { email: lead.contact_email || null },
    "Contact Phone": { phone_number: lead.contact_phone || null },
    "Estimated Value": { number: lead.estimated_value },
    "Lost Reason": { rich_text: [{ text: { content: lead.lost_reason ?? "" } }] },
    "Converted Date": { date: lead.converted_date ? { start: lead.converted_date } : null },
    "Dropbox Folder": { rich_text: [{ text: { content: lead.dropbox_path ?? "" } }] },
    "Last Site Visit": { date: lastSiteVisitDate ? { start: lastSiteVisitDate } : null },
    "Contract Stage": { select: { name: CONTRACT_STAGE_ENUM_TO_OPTION[lead.contract_stage] } },
  };
  return properties;
}

type LeadBodySection = { heading: string; content: string };

function paragraphBlocks(content: string): Array<Record<string, unknown>> {
  return content.trim().split(/\n{2,}/).filter(Boolean).map((text) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richTextChunks(text) },
  }));
}

/** Appends reviewed long-form history to the confirmed lead page without rewriting prior body content. */
export async function appendNotionLeadBody(
  pageId: string,
  title: string,
  sections: LeadBodySection[],
): Promise<void> {
  const populated = sections.filter((section) => section.content.trim());
  if (populated.length === 0) return;
  const children: Array<Record<string, unknown>> = [
    { object: "block", type: "divider", divider: {} },
    { object: "block", type: "heading_2", heading_2: { rich_text: richTextChunks(title) } },
  ];
  for (const section of populated) {
    children.push({ object: "block", type: "heading_3", heading_3: { rich_text: richTextChunks(section.heading) } });
    children.push(...paragraphBlocks(section.content));
  }
  await notionFetch(`/blocks/${encodeURIComponent(pageId)}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children }),
  });
}

export async function createNotionLead(
  lead: Lead,
  lastSiteVisitDate: string | null = null,
  siteVisits: SiteVisitEntry[] = [],
  meetings: MeetingNote[] = [],
): Promise<{ id: string; url: string }> {
  const databaseId = getLeadsDatabaseId();
  return notionFetch<{ id: string; url: string }>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildLeadProperties(lead, lastSiteVisitDate, siteVisits, meetings),
    }),
  });
}

export async function updateNotionLead(
  pageId: string,
  lead: Lead,
  lastSiteVisitDate: string | null = null,
  siteVisits: SiteVisitEntry[] = [],
  meetings: MeetingNote[] = [],
): Promise<void> {
  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: buildLeadProperties(lead, lastSiteVisitDate, siteVisits, meetings) }),
  });
}
