import { describe, expect, it } from "vitest";
import { meetingAgendaMinutes } from "./meetingAgenda";
import { meetingNoteSchema } from "./schema";

describe("meeting agendas", () => {
  it("keeps existing meeting files compatible with completed-note defaults", () => {
    const meeting = meetingNoteSchema.parse({
      id: "existing-meeting",
      title: "Existing meeting",
      meeting_type: "Client Meeting",
      date: "2026-08-01",
      start_time: "",
      end_time: "",
      timezone: "America/Chicago",
    });

    expect(meeting).toMatchObject({
      meeting_status: "completed",
      objective: "",
      preparation: [],
      agenda_items: [],
    });
  });

  it("totals a reviewed timeboxed agenda", () => {
    const meeting = meetingNoteSchema.parse({
      id: "client-agenda",
      title: "Client agenda",
      meeting_type: "Client Meeting",
      meeting_status: "planned",
      date: "2026-08-12",
      start_time: "10:00",
      end_time: "11:00",
      timezone: "America/Chicago",
      objective: "Confirm the contract and next design decisions.",
      preparation: ["Review the contract."],
      agenda_items: [
        { topic: "Contract", duration_minutes: 20, desired_outcome: "Confirm scope." },
        { topic: "Design priorities", duration_minutes: 40, desired_outcome: "Choose next steps." },
      ],
    });

    expect(meetingAgendaMinutes(meeting.agenda_items)).toBe(60);
  });

  it("rejects zero-length agenda blocks", () => {
    const parsed = meetingNoteSchema.safeParse({
      id: "bad-agenda",
      title: "Bad agenda",
      meeting_type: "Work Session",
      meeting_status: "planned",
      date: "2026-08-12",
      start_time: "",
      end_time: "",
      timezone: "America/Chicago",
      agenda_items: [{ topic: "Work", duration_minutes: 0, desired_outcome: "Finish." }],
    });

    expect(parsed.success).toBe(false);
  });
});
