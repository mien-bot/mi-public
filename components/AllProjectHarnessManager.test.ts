import { describe, expect, it } from "vitest";
import { canSubmitAllProjectHarness } from "./AllProjectHarnessManager";

describe("all-project harness renderer contract", () => {
  it("requires a preview, a separate confirmation, and an idle submit state", () => {
    expect(canSubmitAllProjectHarness(null, true, false)).toBe(false);
    expect(canSubmitAllProjectHarness("preview-id", false, false)).toBe(false);
    expect(canSubmitAllProjectHarness("preview-id", true, true)).toBe(false);
    expect(canSubmitAllProjectHarness("preview-id", true, false)).toBe(true);
  });
});
