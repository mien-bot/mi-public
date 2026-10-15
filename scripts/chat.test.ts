import { describe, expect, it } from "vitest";
import { chatUrl, parseChatArgs } from "./chat";

describe("parseChatArgs", () => {
  it("parses project and engine launch selections", () => {
    expect(parseChatArgs(["--project", "example-record-35", "--engine", "codex"]))
      .toEqual({ project: "example-record-35", engine: "codex", help: false });
  });

  it("rejects unsafe project slugs", () => {
    expect(() => parseChatArgs(["--project", "../outside"]))
      .toThrow(/Invalid project slug/);
  });

  it("rejects unsupported engines", () => {
    expect(() => parseChatArgs(["--engine", "other"]))
      .toThrow(/Expected claude or codex/);
  });
});

describe("chatUrl", () => {
  it("encodes launch selections into the home URL", () => {
    expect(chatUrl("3050", { project: "chicago", engine: "claude", help: false }))
      .toBe("http://localhost:3050/?project=chicago&engine=claude");
  });
});