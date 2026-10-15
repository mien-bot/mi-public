import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./paths", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { REPO_ROOT: mkdtempSync(join(tmpdir(), "mi-firm-memory-")) };
});

import { REPO_ROOT } from "./paths";
import { appendFirmMemoryNote, firmMemoryPath } from "./firmMemory";

afterAll(() => {
  fs.rmSync(REPO_ROOT, { recursive: true, force: true });
});

describe("appendFirmMemoryNote", () => {
  beforeEach(() => {
    fs.rmSync(firmMemoryPath("leads"), { force: true });
  });

  it("resolves to the shared, git-tracked leads playbook path", () => {
    expect(firmMemoryPath("leads")).toBe(
      path.join(REPO_ROOT, ".agent", "memory", "shared", "lead-precontract.md"),
    );
  });

  it("creates the file with a heading section when none exists yet", () => {
    appendFirmMemoryNote("leads", {
      title: "Ask about permits early",
      entry: "Always confirm permit status before quoting a fee.",
    });

    const content = fs.readFileSync(firmMemoryPath("leads"), "utf8");
    expect(content).toContain("last_updated:");
    expect(content).toContain("## Ask about permits early");
    expect(content).toContain("Always confirm permit status before quoting a fee.");
  });

  it("appends after existing content instead of overwriting it", () => {
    fs.mkdirSync(path.dirname(firmMemoryPath("leads")), { recursive: true });
    fs.writeFileSync(firmMemoryPath("leads"), "# Lead and pre-contract memory\n\nExisting guidance.\n", "utf8");

    appendFirmMemoryNote("leads", { title: "New insight", entry: "Something new." });

    const content = fs.readFileSync(firmMemoryPath("leads"), "utf8");
    expect(content).toContain("Existing guidance.");
    expect(content).toContain("## New insight");
    expect(content).toContain("Something new.");
  });

  it("returns the path it wrote to", () => {
    const file = appendFirmMemoryNote("leads", { title: "Note", entry: "Entry." });
    expect(file).toBe(firmMemoryPath("leads"));
  });
});
