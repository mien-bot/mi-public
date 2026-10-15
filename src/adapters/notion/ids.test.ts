import { describe, expect, it } from "vitest";
import { configuredNotionId, normalizeNotionId } from "./ids";

describe("Notion identifiers", () => {
  it("normalizes UUID and collection data-source forms", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(normalizeNotionId(id)).toBe("11111111111111111111111111111111");
    expect(normalizeNotionId(`collection://${id}`)).toBe("11111111111111111111111111111111");
  });

  it("prefers the current data-source setting and rejects malformed values", () => {
    expect(configuredNotionId(
      {
        NOTION_PROJECTS_DATA_SOURCE_ID: "collection://11111111-1111-1111-1111-111111111111",
        NOTION_PROJECTS_DATABASE_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      },
      "NOTION_PROJECTS_DATA_SOURCE_ID",
      "NOTION_PROJECTS_DATABASE_ID",
    )).toBe("11111111111111111111111111111111");
    expect(() => normalizeNotionId("not-an-id")).toThrow(/Notion UUID/);
  });
});
