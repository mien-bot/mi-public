import { describe, expect, it } from "vitest";
import { isWriteAllowed } from "./approvals";

describe("isWriteAllowed", () => {
  it("allows the fields/operations listed in the committed mi.config.yaml", () => {
    expect(isWriteAllowed("project", "status")).toBe(true);
    expect(isWriteAllowed("project", "client")).toBe(true);
    expect(isWriteAllowed("project", "address")).toBe(true);
    expect(isWriteAllowed("schedule", "create")).toBe(true);
    expect(isWriteAllowed("schedule", "planned_date")).toBe(true);
    expect(isWriteAllowed("schedule", "actual_date")).toBe(true);
    expect(isWriteAllowed("schedule", "start_time")).toBe(true);
    expect(isWriteAllowed("schedule", "end_time")).toBe(true);
  });

  it("refuses anything not explicitly listed, even for a known record type", () => {
    expect(isWriteAllowed("project", "name")).toBe(false);
    expect(isWriteAllowed("schedule", "type")).toBe(false);
  });
});
