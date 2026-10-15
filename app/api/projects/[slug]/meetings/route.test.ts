import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMeetingNote: vi.fn(() => "C:\\repo\\projects\\demo\\meetings\\2026-08-12-client-review.md"),
  writeMeetingNote: vi.fn(() => "C:\\repo\\projects\\demo\\meetings\\2026-08-12-client-review.md"),
  mirrorProjectKnowledge: vi.fn(() => ({ mirrored: false, reason: "not-linked" })),
}));

vi.mock("@/lib/content", () => ({
  getProjectSlugs: vi.fn(() => ["demo"]),
  isValidIanaTimezone: vi.fn(() => true),
  mirrorProjectKnowledge: mocks.mirrorProjectKnowledge,
  updateMeetingNote: mocks.updateMeetingNote,
  writeMeetingNote: mocks.writeMeetingNote,
}));
vi.mock("@/lib/content/paths", () => ({ PROJECTS_DIR: "C:\\repo\\projects" }));
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
  return new Request("http://localhost/api/projects/demo/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("project meeting update boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews an in-place completion without writing", async () => {
    const response = await POST(request({
      confirmed: false,
      operation: "update",
      expectedHash: "a".repeat(64),
      meeting,
    }), { params: Promise.resolve({ slug: "demo" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.operation).toBe("update");
    expect(mocks.updateMeetingNote).not.toHaveBeenCalled();
    expect(mocks.mirrorProjectKnowledge).not.toHaveBeenCalled();
  });

  it("updates the same record only after confirmation", async () => {
    const expectedHash = "b".repeat(64);
    const response = await POST(request({ confirmed: true, operation: "update", expectedHash, meeting }), {
      params: Promise.resolve({ slug: "demo" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // The route hands the writer a schema-parsed meeting, so defaults are already applied.
    expect(mocks.updateMeetingNote).toHaveBeenCalledWith("demo", meetingNoteSchema.parse(meeting), expectedHash);
    expect(mocks.writeMeetingNote).not.toHaveBeenCalled();
    expect(body.updated).toBe(true);
  });

  it("rejects an update without a captured content hash", async () => {
    const response = await POST(request({ confirmed: true, operation: "update", meeting }), {
      params: Promise.resolve({ slug: "demo" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.updateMeetingNote).not.toHaveBeenCalled();
  });
});
