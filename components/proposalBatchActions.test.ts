import { describe, expect, it } from "vitest";
import { activeProposalAction, sharedProposalActions } from "./proposalBatchActions";
import type { ProposalAction } from "@/components/ProposalReview";

function action(key: string, extra: Partial<ProposalAction> = {}): ProposalAction {
  return { key, label: key, run: async () => ({ ok: true, message: "" }), ...extra };
}

describe("bulk proposal confirmation", () => {
  it("offers only actions every selected proposal can run", () => {
    const shared = sharedProposalActions([
      { actions: [action("mi"), action("notion", { primary: true })] },
      { actions: [action("mi"), action("notion", { disabled: true })] },
    ]);
    expect(shared.map((entry) => entry.key)).toEqual(["mi"]);
  });

  it("drops an action a selected proposal does not have at all", () => {
    const shared = sharedProposalActions([
      { actions: [action("mi"), action("dropbox")] },
      { actions: [action("mi")] },
    ]);
    expect(shared.map((entry) => entry.key)).toEqual(["mi"]);
  });

  it("offers nothing for an empty selection", () => {
    expect(sharedProposalActions([])).toEqual([]);
  });

  it("keeps a single shared action selected without a click", () => {
    const available = [action("mi")];
    expect(activeProposalAction(available, "")?.key).toBe("mi");
  });

  it("defaults to the primary action when several are shared", () => {
    const available = [action("mi"), action("notion", { primary: true })];
    expect(activeProposalAction(available, "")?.key).toBe("notion");
    expect(activeProposalAction(available, "mi")?.key).toBe("mi");
  });

  it("drops a chosen action the selection can no longer run", () => {
    // The person picked "dropbox", then added a proposal that cannot go there. Falling back
    // is what keeps the button from meaning something the selection does not support.
    const available = [action("mi"), action("notion", { primary: true })];
    expect(activeProposalAction(available, "dropbox")?.key).toBe("notion");
    expect(activeProposalAction([], "dropbox")).toBeNull();
  });

  it("makes the person choose when several actions are shared and none is primary", () => {
    // The inbox surfaces "Dismiss" alongside the confirmations, and the primary one is
    // disabled on an unlinked project. Guessing here would run the first action in the
    // list -- Dismiss -- across everything selected.
    const available = [action("dismiss"), action("mi")];
    expect(activeProposalAction(available, "")).toBeNull();
    expect(activeProposalAction(available, "mi")?.key).toBe("mi");
  });
});
