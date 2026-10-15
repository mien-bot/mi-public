import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/content/firmMemory", () => ({ appendFirmMemoryNote: mocks.append }));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/leads/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const proposal = {
  id: "always-ask-permits",
  title: "Ask about permits early",
  reason: "Came up twice this month.",
  kind: "firm-memory-note",
  data: { entry: "Always confirm permit status before quoting a fee." },
};

describe("leads firm memory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.append.mockReturnValue("/repo/.agent/memory/shared/lead-precontract.md");
  });

  it("requires explicit confirmation", async () => {
    const response = await POST(request({ proposal }));
    expect(response.status).toBe(409);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("saves a confirmed note to the shared leads playbook", async () => {
    const response = await POST(request({ proposal, confirmed: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.append).toHaveBeenCalledWith("leads", {
      title: "Ask about permits early",
      entry: "Always confirm permit status before quoting a fee.",
    });
    expect(body.ok).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ applied: true }));
  });

  it("rejects a lead-update proposal -- that belongs on the per-lead route", async () => {
    const response = await POST(request({
      proposal: { id: "x", title: "x", reason: "x", kind: "lead-update", data: { status: "qualified" } },
      confirmed: true,
    }));
    expect(response.status).toBe(400);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("records a failed audit entry and returns 502 when the write fails", async () => {
    mocks.append.mockImplementation(() => {
      throw new Error("Disk is full.");
    });
    const response = await POST(request({ proposal, confirmed: true }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Disk is full." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ applied: false }));
  });
});
