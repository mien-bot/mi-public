import { describe, expect, it } from "vitest";
import { parsePersonalReply } from "./proposals";

describe("personal assistant proposal parsing", () => {
  it("separates conversational text from reviewable records", () => {
    const parsed = parsePersonalReply(`That sounds worth capturing.

\`\`\`mi-personal-proposals
{"version":1,"proposals":[{"id":"follow-up","title":"Save follow-up","reason":"This is actionable.","kind":"personal-record","data":{"kind":"task","title":"Call Sam","body":"Ask about Friday.","tags":["follow-up"],"mood":null,"status":"active","schedule":null}}]}
\`\`\``);
    expect(parsed.reply).toBe("That sounds worth capturing.");
    expect(parsed.proposals[0]).toMatchObject({
      kind: "personal-record",
      data: { kind: "task", title: "Call Sam" },
    });
    expect(parsed.proposalError).toBeNull();
  });

  it("never treats malformed AI output as a savable record", () => {
    const parsed = parsePersonalReply("Hello\n```mi-personal-proposals\n{\"version\":1,\"proposals\":[{}]}\n```");
    expect(parsed.reply).toBe("Hello");
    expect(parsed.proposals).toEqual([]);
    expect(parsed.proposalError).toMatch(/invalid format/);
  });
});
