import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const links = require("./notionLinks.js") as {
  validateNotionTarget(value: unknown): string | null;
  toNotionDeepLink(value: string): string | null;
};

describe("constrained Notion links", () => {
  it("accepts Notion page ids and HTTPS Notion hosts", () => {
    expect(links.validateNotionTarget("33333333-3333-3333-3333-333333333333"))
      .toBe("https://www.notion.so/33333333333333333333333333333333");
    expect(links.validateNotionTarget("https://app.notion.com/p/33333333333333333333333333333333"))
      .toContain("app.notion.com");
  });

  it("builds the installed notion protocol and rejects arbitrary URLs", () => {
    expect(links.toNotionDeepLink("https://www.notion.so/33333333333333333333333333333333"))
      .toBe("notion://www.notion.so/33333333333333333333333333333333");
    expect(links.validateNotionTarget("https://example.com/notion")).toBe(null);
    expect(links.validateNotionTarget("file:///C:/Windows/System32")).toBe(null);
  });
});
