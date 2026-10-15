import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), recordRoot: "/records" }));
vi.mock("./projects", () => ({ contentDir: (slug: string) => `${mocks.recordRoot}/${slug}` }));
vi.mock("./workspaceOutbox", async importOriginal => ({
  ...await importOriginal<typeof import("./workspaceOutbox")>(),
  resolveWorkspace: (kind: string, slug: string) => ({ workspaceRoot: `/workspaces/${kind}/${slug}`, recordDir: `/records/${slug}` }),
}));
vi.mock("./reviewInboxService", () => ({
  previewBulkApply: mocks.preview, confirmReviewCard: mocks.confirm,
  ReviewActionError: class extends Error { status = 409; },
}));
import { confirmReviewBatch, previewReviewBatch, reviewBatchSchema, type ReviewBatchSelection } from "./reviewInboxBatch";

const selection: ReviewBatchSelection = [
  { kind: "project", slug: "alpha", cardIds: ["same-id", "a2"], destinationKind: "project-notes" },
  { kind: "project", slug: "beta", cardIds: ["same-id"], destinationKind: "project-notes" },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.recordRoot = "/records";
  mocks.preview.mockImplementation(group => ({ fingerprint: group.slug, allowed: true, effects: [], blockers: [] }));
  mocks.confirm.mockReturnValue({ applied: { record: "memory/notes.md" }, message: "Saved" });
});
describe("cross-workspace inbox batch", () => {
  it("preserves receipt warnings without counting a saved record as failed", () => {
    mocks.confirm.mockReturnValue({ applied: { record: "memory/notes.md" }, warning: "Saved; check receipt." });
    const result = confirmReviewBatch(selection, previewReviewBatch(selection).fingerprint, "Test");
    expect(result[0]).toMatchObject({ applied: 2, failed: 0, warnings: ["Saved; check receipt.", "Saved; check receipt."] });
  });
  it("previews all workspaces without writes and applies duplicate IDs to their own project", () => {
    const preview = previewReviewBatch(selection);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(confirmReviewBatch(selection, preview.fingerprint, "Alex")).toEqual([
      { kind: "project", slug: "alpha", applied: 2, failed: 0, errors: [], warnings: [] },
      { kind: "project", slug: "beta", applied: 1, failed: 0, errors: [], warnings: [] },
    ]);
    expect(mocks.confirm.mock.calls.map(([input]) => [input.slug, input.cardId, input.reviewedBy])).toEqual([
      ["alpha", "same-id", "Alex"], ["alpha", "a2", "Alex"], ["beta", "same-id", "Alex"],
    ]);
  });
  it("refuses every write when a later project changes after preview", () => {
    const preview = previewReviewBatch(selection);
    mocks.preview.mockImplementation(group => ({ fingerprint: group.slug === "beta" ? "changed" : "alpha", allowed: true, effects: [] }));
    expect(() => confirmReviewBatch(selection, preview.fingerprint, "Alex")).toThrow(/changed/);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("requires a matching preview and checks blockers before starting", () => {
    expect(() => confirmReviewBatch(selection, "", "Alex")).toThrow(/changed/);
    mocks.preview.mockReturnValue({ fingerprint: "blocked", allowed: false, blockers: ["Unavailable"], effects: [] });
    const preview = previewReviewBatch(selection);
    expect(() => confirmReviewBatch(selection, preview.fingerprint, "Alex")).toThrow(/blocked/);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("invalidates approval when the configured record location changes", () => {
    const preview = previewReviewBatch(selection);
    mocks.recordRoot = "/dropbox/changed";
    expect(() => confirmReviewBatch(selection, preview.fingerprint, "Alex")).toThrow(/changed/);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("reports a mid-batch failure accurately and continues independent items", () => {
    mocks.confirm.mockImplementation(input => {
      if (input.cardId === "a2") throw Error("Dropbox is unavailable");
      return { applied: { record: "memory/notes.md" } };
    });
    const result = confirmReviewBatch(selection, previewReviewBatch(selection).fingerprint, "Alex");
    expect(result[0]).toMatchObject({ applied: 1, failed: 1, errors: ["Dropbox is unavailable"] });
    expect(result[1]).toMatchObject({ applied: 1, failed: 0 });
  });
  it("rejects duplicate workspace groups, unsafe slugs and oversized batches", () => {
    expect(reviewBatchSchema.safeParse([selection[0], selection[0]]).success).toBe(false);
    expect(reviewBatchSchema.safeParse([{ ...selection[0], slug: "../other" }]).success).toBe(false);
    expect(reviewBatchSchema.safeParse([{ ...selection[0], cardIds: Array.from({ length: 101 }, (_, i) => String(i)) }]).success).toBe(false);
  });
});
