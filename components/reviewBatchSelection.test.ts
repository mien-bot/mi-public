import { describe, expect, it } from "vitest";
import { groupReviewSelection, reviewSelectionId } from "./reviewBatchSelection";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";

function view(slug: string, available = true) {
  return { workspace: { kind: "project", slug }, card: { id: "shared-agent-id" },
    destinations: [{ ref: { kind: "project-notes" }, available }] } as ReviewCardView;
}
describe("batch selection identity", () => {
  it("keeps identical agent IDs separate across projects", () => {
    expect(reviewSelectionId(view("alpha"))).not.toBe(reviewSelectionId(view("beta")));
    expect(groupReviewSelection([view("alpha"), view("beta")])).toHaveLength(2);
  });
  it("only offers destinations that every item in the group can reach", () => {
    expect(groupReviewSelection([view("alpha"), view("alpha", false)])[0].destinations).toEqual([]);
  });
});
