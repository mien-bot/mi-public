import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeScheduleCreate, reserveScheduleCreate } from "./scheduleCreateJournal";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "mi-schedule-create-"));
  roots.push(value);
  return value;
}

describe("schedule create journal", () => {
  it("blocks an uncertain retry and returns a completed result without recreating it", () => {
    const dataRoot = root();
    const payload = { name: "Client meeting", date: "2026-08-10" };
    expect(reserveScheduleCreate("create-meeting", payload, dataRoot)).toEqual({ status: "reserved" });
    expect(reserveScheduleCreate("create-meeting", payload, dataRoot)).toEqual({ status: "pending-review" });

    const result = { id: "notion-page", url: "https://notion.so/notion-page" };
    completeScheduleCreate("create-meeting", payload, result, dataRoot);
    expect(reserveScheduleCreate("create-meeting", payload, dataRoot)).toEqual({
      status: "already-applied",
      result,
    });
  });

  it("refuses to reuse one request id for different event details", () => {
    const dataRoot = root();
    expect(reserveScheduleCreate("create-meeting", { date: "2026-08-10" }, dataRoot).status).toBe("reserved");
    expect(reserveScheduleCreate("create-meeting", { date: "2026-08-11" }, dataRoot).status).toBe("mismatch");
  });
});
