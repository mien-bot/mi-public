import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentConflictError } from "./atomicContentWrite";

const state = vi.hoisted(() => ({ contentRoot: "" }));
vi.mock("./projects", () => ({ contentDir: () => state.contentRoot }));

import {
  getProjectWorklogWithHash,
  projectWorklogPath,
  writeProjectWorklog,
} from "./projectWorklog";

const entry = {
  id: "notion-entry-1",
  name: "Drawing coordination",
  date: "2026-08-05",
  hours: 2,
  attendees: ["Example User"],
  notes: "Reviewed coordination items.",
  notion_event_id: "entry-1",
  notion_url: "https://www.notion.so/entry-1",
  sync_key: "worklog-1",
};

describe("project worklog shared storage", () => {
  beforeEach(() => {
    state.contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mi-shared-worklog-"));
  });

  afterEach(() => fs.rmSync(state.contentRoot, { recursive: true, force: true }));

  it("writes beneath the resolved project content root", () => {
    writeProjectWorklog("demo", [entry], { expectedHash: null });
    expect(projectWorklogPath("demo")).toBe(path.join(state.contentRoot, "schedule", "worklog.yaml"));
    expect(getProjectWorklogWithHash("demo").entries).toEqual([entry]);
  });

  it("refuses a stale partner write instead of replacing the current worklog", () => {
    writeProjectWorklog("demo", [entry], { expectedHash: null });
    const staleHash = getProjectWorklogWithHash("demo").hash;
    writeProjectWorklog("demo", [{ ...entry, hours: 3 }], { expectedHash: staleHash });
    expect(() => writeProjectWorklog("demo", [{ ...entry, hours: 4 }], { expectedHash: staleHash }))
      .toThrow(ContentConflictError);
    expect(getProjectWorklogWithHash("demo").entries[0].hours).toBe(3);
  });
});
