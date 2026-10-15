import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDecision } from "@/lib/schema";

const roots: string[] = [];
let projectDir: string;

vi.mock("./projects", () => ({ contentDir: () => projectDir }));

import { ContentConflictError } from "./atomicContentWrite";
import {
  createProjectDecision,
  deleteProjectDecision,
  getProjectDecisions,
  supersedeProjectDecision,
  updateProjectDecision,
} from "./projectDecisions";

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-decisions-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function decision(overrides: Partial<ProjectDecision> = {}): ProjectDecision {
  return {
    version: 1,
    id: "decision-12345678",
    title: "Select storefront system",
    status: "proposed",
    decision_date: "2026-07-28",
    recorded_at: "2026-07-28T18:00:00.000Z",
    confirmed_by: "Alex",
    deciders: ["Client"],
    context: "The permit set needs one basis of design.",
    options: [{ label: "Option A", summary: "Aluminum storefront." }],
    outcome: "",
    rationale: "",
    consequences: [],
    affected_deliverables: ["A6.1"],
    sources: [{
      kind: "meeting",
      label: "Client review",
      path: "meetings/2026-07-28-client-review.md",
      url: null,
      item_id: "decision-1",
      source_date: "2026-07-28",
      notes: "",
    }],
    supersedes: null,
    superseded_by: null,
    ...overrides,
  };
}

describe("project decision records", () => {
  it("creates readable Markdown, loads it, and refuses stale revisions", () => {
    projectDir = temporaryRoot();
    const created = createProjectDecision("demo", decision());

    const raw = fs.readFileSync(path.join(projectDir, created.relativePath), "utf8");
    expect(raw).toContain("# Select storefront system");
    expect(raw).toContain("## Sources");
    expect(getProjectDecisions("demo")).toHaveLength(1);

    expect(() => updateProjectDecision(
      "demo",
      created.decision.id,
      { ...created.decision, context: "Changed elsewhere." },
      "stale-hash",
    )).toThrow(ContentConflictError);
  });

  it("creates a replacement before marking the original superseded", () => {
    projectDir = temporaryRoot();
    const original = createProjectDecision("demo", decision({
      status: "decided",
      outcome: "Use Option A.",
    }));
    const result = supersedeProjectDecision({
      slug: "demo",
      originalId: original.decision.id,
      originalExpectedHash: original.hash,
      replacement: decision({
        id: "decision-87654321",
        title: "Revise storefront selection",
        status: "decided",
        outcome: "Use Option B.",
        supersedes: original.decision.id,
      }),
    });

    expect(result.original.decision).toMatchObject({
      status: "superseded",
      superseded_by: "decision-87654321",
    });
    expect(result.replacement.decision.supersedes).toBe(original.decision.id);
  });

  it("deletes a record but keeps a recoverable copy on disk", () => {
    projectDir = temporaryRoot();
    const created = createProjectDecision("demo", decision());

    const { backupPath } = deleteProjectDecision("demo", created.decision.id, created.hash);

    expect(getProjectDecisions("demo")).toHaveLength(0);
    expect(fs.existsSync(path.join(projectDir, created.relativePath))).toBe(false);
    // Recoverable, not gone: a mis-click must never destroy an authored record outright.
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, "utf8")).toContain("# Select storefront system");
  });

  it("refuses to delete against a stale hash, so a stale page cannot discard a newer edit", () => {
    projectDir = temporaryRoot();
    const created = createProjectDecision("demo", decision());
    updateProjectDecision(
      "demo",
      created.decision.id,
      { ...created.decision, context: "Someone else edited this." },
      created.hash,
    );

    expect(() => deleteProjectDecision("demo", created.decision.id, created.hash))
      .toThrow(ContentConflictError);
    expect(getProjectDecisions("demo")).toHaveLength(1);
  });

  it("refuses to delete either half of a supersession chain", () => {
    projectDir = temporaryRoot();
    const original = createProjectDecision("demo", decision({
      status: "decided",
      outcome: "Use Option A.",
    }));
    const { original: superseded, replacement } = supersedeProjectDecision({
      slug: "demo",
      originalId: original.decision.id,
      originalExpectedHash: original.hash,
      replacement: decision({
        id: "decision-87654321",
        title: "Revise storefront selection",
        status: "decided",
        outcome: "Use Option B.",
        supersedes: original.decision.id,
      }),
    });

    // Deleting the superseded original would leave the replacement pointing at nothing.
    expect(() => deleteProjectDecision("demo", superseded.decision.id, superseded.hash))
      .toThrow(/history chain/);
    // And deleting the replacement would strand the original marked superseded_by a
    // record that no longer exists.
    expect(() => deleteProjectDecision("demo", replacement.decision.id, replacement.hash))
      .toThrow(/pointing at nothing/);
    expect(getProjectDecisions("demo")).toHaveLength(2);
  });

  it("ignores Dropbox conflicted-copy siblings", () => {
    projectDir = temporaryRoot();
    createProjectDecision("demo", decision());
    fs.writeFileSync(
      path.join(projectDir, "decisions", "2026-07-28-decision (Partner's conflicted copy 2026-07-29).md"),
      "invalid",
      "utf8",
    );
    expect(getProjectDecisions("demo")).toHaveLength(1);
  });
});
