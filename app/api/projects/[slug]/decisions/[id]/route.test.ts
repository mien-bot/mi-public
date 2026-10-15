import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  supersede: vi.fn(),
  update: vi.fn(),
  mirror: vi.fn(() => ({ mirrored: false, reason: "not-linked" })),
  audit: vi.fn(),
}));

vi.mock("@/lib/content", () => ({
  DecisionSupersessionPartialError: class extends Error {},
  deleteProjectDecision: mocks.remove,
  getProjectSlugs: vi.fn(() => ["demo"]),
  mirrorProjectKnowledge: mocks.mirror,
  supersedeProjectDecision: mocks.supersede,
  updateProjectDecision: mocks.update,
}));
vi.mock("@/src/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { DELETE } from "./route";

const params = Promise.resolve({ slug: "demo", id: "decision-12345678" });

function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

/**
 * Deleting is the operation that had no route at all: a decision promoted from meeting
 * notes by mistake could previously only be papered over with a superseding record, which
 * leaves permanent noise pretending to be project history. These cover the guards that
 * make removal safe rather than the happy path alone.
 */
describe("decision delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockReturnValue({
      decision: { id: "decision-12345678", status: "proposed", decision_date: "2026-07-28", sources: [] },
      backupPath: "C:/data/.mi-backups/decision.md.deleted.bak",
    });
  });

  it("deletes on explicit confirmation and reports where the recoverable copy went", async () => {
    const response = await DELETE(request({ confirmed: true, expectedHash: "hash" }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.backupPath).toContain(".deleted.bak");
    expect(mocks.remove).toHaveBeenCalledWith("demo", "decision-12345678", "hash");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "project decision delete", applied: true }),
    );
  });

  it("refuses without explicit confirmation", async () => {
    const response = await DELETE(request({ expectedHash: "hash" }), { params });
    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("refuses without the current record hash, so a stale page cannot discard a newer edit", async () => {
    const response = await DELETE(request({ confirmed: true }), { params });
    expect(response.status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("surfaces a hash conflict as 409 rather than deleting", async () => {
    mocks.remove.mockImplementation(() => {
      throw new ContentConflictError("decisions/x.md", "stale", "current");
    });
    const response = await DELETE(request({ confirmed: true, expectedHash: "stale" }), { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("conflict");
    expect(body.currentHash).toBe("current");
  });

  it("rejects an unknown project and a malformed id before touching content", async () => {
    const unknownProject = await DELETE(request({ confirmed: true, expectedHash: "hash" }), {
      params: Promise.resolve({ slug: "not-a-project", id: "decision-12345678" }),
    });
    expect(unknownProject.status).toBe(404);

    const badId = await DELETE(request({ confirmed: true, expectedHash: "hash" }), {
      params: Promise.resolve({ slug: "demo", id: "../../etc/passwd" }),
    });
    expect(badId.status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("still reports success when the Dropbox mirror fails, since the local record is gone", async () => {
    mocks.mirror.mockImplementation(() => {
      throw new Error("Dropbox unreachable.");
    });
    const response = await DELETE(request({ confirmed: true, expectedHash: "hash" }), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.mirror).toEqual({ mirrored: false, error: "Dropbox unreachable." });
  });
});
