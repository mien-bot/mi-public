import { describe, expect, it } from "vitest";
import { compactChatHref } from "./CompactChatButton";

describe("compactChatHref", () => {
  it("opens the pinned Talk to Mi card and carries only an explicit project slug", () => {
    expect(compactChatHref()).toBe("/chat?compactChat=1");
    expect(compactChatHref("example-record-35"))
      .toBe("/chat?compactChat=1&project=example-record-35");
  });
});
