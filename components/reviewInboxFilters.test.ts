import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_FILTERS,
  applyReviewFilters,
  filterReviewItems,
  kindGroupCounts,
  kindGroupFor,
  sortReviewItems,
  type ReviewListItem,
} from "./reviewInboxFilters";

function item(overrides: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    id: "entry-1",
    status: "pending",
    entryKind: "meeting",
    visibility: "internal",
    workspaceKind: "lead",
    workspaceSlug: "example",
    workspaceLabel: "example-record-70",
    sortedAt: "2026-08-15T15:00:00.000Z",
    title: "Owner walkthrough",
    ...overrides,
  };
}

const items: ReviewListItem[] = [
  item({ id: "a", entryKind: "meeting", sortedAt: "2026-08-15T15:00:00.000Z" }),
  item({ id: "b", entryKind: "decision", sortedAt: "2026-08-10T09:00:00.000Z", title: "Liability cap" }),
  item({ id: "c", entryKind: "reference", visibility: "client-visible", sortedAt: "2026-08-12T09:00:00.000Z", title: "Zoning link" }),
  item({
    id: "d",
    entryKind: "record-change",
    status: "applied",
    workspaceKind: "project",
    workspaceSlug: "SampleStudio",
    workspaceLabel: "25-001 SampleStudio",
    sortedAt: "2026-08-01T09:00:00.000Z",
    title: "Fee ladder",
  }),
  item({ id: "e", entryKind: null, status: "failed", sortedAt: "2026-08-14T09:00:00.000Z", title: "broken.json" }),
];

describe("kindGroupFor", () => {
  it("folds the nine entry kinds into the seven filters the mailbox offers", () => {
    expect(kindGroupFor("meeting")).toBe("meetings");
    expect(kindGroupFor("record-change")).toBe("record-changes");
    // Things learned rather than things to do share one chip.
    expect(kindGroupFor("fact")).toBe("facts");
    expect(kindGroupFor("lesson")).toBe("facts");
    expect(kindGroupFor("open-question")).toBe("facts");
    // A failed import has no entry kind at all and must not be forced into one.
    expect(kindGroupFor(null)).toBeNull();
  });
});

describe("filterReviewItems", () => {
  it("defaults to what still needs a person, not to everything", () => {
    const visible = filterReviewItems(items, DEFAULT_REVIEW_FILTERS);
    expect(visible.map((entry) => entry.id).sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("treats an empty chip list as 'all of this dimension' rather than 'none'", () => {
    // Selecting nothing showing nothing is the most common way a filter bar reads as broken.
    const visible = filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, statuses: [], kinds: [], visibilities: [] });
    expect(visible).toHaveLength(items.length);
  });

  it("filters by kind, visibility, workspace, and free text", () => {
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, kinds: ["meetings"] }).map((entry) => entry.id))
      .toEqual(["a"]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, visibilities: ["client-visible"] }).map((entry) => entry.id))
      .toEqual(["c"]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, statuses: [], workspace: "project/SampleStudio" }).map((entry) => entry.id))
      .toEqual(["d"]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, query: "liability" }).map((entry) => entry.id))
      .toEqual(["b"]);
  });

  it("excludes a failed import from a kind filter, since it has no kind to match", () => {
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, kinds: ["facts"] })).toHaveLength(0);
  });
});

describe("sortReviewItems", () => {
  it("orders by entry time, oldest, workspace, and kind", () => {
    const pending = filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, statuses: [] });
    expect(sortReviewItems(pending, "newest").map((entry) => entry.id)).toEqual(["a", "e", "c", "b", "d"]);
    expect(sortReviewItems(pending, "oldest").map((entry) => entry.id)).toEqual(["d", "b", "c", "e", "a"]);
    expect(sortReviewItems(pending, "workspace")[0].workspaceLabel).toBe("25-001 SampleStudio");
    expect(sortReviewItems(pending, "kind").map((entry) => entry.entryKind))
      .toEqual(["decision", "meeting", "record-change", "reference", null]);
  });
});

describe("kindGroupCounts", () => {
  it("counts a chip before its own dimension is applied, so a selected chip never reads zero", () => {
    const counts = kindGroupCounts(items, { ...DEFAULT_REVIEW_FILTERS, kinds: ["meetings"] });
    expect(counts.meetings).toBe(1);
    expect(counts.decisions).toBe(1);
    expect(counts.references).toBe(1);
    // `d` is applied, which the status filter excludes.
    expect(counts["record-changes"]).toBe(0);
  });
});

describe("applyReviewFilters", () => {
  it("filters then sorts in one pass", () => {
    expect(applyReviewFilters(items, { ...DEFAULT_REVIEW_FILTERS, sort: "oldest" }).map((entry) => entry.id))
      .toEqual(["b", "c", "e", "a"]);
  });
});
