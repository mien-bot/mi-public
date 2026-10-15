import { describe, expect, it } from "vitest";

const { buildDiagnostics } = require("./diagnostics");

describe("diagnostics", () => {
  it("reports health without credentials, paths, or project content", () => {
    const diagnostics = buildDiagnostics({
      version: "1.0.0",
      config: {
        setupCompleted: true,
        hasNotionToken: true,
        dropboxRoot: "D:\\Private Dropbox\\STUDIO",
        codeLibraryRoot: "D:\\Private Codes",
        timezone: "America/Chicago",
        notionProjectsDataSourceId: "private-id",
        notionScheduleDataSourceId: "private-id",
      },
      cliStatus: { codex: { available: true }, claude: { available: false } },
      notionHealth: null,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("Private Dropbox");
    expect(serialized).not.toContain("Private Codes");
    expect(serialized).not.toContain("private-id");
    expect(serialized).not.toContain("NOTION_API_KEY");
  });
});
