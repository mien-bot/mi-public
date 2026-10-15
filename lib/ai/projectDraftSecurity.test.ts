import { describe, expect, it } from "vitest";
import {
  PROJECT_DRAFT_READ_ONLY,
  projectDraftEnvironment,
  projectDraftPrompt,
} from "./projectDraftSecurity";

describe("project AI draft security", () => {
  it("passes the subscription token only to Claude and never forwards an API key", () => {
    const restricted = {
      PATH: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "ambient-oauth-token",
      ANTHROPIC_API_KEY: "ambient-api-key",
    };
    const claude = projectDraftEnvironment("claude", restricted, "stored-oauth-token");
    const codex = projectDraftEnvironment("codex", restricted, "stored-oauth-token");

    expect(claude).toEqual({
      PATH: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "stored-oauth-token",
    });
    expect(codex).toEqual({ PATH: "C:\\Windows" });
  });

  it.each([
    ["planning", { requirements: "Synthetic requirements" }],
    ["meeting", { notes: "Synthetic meeting notes" }],
  ] as const)("keeps %s output an editable, read-only draft", (purpose, input) => {
    const prompt = projectDraftPrompt(purpose, "Synthetic project", input);
    expect(prompt).toContain("drafting");
    expect(prompt).toContain("for human review");
    expect(prompt).toContain("read-only environment");
    expect(prompt).toContain("Do not use tools, write files, contact external systems, or modify Notion/Dropbox.");
    expect(prompt).toContain("Return JSON only");
    expect(PROJECT_DRAFT_READ_ONLY).toBe(true);
  });

  it("grounds project plans in existing phases and milestones without authorizing writes", () => {
    const prompt = projectDraftPrompt("planning", "Synthetic project", {
      user_request: { target_dates: "Permit by October" },
      existing_details: { phases: [{ name: "Design Development", planned_end_date: "2026-09-15" }] },
      existing_milestones: [{ name: "DD issue", planned_date: "2026-09-15" }],
    });
    expect(prompt).toContain("preserve confirmed dates");
    expect(prompt).toContain("avoid duplicate milestones");
    expect(prompt).toContain("Design Development");
    expect(prompt).toContain("DD issue");
    expect(prompt).toContain("Do not use tools");
  });
});
