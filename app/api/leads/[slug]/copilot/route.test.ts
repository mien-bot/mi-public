import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const leads = {
    alpha: {
      name: "Alpha Lead",
      source: "referral",
      contact_name: "Alpha Owner",
      contact_email: "",
      contact_phone: "",
      referrer_name: "",
      date_received: "2026-07-20",
      status: "new",
      estimated_value: null,
      notes: "",
      lost_reason: null,
      converted_project_slug: null,
      converted_date: null,
      dropbox_path: "Leads/Alpha",
      contract_stage: "not-sent",
      contract_notes: "",
      notion_page_id: "notion-alpha",
    },
    beta: {
      name: "Beta Lead",
      source: "website",
      contact_name: "Beta Owner",
      contact_email: "",
      contact_phone: "",
      referrer_name: "",
      date_received: "2026-07-21",
      status: "qualified",
      estimated_value: null,
      notes: "",
      lost_reason: null,
      converted_project_slug: null,
      converted_date: null,
      dropbox_path: "Leads/Beta",
      contract_stage: "not-sent",
      contract_notes: "",
      notion_page_id: "notion-beta",
    },
  } as Record<string, Record<string, unknown>>;
  return {
    leads,
    getLeadWithHash: vi.fn((slug: string) => ({ lead: leads[slug], hash: `hash-${slug}` })),
    updateLead: vi.fn((slug: string, lead: Record<string, unknown>) => {
      leads[slug] = lead;
      return { lead };
    }),
    writeLeadMeetingNote: vi.fn((slug: string, meeting: { date: string; id: string }) => (
      `C:\\firm\\leads\\${slug}\\meetings\\${meeting.date}-${meeting.id}.md`
    )),
    syncLeadToNotion: vi.fn(async (_slug: string, lead: Record<string, unknown>) => ({
      notionSynced: true,
      notionUrl: null,
      notionError: null,
      lead,
    })),
  };
});

vi.mock("@/lib/content", () => ({
  getLeadMeetingNotes: vi.fn(() => []),
  getLeadSlugs: vi.fn(() => ["alpha", "beta"]),
  getLeadWithHash: mocks.getLeadWithHash,
  writeLeadMeetingNote: mocks.writeLeadMeetingNote,
}));
vi.mock("@/lib/content/leads", () => ({
  leadDir: vi.fn((slug: string) => `C:\\firm\\leads\\${slug}`),
}));
vi.mock("@/lib/content/leadNotionSync", () => ({
  syncLeadToNotion: mocks.syncLeadToNotion,
}));
vi.mock("@/lib/content/leadMutations", () => ({
  updateLead: mocks.updateLead,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { meetingNoteSchema } from "@/lib/schema";
import { POST } from "./route";

function request(slug: string, body: unknown) {
  return new Request(`http://localhost/api/leads/${slug}/copilot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const updateProposal = {
  id: "update-alpha-contact",
  title: "Update owner contact",
  reason: "Record the confirmed owner name.",
  kind: "lead-update",
  data: { contact_name: "Updated Alpha Owner", status: "qualified" },
};

const meetingProposal = {
  id: "beta-site-visit",
  title: "Beta site visit",
  reason: "Record the reviewed site-visit summary.",
  kind: "lead-meeting",
  data: {
    id: "beta-site-visit",
    title: "Beta site visit",
    meeting_type: "Site Visit",
    meeting_status: "planned",
    date: "2026-07-28",
    start_time: "10:00",
    end_time: "11:00",
    timezone: "America/Chicago",
    attendees: ["Alex"],
    objective: "Confirm the existing kitchen before design starts.",
    preparation: ["Review the contract."],
    agenda_items: [
      { topic: "Contract scope", duration_minutes: 15, desired_outcome: "Confirm the site-visit scope." },
      { topic: "Existing conditions", duration_minutes: 45, desired_outcome: "Capture open questions." },
    ],
    raw_notes: "Measured kitchen.",
    summary: "Existing kitchen measured.",
    decisions: [],
    action_items: [],
    open_questions: [],
  },
};

describe("lead copilot apply boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.leads.alpha.contact_name = "Alpha Owner";
    mocks.leads.alpha.status = "new";
    mocks.leads.alpha.notion_page_id = "notion-alpha";
    mocks.leads.beta.notion_page_id = "notion-beta";
    mocks.syncLeadToNotion.mockImplementation(async (_slug, lead) => ({
      notionSynced: true,
      notionUrl: null,
      notionError: null,
      lead,
    }));
  });

  it("previews without changing Mi or Notion", async () => {
    const response = await POST(request("alpha", { proposal: updateProposal, confirmed: false }), {
      params: Promise.resolve({ slug: "alpha" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.syncLeadToNotion).not.toHaveBeenCalled();
  });

  it("updates only the selected lead and its confirmed Notion page", async () => {
    const response = await POST(request("alpha", {
      proposal: updateProposal,
      confirmed: true,
      destination: "notion",
    }), { params: Promise.resolve({ slug: "alpha" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.updateLead).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        name: "Alpha Lead",
        contact_name: "Updated Alpha Owner",
        status: "qualified",
        notion_page_id: "notion-alpha",
        dropbox_path: "Leads/Alpha",
      }),
      { expectedHash: "hash-alpha" },
    );
    expect(mocks.syncLeadToNotion).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({ notion_page_id: "notion-alpha" }),
    );
    expect(mocks.updateLead).not.toHaveBeenCalledWith("beta", expect.anything(), expect.anything());
    expect(body.result.notion.status).toBe("synced");
  });

  it("saves a meeting under the selected lead before refreshing its Notion page", async () => {
    const response = await POST(request("beta", {
      proposal: meetingProposal,
      confirmed: true,
      destination: "notion",
    }), { params: Promise.resolve({ slug: "beta" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    // The proposal is validated before it is written, so the writer sees schema defaults.
    expect(mocks.writeLeadMeetingNote).toHaveBeenCalledWith("beta", meetingNoteSchema.parse(meetingProposal.data));
    expect(mocks.syncLeadToNotion).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ notion_page_id: "notion-beta" }),
    );
    expect(body.result.local.file).toBe("meetings/2026-07-28-beta-site-visit.md");
  });

  it("blocks external writes when the exact lead has no confirmed Notion page", async () => {
    mocks.leads.beta.notion_page_id = null;
    const response = await POST(request("beta", {
      proposal: meetingProposal,
      confirmed: true,
      destination: "notion",
    }), { params: Promise.resolve({ slug: "beta" }) });

    expect(response.status).toBe(409);
    expect(mocks.writeLeadMeetingNote).not.toHaveBeenCalled();
    expect(mocks.syncLeadToNotion).not.toHaveBeenCalled();
  });

  it("rejects a firm-memory-note proposal -- that belongs on the shared /api/leads/memory route", async () => {
    const response = await POST(request("alpha", {
      proposal: {
        id: "shared-insight",
        title: "Shared insight",
        reason: "Reusable across leads",
        kind: "firm-memory-note",
        data: { entry: "Always ask about permit status early." },
      },
      confirmed: true,
    }), { params: Promise.resolve({ slug: "alpha" }) });

    expect(response.status).toBe(400);
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.writeLeadMeetingNote).not.toHaveBeenCalled();
  });

  it("reports a Notion failure separately after preserving the Mi save", async () => {
    mocks.syncLeadToNotion.mockResolvedValue({
      notionSynced: false,
      notionUrl: null,
      notionError: "Synthetic Notion outage",
      lead: mocks.leads.beta,
    });
    const response = await POST(request("beta", {
      proposal: meetingProposal,
      confirmed: true,
      destination: "notion",
    }), { params: Promise.resolve({ slug: "beta" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.writeLeadMeetingNote).toHaveBeenCalledOnce();
    expect(body.result.notion).toEqual({ status: "failed", error: "Synthetic Notion outage" });
  });
});
