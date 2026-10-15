import { describe, expect, it } from "vitest";
import { parseMapArgs } from "./notion-project-map";
import { normalizeNotionId } from "../src/adapters/notion/ids";

describe("Notion project-map CLI", () => {
  it("accepts current collection data-source identifiers", () => {
    const parsed = parseMapArgs([
      "--json",
      "--projects-db",
      "collection://11111111-1111-1111-1111-111111111111",
    ]);
    expect(parsed).toMatchObject({
      json: true,
      projectsDatabaseId: "collection://11111111-1111-1111-1111-111111111111",
    });
    expect(normalizeNotionId(
      "collection://11111111-1111-1111-1111-111111111111",
    )).toBe("11111111111111111111111111111111");
  });
});
