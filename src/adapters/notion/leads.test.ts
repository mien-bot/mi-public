import { describe, expect, it } from "vitest";
import { appendNotionLeadBody, buildLeadProperties } from "./leads";
import { notionFetch } from "./client";
import { vi } from "vitest";

vi.mock("./client", () => ({ notionFetch: vi.fn() }));
import type { Lead } from "@/lib/schema";

const lead: Lead = {
  name: "Demo",
  source: "referral",
  contact_name: "Owner",
  contact_email: "",
  contact_phone: "",
  referrer_name: "",
  date_received: "2026-07-28",
  status: "qualified",
  estimated_value: null,
  notes: "",
  lost_reason: null,
  converted_project_slug: null,
  converted_date: null,
  dropbox_path: null,
  contract_stage: "not-sent",
  contract_notes: "",
  notion_page_id: "confirmed-page",
};

describe("Notion lead properties", () => {
  it("keeps long-form notes out of the crowded database properties", () => {
    const properties = buildLeadProperties(lead, null, [], [{
      id: "visit",
      title: "Site visit",
      meeting_type: "Site Visit",
      meeting_status: "completed",
      date: "2026-07-28",
      start_time: "10:00",
      end_time: "11:00",
      timezone: "America/Chicago",
      attendees: ["Alex"],
      objective: "",
      preparation: [],
      agenda_items: [],
      raw_notes: "Measured kitchen.",
      summary: "Existing kitchen measured.",
      decisions: ["Keep island"],
      action_items: [{ description: "Send plan", owner: "Alex", due_date: "" }],
      open_questions: [],
    }]) as Record<string, { rich_text: Array<{ text: { content: string } }> }>;

    expect(properties).not.toHaveProperty("Notes");
    expect(properties).not.toHaveProperty("Contract Notes");
    expect(properties).not.toHaveProperty("Meeting Notes");
  });

  it("appends dated, categorized sections to the Notion page body", async () => {
    vi.mocked(notionFetch).mockResolvedValueOnce({});
    await appendNotionLeadBody("confirmed-page", "2026-08-05 · Site visit", [
      { heading: "Summary", content: "Existing kitchen measured." },
      { heading: "Decisions", content: "Keep island" },
    ]);
    expect(notionFetch).toHaveBeenCalledWith("/blocks/confirmed-page/children", expect.objectContaining({ method: "PATCH" }));
    const body = JSON.parse(String(vi.mocked(notionFetch).mock.calls[0][1]?.body));
    expect(JSON.stringify(body)).toContain("2026-08-05 · Site visit");
    expect(JSON.stringify(body)).toContain("Existing kitchen measured.");
  });
});
