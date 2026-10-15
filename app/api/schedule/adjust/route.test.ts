import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowed: vi.fn((record?: string, field?: string) => {
    void record;
    void field;
    return true;
  }),
  reserve: vi.fn(),
  complete: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  createProject: vi.fn(),
  createPersonal: vi.fn(),
  duplicate: vi.fn(),
  trash: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/src/policies/approvals", () => ({ isWriteAllowed: mocks.allowed }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/lib/content/scheduleCreateJournal", () => ({
  reserveScheduleCreate: mocks.reserve,
  completeScheduleCreate: mocks.complete,
}));
vi.mock("@/src/adapters/notion/schedule", () => ({
  getScheduleEntry: mocks.get,
  updateScheduleEntryDate: mocks.update,
  createProjectScheduleEntry: mocks.createProject,
  createPersonalScheduleEntry: mocks.createPersonal,
  duplicateScheduleEntry: mocks.duplicate,
  trashScheduleEntry: mocks.trash,
}));

import { POST } from "./route";

const PAGE_ID = "abc12345abc12345abc12345abc12345";
const PROJECT_ID = "def67890def67890def67890def67890";

describe("schedule removal confirmation", () => {
  const proposal = { id: "remove-meeting", title: "Remove meeting", reason: "Plans changed", kind: "schedule-remove",
    data: { eventPageId: PAGE_ID, name: "Meeting", expectedLastEditedTime: "2026-09-05T12:00:00.000Z" } };
  it("requires confirmation and the removal-specific allowlist entry", async () => {
    mocks.trash.mockReset();
    expect((await POST(request({ proposal }))).status).toBe(409);
    mocks.allowed.mockReturnValueOnce(false);
    expect((await POST(request({ proposal, confirmed: true }))).status).toBe(409);
    expect(mocks.trash).not.toHaveBeenCalled();
  });
  it("preserves success when audit bookkeeping fails after removal", async () => {
    mocks.allowed.mockReturnValue(true);
    mocks.trash.mockResolvedValueOnce(undefined);
    mocks.audit.mockImplementationOnce(() => { throw new Error("locked"); });
    const response = await POST(request({ proposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, message: expect.stringContaining("audit") });
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/schedule/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const rescheduleProposal = {
  id: "move-riya",
  title: "Move Riya Meeting",
  reason: "Requested by user",
  kind: "schedule-reschedule",
  data: { eventPageId: PAGE_ID, name: "Riya Meeting", currentDate: "2026-07-17", newDate: "2026-07-24" },
};

const statusProposal = {
  id: "mark-done",
  title: "Mark milestone done",
  reason: "Requested by user",
  kind: "schedule-status",
  data: { eventPageId: PAGE_ID, name: "Sitework", currentStatus: "In progress", newStatus: "Done" },
};

const firmWideCreateProposal = {
  id: "add-pto",
  title: "Add PTO",
  reason: "Requested by user",
  kind: "schedule-create",
  data: { name: "PTO", date: "2026-08-10", type: "Internal Meeting", projectPageId: null, projectName: null },
};

const projectCreateProposal = {
  id: "add-meeting",
  title: "Add client meeting",
  reason: "Requested by user",
  kind: "schedule-create",
  data: {
    name: "Client meeting",
    date: "2026-08-10",
    type: "Client Meeting",
    startTime: "2026-08-10T09:30:00-05:00",
    endTime: "2026-08-10T10:30:00-05:00",
    projectPageId: PROJECT_ID,
    projectName: "1002 S Example Blvd",
  },
};

describe("schedule adjust route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowed.mockReturnValue(true);
    mocks.reserve.mockReturnValue({ status: "reserved" });
    mocks.get.mockImplementation(async () => ({ date: "2026-07-17", status: "In progress" }));
    mocks.update.mockResolvedValue(undefined);
    mocks.createProject.mockResolvedValue({ id: "notion-page", url: "https://www.notion.so/notion-page" });
    mocks.createPersonal.mockResolvedValue({ id: "notion-page", url: "https://www.notion.so/notion-page" });
  });

  it("requires explicit confirmation", async () => {
    const response = await POST(request({ proposal: rescheduleProposal }));
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("applies a confirmed reschedule", async () => {
    const response = await POST(request({ proposal: rescheduleProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ eventPageId: PAGE_ID, date: "2026-07-24", dateEnd: null });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ applied: true }));
  });

  it("applies a confirmed status change", async () => {
    const response = await POST(request({ proposal: statusProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ eventPageId: PAGE_ID, status: "Done" });
  });

  it("blocks a stale reschedule instead of overwriting a newer Notion date", async () => {
    mocks.get.mockResolvedValue({ date: "2026-07-20", status: "In progress" });
    const response = await POST(request({ proposal: rescheduleProposal, confirmed: true }));
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      command: "schedule agent stale reschedule blocked",
      applied: false,
    }));
  });

  it("moves a timed event date and time fields in one confirmed update", async () => {
    mocks.get.mockResolvedValue({
      date: "2026-07-17T09:00:00-05:00",
      dateEnd: "2026-07-17T10:00:00-05:00",
      startTime: "2026-07-17T13:33:00-05:00",
      endTime: null,
      attendeeIds: [],
      status: "In progress",
    });
    const timedProposal = {
      ...rescheduleProposal,
      data: {
        ...rescheduleProposal.data,
        currentStartTime: "2026-07-17T09:00:00-05:00",
        currentEndTime: "2026-07-17T10:00:00-05:00",
        newStartTime: "2026-07-24T09:00:00-05:00",
        newEndTime: "2026-07-24T10:00:00-05:00",
      },
    };
    const response = await POST(request({ proposal: timedProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      eventPageId: PAGE_ID,
      date: "2026-07-24T09:00:00-05:00",
      dateEnd: "2026-07-24T10:00:00-05:00",
    });
  });

  it("blocks a timed reschedule when Notion changed the live time", async () => {
    mocks.get.mockResolvedValue({
      date: "2026-07-17T09:30:00-05:00",
      dateEnd: "2026-07-17T10:00:00-05:00",
      status: "In progress",
    });
    const timedProposal = {
      ...rescheduleProposal,
      data: {
        ...rescheduleProposal.data,
        currentStartTime: "2026-07-17T09:00:00-05:00",
        currentEndTime: "2026-07-17T10:00:00-05:00",
        newStartTime: "2026-07-24T09:00:00-05:00",
        newEndTime: "2026-07-24T10:00:00-05:00",
      },
    };
    const response = await POST(request({ proposal: timedProposal, confirmed: true }));
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates only the Date range for an in-day drag and honors the Date allowlist gate", async () => {
    mocks.get.mockResolvedValue({
      date: "2026-07-17T09:00:00-05:00",
      dateEnd: "2026-07-17T10:00:00-05:00",
      status: "In progress",
    });
    const proposal = {
      ...rescheduleProposal,
      data: {
        ...rescheduleProposal.data,
        newDate: "2026-07-17",
        currentStartTime: "2026-07-17T09:00:00-05:00",
        currentEndTime: "2026-07-17T10:00:00-05:00",
        newStartTime: "2026-07-17T13:00:00-05:00",
        newEndTime: "2026-07-17T14:00:00-05:00",
      },
    };
    const response = await POST(request({ proposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      eventPageId: PAGE_ID,
      date: "2026-07-17T13:00:00-05:00",
      dateEnd: "2026-07-17T14:00:00-05:00",
    });

    vi.clearAllMocks();
    mocks.allowed.mockImplementation((_record, field) => field !== "planned_date");
    const blocked = await POST(request({ proposal, confirmed: true }));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining("Date") });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("blocks a stale status proposal instead of overwriting a newer Notion status", async () => {
    mocks.get.mockResolvedValue({ date: "2026-07-17", status: "Done" });
    const response = await POST(request({ proposal: statusProposal, confirmed: true }));
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("creates a firm-wide entry when no project is linked", async () => {
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.createPersonal).toHaveBeenCalledWith({
      name: "PTO",
      date: "2026-08-10",
      type: "Internal Meeting",
      startTime: null,
      endTime: null,
      attendeeIds: [],
    });
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(mocks.allowed).toHaveBeenCalledWith("schedule", "create");
  });

  it("creates a project-linked entry when a project is confirmed", async () => {
    const response = await POST(request({ proposal: projectCreateProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(mocks.createProject).toHaveBeenCalledWith({
      projectPageId: PROJECT_ID,
      name: "Client meeting",
      date: "2026-08-10",
      type: "Client Meeting",
      startTime: "2026-08-10T09:30:00-05:00",
      endTime: "2026-08-10T10:30:00-05:00",
      attendeeIds: [],
    });
    expect(mocks.createPersonal).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith(
      projectCreateProposal.id,
      expect.objectContaining({ name: "Client meeting" }),
      { id: "notion-page", url: "https://www.notion.so/notion-page" },
    );
  });

  it("blocks an uncertain create retry before contacting Notion", async () => {
    mocks.reserve.mockReturnValue({ status: "pending-review" });
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(409);
    expect(mocks.createPersonal).not.toHaveBeenCalled();
  });

  it("returns an already-applied create without contacting Notion again", async () => {
    mocks.reserve.mockReturnValue({
      status: "already-applied",
      result: { id: "notion-page", url: "https://www.notion.so/notion-page" },
    });
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyApplied: true });
    expect(mocks.createPersonal).not.toHaveBeenCalled();
  });

  it("honors the write allowlist gate for new entries", async () => {
    mocks.allowed.mockReturnValue(false);
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(409);
    expect(mocks.createPersonal).not.toHaveBeenCalled();
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("records a failed audit entry and returns 502 when creation fails", async () => {
    mocks.createPersonal.mockRejectedValue(new Error("Notion is unreachable."));
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Notion is unreachable." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ applied: false }));
  });

  it("still reports the create as done when only Mi's own bookkeeping failed", async () => {
    // Shipped as an EPERM on the journal rename while Dropbox held the temp file open. The
    // event was already in Notion; calling that a failure is how a partner ends up adding it
    // a second time by hand.
    mocks.complete.mockImplementation(() => {
      throw new Error("Another program is holding the journal open.");
    });
    const response = await POST(request({ proposal: firmWideCreateProposal, confirmed: true }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain("Added \"PTO\"");
    expect(body.message).toContain("The event is in Notion");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "schedule create journal not completed", applied: true }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "schedule agent confirmed new entry", applied: true }),
    );
  });

  it("rejects an invalid proposal shape", async () => {
    const response = await POST(request({ proposal: { kind: "schedule-create" }, confirmed: true }));
    expect(response.status).toBe(400);
  });
});
