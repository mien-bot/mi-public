import { describe, expect, it } from "vitest";
import { escapeHtml, remoteDocument } from "./view";

describe("remote viewer", () => {
  it("escapes untrusted content and offers no desktop controls or scripts", () => {
    const html = remoteDocument([{ slug: "fixture", name: '<script>alert("x")</script>', status: "in-progress" }], null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("/settings");
    expect(html).not.toContain("/personal");
    expect(escapeHtml(`"<>&'`)).toBe("&quot;&lt;&gt;&amp;&#39;");
  });
});
