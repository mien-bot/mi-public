import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateLeadMeetingNote: vi.fn(() => "C:\\firm\\leads\\demo\\meetings\\2026-08-12-client-review.md"),
  writeLeadMeetingNote: vi.fn(() => "C:\\firm\\leads\\demo\\meetings\\2026-08-12-client-review.md"),
}));

vi.mock("@/lib/content", () => ({
  getLeadSlugs: vi.fn(() => ["demo"]),
  isValidIanaTimezone: vi.fn(() => true),
  leadDir: vi.fn(() => "C:\\firm\\leads\\demo"),
  updateLeadMeetingNote: mocks.updateLeadMeetingNote,
  writeLeadMeetingNote: mocks.writeLeadMeetingNote,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { meetingNoteSchema } from "@/lib/schema";
import { POST } from "./route";

const meeting = {
  id: "client-review",
  title: "Client review",
  meeting_type: "Client Meeting",
  meeting_status: "completed",
  date: "2026-08-12",
  start_time: "10:00",
  end_time: "11:00",
  timezone: "America/Chicago",
  attendees: ["Alex", "Client"],
  objective: "Approve the schematic direction.",
  preparation: ["Review the contract."],
  agenda_items: [{ topic: "Scope", duration_minutes: 60, desired_outcome: "Confirm direction." }],
  raw_notes: "Client approved Option B.",
  summary: "Option B was approved.",
  decisions: ["Proceed with Option B."],
  action_items: [],
  open_questions: [],
};

function request(body: unknown) {
  return new Request("http://localhost/api/leads/demo/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("lead meeting update boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews without writing lead data", async () => {
    const response = await POST(request({ confirmed: false, operation: "create", meeting }), {
      params: Promise.resolve({ slug: "demo" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.writeLeadMeetingNote).not.toHaveBeenCalled();
  });

  it("completes an existing lead agenda with its captured hash", async () => {
    const expectedHash = "c".repeat(64);
    const response = await POST(request({ confirmed: true, operation: "update", expectedHash, meeting }), {
      params: Promise.resolve({ slug: "demo" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // The route hands the writer a schema-parsed meeting, so defaults are already applied.
    expect(mocks.updateLeadMeetingNote).toHaveBeenCalledWith("demo", meetingNoteSchema.parse(meeting), expectedHash);
    expect(mocks.writeLeadMeetingNote).not.toHaveBeenCalled();
    expect(body).toMatchObject({ saved: true, updated: true, file: "meetings/2026-08-12-client-review.md" });
  });

  it("rejects converting a planned record into another planned record", async () => {
    const response = await POST(request({
      confirmed: true,
      operation: "update",
      expectedHash: "d".repeat(64),
      meeting: { ...meeting, meeting_status: "planned" },
    }), { params: Promise.resolve({ slug: "demo" }) });

    expect(response.status).toBe(400);
    expect(mocks.updateLeadMeetingNote).not.toHaveBeenCalled();
  });
});
