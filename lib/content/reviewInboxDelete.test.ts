import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cards: {} as Record<string, object[]>, dismiss: vi.fn(), root: "/inbox" }));
vi.mock("./reviewInbox", () => ({
  locateReviewInbox: (_kind: string, slug: string) => ({ cards: slug, inbox: mocks.root }),
  readReviewCardsIn: (location: { cards: string }) => mocks.cards[location.cards] || [],
  effectiveContent: (card: { original: object }) => card.original,
}));
vi.mock("./reviewInboxService", () => ({
  dismissReviewCard: mocks.dismiss, ReviewActionError: class extends Error { status = 409; },
}));
import { confirmInboxDelete, previewInboxDelete, inboxDeleteSchema, type InboxDeleteSelection } from "./reviewInboxDelete";
const selection: InboxDeleteSelection = [
  { kind: "project", slug: "alpha", cardId: "same" },
  { kind: "permit-qaqc", slug: "beta", cardId: "same" },
];
beforeEach(() => {
  mocks.dismiss.mockReset(); mocks.root = "/inbox";
  mocks.cards = { alpha: [{ id: "same", status: "pending", original: { title: "A" }, source: {} }],
    beta: [{ id: "same", status: "failed", original: null, source: { file_name: "broken.json" } }] };
});
describe("bulk inbox deletion", () => {
  it("previews pending and failed items without a destination or write", () => {
    const plan = previewInboxDelete(selection);
    expect(plan.items.map(item => item.title)).toEqual(["A", "broken.json"]);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(confirmInboxDelete(selection, plan.fingerprint, "Alex").every(item => item.deleted)).toBe(true);
    expect(mocks.dismiss.mock.calls.map(([item]) => [item.kind, item.slug, item.cardId])).toEqual([
      ["project", "alpha", "same"], ["permit-qaqc", "beta", "same"],
    ]);
  });
  it("preflights later workspaces and refuses stale content or locations", () => {
    const plan = previewInboxDelete(selection);
    mocks.cards.beta = [{ ...mocks.cards.beta[0], original: { title: "Changed" } }];
    expect(() => confirmInboxDelete(selection, plan.fingerprint, "Alex")).toThrow(/changed/);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    const next = previewInboxDelete(selection); mocks.root = "/elsewhere";
    expect(() => confirmInboxDelete(selection, next.fingerprint, "Alex")).toThrow(/changed/);
  });
  it("refuses resolved items, missing previews, duplicates and oversized selections", () => {
    expect(() => confirmInboxDelete(selection, "", "Alex")).toThrow(/changed/);
    mocks.cards.beta = [{ ...mocks.cards.beta[0], status: "applied" }];
    expect(() => previewInboxDelete(selection)).toThrow(/changed/);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(inboxDeleteSchema.safeParse([selection[0], selection[0]]).success).toBe(false);
    expect(inboxDeleteSchema.safeParse(Array.from({ length: 101 }, (_, i) => ({ ...selection[0], cardId: String(i) }))).success).toBe(false);
  });
  it("reports individual failures without losing successful outcomes", () => {
    mocks.dismiss.mockImplementation(item => { if (item.slug === "alpha") throw Error("Unavailable"); });
    const result = confirmInboxDelete(selection, previewInboxDelete(selection).fingerprint, "Alex");
    expect(result.map(item => item.deleted)).toEqual([false, true]);
    expect(result[0].error).toBe("Unavailable");
  });
});
