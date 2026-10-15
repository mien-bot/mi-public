import { describe, expect, it } from "vitest";
import { miHelperSuggestions } from "./miHelperSuggestions";

describe("Mini Mi page guidance", () => {
  it("keeps project suggestions in the exact current workspace", () => {
    const guidance = miHelperSuggestions("/projects/confirmed-project/terminal");
    expect(guidance.items[0].href).toBe("/review?workspace=project%2Fconfirmed-project");
    expect(guidance.items[1].href).toBe("/projects/confirmed-project/knowledge");
    expect(guidance.items[2].detail).toContain("does not export this conversation");
  });
  it("uses lead chat rather than starting an unrelated firm conversation", () => {
    expect(miHelperSuggestions("/leads/alpha/contracts").chatHref).toBe("/leads/alpha/chat");
  });
  it("does not mistake portfolio analysis for a project", () => {
    expect(miHelperSuggestions("/projects/analysis").context).toBe("Your studio");
  });
  it("keeps private suggestions out of the firm review inbox", () => {
    expect(miHelperSuggestions("/personal").items.some(item => item.href.startsWith("/review"))).toBe(false);
  });
  it("does not turn malformed paths into project links", () => {
    expect(miHelperSuggestions("/projects/../settings").context).toBe("Your studio");
    expect(miHelperSuggestions("/projects/%2e%2e").context).toBe("Your studio");
  });
});
