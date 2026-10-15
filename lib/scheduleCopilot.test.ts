import { describe, expect, it } from "vitest";
import { parseScheduleCopilotReply } from "./scheduleCopilot";

const PAGE_ID = "abc12345abc12345abc12345abc12345";

describe("schedule copilot replies", () => {
  it("parses a reschedule proposal", () => {
    const reply = parseScheduleCopilotReply(`Sure, I'll move that.
\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"move-riya","title":"Move Riya Meeting","reason":"Requested by user","kind":"schedule-reschedule","data":{"eventPageId":"${PAGE_ID}","name":"Riya Meeting","currentDate":"2026-07-17","newDate":"2026-07-24"}}]}
\`\`\``);

    expect(reply.text).toBe("Sure, I'll move that.");
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({
      kind: "schedule-reschedule",
      data: { currentDate: "2026-07-17", newDate: "2026-07-24" },
    });
    expect(reply.proposalError).toBeNull();
  });

  it("parses a status-change proposal", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"mark-done","title":"Mark milestone done","reason":"Requested by user","kind":"schedule-status","data":{"eventPageId":"${PAGE_ID}","name":"Sitework","currentStatus":"In progress","newStatus":"Done"}}]}
\`\`\``);

    expect(reply.proposals[0]).toMatchObject({
      kind: "schedule-status",
      data: { newStatus: "Done" },
    });
  });

  it("parses a coordinated timed reschedule and rejects an invalid resized end", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"move-timed","title":"Move meeting","reason":"Requested","kind":"schedule-reschedule","data":{"eventPageId":"${PAGE_ID}","name":"Meeting","currentDate":"2026-08-10","newDate":"2026-08-11","currentStartTime":"2026-08-10T09:00:00-05:00","currentEndTime":"2026-08-10T10:00:00-05:00","newStartTime":"2026-08-11T13:00:00-05:00","newEndTime":"2026-08-11T14:00:00-05:00"}}]}
\`\`\``);
    expect(reply.proposals[0]).toMatchObject({
      kind: "schedule-reschedule",
      data: { newStartTime: "2026-08-11T13:00:00-05:00", newEndTime: "2026-08-11T14:00:00-05:00" },
    });

    const invalid = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"resize-bad","title":"Resize meeting","reason":"Requested","kind":"schedule-reschedule","data":{"eventPageId":"${PAGE_ID}","name":"Meeting","currentDate":"2026-08-10","newDate":"2026-08-10","currentStartTime":"2026-08-10T09:00:00-05:00","currentEndTime":"2026-08-10T10:00:00-05:00","newStartTime":"2026-08-10T09:00:00-05:00","newEndTime":"2026-08-10T08:00:00-05:00"}}]}
\`\`\``);
    expect(invalid.proposals).toHaveLength(0);
    expect(invalid.proposalError).toContain("New end time must be after new start time");
  });

  it("rejects an invented Notion page id", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"move-riya","title":"Move Riya Meeting","reason":"x","kind":"schedule-reschedule","data":{"eventPageId":"not-a-real-id","name":"Riya Meeting","currentDate":"2026-07-17","newDate":"2026-07-24"}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(0);
    expect(reply.proposalError).toContain("Notion page id");
  });

  it("returns no proposals for ordinary discussion", () => {
    const reply = parseScheduleCopilotReply("Nothing on your schedule needs to change today.");
    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toBeNull();
    expect(reply.text).toBe("Nothing on your schedule needs to change today.");
  });

  it("parses a firm-wide create proposal with no project", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"add-pto","title":"Add PTO","reason":"Requested by user","kind":"schedule-create","data":{"name":"PTO","date":"2026-08-10","type":"Internal Meeting","projectPageId":null,"projectName":null}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({
      kind: "schedule-create",
      data: { name: "PTO", date: "2026-08-10", type: "Internal Meeting", projectPageId: null, projectName: null },
    });
    expect(reply.proposalError).toBeNull();
  });

  it("parses a project-linked create proposal", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"add-example-meeting","title":"Add client meeting","reason":"Requested by user","kind":"schedule-create","data":{"name":"Client meeting","date":"2026-08-10","type":"Client Meeting","startTime":"2026-08-10T09:30:00-05:00","endTime":"2026-08-10T10:30:00-05:00","projectPageId":"${PAGE_ID}","projectName":"1002 S Example Blvd"}}]}
\`\`\``);

    expect(reply.proposals[0]).toMatchObject({
      kind: "schedule-create",
      data: {
        projectPageId: PAGE_ID,
        projectName: "1002 S Example Blvd",
        startTime: "2026-08-10T09:30:00-05:00",
        endTime: "2026-08-10T10:30:00-05:00",
      },
    });
  });

  it("rejects a create proposal whose end time is not after its start", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"bad-time","title":"Meeting","reason":"Requested","kind":"schedule-create","data":{"name":"Meeting","date":"2026-08-10","type":"Meeting","startTime":"2026-08-10T10:30:00-05:00","endTime":"2026-08-10T09:30:00-05:00","projectPageId":null,"projectName":null}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(0);
    expect(reply.proposalError).toContain("End time must be after start time");
  });

  it("rejects a create proposal that sets a project id without a project name", () => {
    const reply = parseScheduleCopilotReply(`\`\`\`mi-schedule-proposals
{"version":1,"proposals":[{"id":"add-bad","title":"Add","reason":"x","kind":"schedule-create","data":{"name":"Meeting","date":"2026-08-10","type":"Meeting","projectPageId":"${PAGE_ID}","projectName":null}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(0);
    expect(reply.proposalError).toContain("projectPageId and projectName must both be set or both be null.");
  });
});
