import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  apply: vi.fn(), update: vi.fn(), mirror: vi.fn(),
  card: { id: "fact-one", status: "pending", source: {}, original: {} },
}));
vi.mock("./reviewInbox", async importOriginal => ({
  ...await importOriginal<typeof import("./reviewInbox")>(),
  locateReviewInbox: () => ({ cards: "fixture" }),
  readReviewCardsIn: () => [mocks.card],
  updateReviewCardIn: mocks.update,
  mirrorLegacyResolution: mocks.mirror,
}));
vi.mock("./reviewInboxApply", async importOriginal => ({
  ...await importOriginal<typeof import("./reviewInboxApply")>(),
  applyReviewCardToDestination: mocks.apply,
  describeDestinations: () => [{ ref: { kind: "project-notes" } }],
}));
import { confirmReviewCard } from "./reviewInboxService";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.apply.mockReturnValue({ record: "memory/notes.md", result: "Saved project knowledge." });
  mocks.update.mockReturnValue({ ...mocks.card, status: "applied" });
});
describe("review acceptance receipts", () => {
  it.each(["status", "legacy"])("does not report an accepted record as failed when the %s receipt fails", failure => {
    const failing = failure === "status" ? mocks.update : mocks.mirror;
    failing.mockImplementation(() => { throw new Error("file locked"); });
    const result = confirmReviewCard({ kind: "project", slug: "fixture", cardId: "fact-one", destinationKind: "project-notes", reviewedBy: "Test" });
    expect(result.applied?.record).toBe("memory/notes.md");
    expect(result.card.status).toBe("applied");
    expect(result.message).toContain("record was saved");
    expect(result.message).toContain("before applying this card again");
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls.some(call => call[2].status === "failed")).toBe(false);
  });
  it("still records an actual destination failure as failed", () => {
    mocks.apply.mockImplementation(() => { throw new Error("destination unavailable"); });
    expect(() => confirmReviewCard({ kind: "project", slug: "fixture", cardId: "fact-one", destinationKind: "project-notes", reviewedBy: "Test" })).toThrow("destination unavailable");
    expect(mocks.update.mock.calls[0][2].status).toBe("failed");
  });
});
