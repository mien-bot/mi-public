import { describe, expect, it } from "vitest";
import { newChatWindowHref } from "./NewChatWindowButton";

describe("newChatWindowHref", () => {
  it("opens every supported chat surface as a fresh conversation", () => {
    expect(newChatWindowHref("/")).toBe("/?newChat=1");
    expect(newChatWindowHref("/personal")).toBe("/personal?newChat=1");
    expect(newChatWindowHref("/leads")).toBe("/leads?newChat=1");
    expect(newChatWindowHref("/permit-qaqc")).toBe("/permit-qaqc?newChat=1");
  });
});
