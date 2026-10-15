import { describe, expect, it } from "vitest";
import { nextTerminalSession } from "./terminalSessions";

describe("next terminal window", () => {
  it("preserves the embedded session and other windows", () => {
    expect(nextTerminalSession("projects/a", [{ workspace: "projects/a", session: "2" }], "1")).toBe("3");
  });
  it("keeps projects independent", () => {
    expect(nextTerminalSession("projects/a", [{ workspace: "projects/b", session: "1" }])).toBe("1");
  });
  it("stops at four and reuses a closed window's durable session", () => {
    const panes = ["1", "2", "3", "4"].map(session => ({ workspace: "projects/a", session }));
    expect(nextTerminalSession("projects/a", panes)).toBeUndefined();
    expect(nextTerminalSession("projects/a", panes.filter(p => p.session !== "2"))).toBe("2");
  });
});
