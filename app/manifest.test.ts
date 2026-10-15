import { describe, expect, it } from "vitest";

import manifest from "./manifest";

describe("web app manifest", () => {
  it("provides a scoped standalone shell and install icons", () => {
    const value = manifest();
    expect(value).toMatchObject({
      id: "/",
      short_name: "Mi",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    ]));
  });
});
