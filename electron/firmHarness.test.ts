import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { applyFirmHarness, previewFirmHarness, resolveFirmHarnessRoot } = require("./firmHarness");

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-firm-harness-"));
  roots.push(root);
  const dropboxRoot = path.join(root, "STUDIO Dropbox");
  const firmRoot = path.join(dropboxRoot, "7.00 Mi Data");
  fs.mkdirSync(firmRoot, { recursive: true });
  const templatePath = path.join(root, "firm-common-rules.md");
  fs.writeFileSync(templatePath, "Canonical firm-wide rule.\nRead-only planning copilot.\n", "utf8");
  const options = {
    dropboxRoot,
    dropboxFirmDataPath: "7.00 Mi Data",
    templatePath,
    synchronizedAt: "2026-07-27T12:00:00.000Z",
  };
  return { ...options, firmRoot };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("firm-wide chat workspace harness", () => {
  it("rejects an unconfirmed shared data folder and performs no writes", () => {
    const item = fixture();
    expect(() => resolveFirmHarnessRoot(item.dropboxRoot, "")).toThrow(/Confirm the shared Mi data folder/);
    expect(() => resolveFirmHarnessRoot(item.dropboxRoot, "../outside")).toThrow(/escapes/);
    const preview = previewFirmHarness(item);
    expect(fs.existsSync(path.join(item.firmRoot, "Mi"))).toBe(false);
    expect(() => applyFirmHarness(preview, { confirmed: false })).toThrow(/confirmation/);
    expect(fs.existsSync(path.join(item.firmRoot, "Mi"))).toBe(false);
  });

  it("renders both agent files from one canonical source, plus the portfolio briefing when supplied", () => {
    const item = fixture();
    const preview = previewFirmHarness({ ...item, portfolioBriefing: "Portfolio briefing for 2026-07-27." });
    applyFirmHarness(preview, { confirmed: true });

    const agents = fs.readFileSync(path.join(item.firmRoot, "Mi", "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(item.firmRoot, "Mi", "CLAUDE.md"), "utf8");
    expect(agents).toContain("Canonical firm-wide rule.");
    expect(claude).toContain("Canonical firm-wide rule.");
    expect(agents.match(/Canonical rules SHA-256: `([^`]+)`/)?.[1]).toBe(
      claude.match(/Canonical rules SHA-256: `([^`]+)`/)?.[1],
    );

    const portfolio = fs.readFileSync(path.join(item.firmRoot, "Mi", "PORTFOLIO_CONTEXT.md"), "utf8");
    expect(portfolio).toContain("Portfolio briefing for 2026-07-27.");
    expect(portfolio).not.toContain(item.dropboxRoot);
  });

  it("omits PORTFOLIO_CONTEXT.md and SCHEDULE_CONTEXT.md when neither is available", () => {
    const item = fixture();
    const preview = previewFirmHarness(item);
    applyFirmHarness(preview, { confirmed: true });
    expect(fs.existsSync(path.join(item.firmRoot, "Mi", "PORTFOLIO_CONTEXT.md"))).toBe(false);
    expect(fs.existsSync(path.join(item.firmRoot, "Mi", "SCHEDULE_CONTEXT.md"))).toBe(false);
  });

  it("writes the local fetch helper, whose key must stay forward-slashed for the apply lookup", () => {
    const item = fixture();
    const preview = previewFirmHarness(item);
    expect(preview.entries.some((e: { relativePath: string }) => e.relativePath === "tools/fetch-url.ps1")).toBe(true);

    const results = applyFirmHarness(preview, { confirmed: true });
    expect(results.find((r: { relativePath: string }) => r.relativePath === "tools/fetch-url.ps1")?.status).toBe("created");
    expect(fs.readFileSync(path.join(item.firmRoot, "Mi", "tools", "fetch-url.ps1"), "utf8"))
      .toContain("/api/local-fetch");
  });

  it("builds firm-wide (unfiltered) SCHEDULE_CONTEXT.md from the same background snapshot", () => {
    const item = fixture();
    const notionDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mi-firm-harness-notion-"));
    roots.push(notionDataRoot);
    fs.mkdirSync(path.join(notionDataRoot, "notion"), { recursive: true });
    fs.writeFileSync(
      path.join(notionDataRoot, "notion", "schedule-snapshot.json"),
      JSON.stringify({
        schema_version: 1,
        generated_at: "2026-07-27T00:00:00.000Z",
        window: { from: "2026-06-27", to: "2026-10-25" },
        entries: [
          { notion_page_id: "e1", name: "Client Meeting", date: "2026-08-01", type: ["Client Meeting"], attendees: [{ id: "p1", name: "Example User" }], project_page_ids: ["proj-1"] },
          { notion_page_id: "e2", name: "PTO", date: "2026-08-02", type: [], attendees: [{ id: "p1", name: "Example User" }], project_page_ids: [] },
        ],
      }),
      "utf8",
    );

    const preview = previewFirmHarness({ ...item, dataRoot: notionDataRoot, notionAttendeeName: "Example User" });
    applyFirmHarness(preview, { confirmed: true });
    const generated = fs.readFileSync(path.join(item.firmRoot, "Mi", "SCHEDULE_CONTEXT.md"), "utf8");

    expect(generated).toContain("2026-08-01: Client Meeting");
    expect(generated).toContain("2026-08-02: PTO");
    expect(generated).toContain('Items where "Example User" is listed in Attendance (2)');
    expect(generated).not.toContain("This project's items");
  });

  it("preserves user-authored memory and treats a foreign manifest.json as a conflict", () => {
    const item = fixture();
    const harnessRoot = path.join(item.firmRoot, "Mi");
    fs.mkdirSync(harnessRoot, { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, "manifest.json"), '{"owner":"partner"}\n', "utf8");
    const memory = path.join(harnessRoot, "memory", "notes.md");
    fs.mkdirSync(path.dirname(memory), { recursive: true });
    fs.writeFileSync(memory, "Firm-authored planning note.\n", "utf8");

    const preview = previewFirmHarness(item);
    expect(preview.entries.find((e: { relativePath: string }) => e.relativePath === "manifest.json")?.action).toBe("conflict");
    const results = applyFirmHarness(preview, { confirmed: true });
    expect(results.find((r: { relativePath: string }) => r.relativePath === "manifest.json")?.status).toBe("conflict");
    expect(fs.readFileSync(path.join(harnessRoot, "manifest.json"), "utf8")).toBe('{"owner":"partner"}\n');
    expect(fs.readFileSync(memory, "utf8")).toBe("Firm-authored planning note.\n");
  });

  it("creates separate preserved memory files for personal, leads, and Permit QA/QC context", () => {
    const item = fixture();
    const preview = previewFirmHarness(item);
    applyFirmHarness(preview, { confirmed: true });
    const memoryRoot = path.join(item.firmRoot, "Mi", "memory");

    expect(fs.readFileSync(path.join(memoryRoot, "personal.md"), "utf8")).toContain("Personal assistant memory");
    expect(fs.readFileSync(path.join(memoryRoot, "leads.md"), "utf8")).toContain("Leads memory");
    expect(fs.readFileSync(path.join(memoryRoot, "permit-qaqc.md"), "utf8")).toContain("Permit QA/QC memory");

    fs.writeFileSync(path.join(memoryRoot, "leads.md"), "Partner-authored lead note.\n", "utf8");
    const refresh = previewFirmHarness(item);
    expect(refresh.entries.find((entry: { relativePath: string }) => entry.relativePath === "memory/leads.md")?.action).toBe("preserve");
    applyFirmHarness(refresh, { confirmed: true });
    expect(fs.readFileSync(path.join(memoryRoot, "leads.md"), "utf8")).toBe("Partner-authored lead note.\n");
  });
});
