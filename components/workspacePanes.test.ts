import { describe, expect, it } from "vitest";
import {
  isPaneWindowRoute,
  normalizeWorkspaceCwd,
  paneWindowsAvailable,
  workspaceDisplayName,
} from "./workspacePanes";

describe("workspace pane targets", () => {
  it("only accepts workspaces the terminal IPC already resolves", () => {
    expect(normalizeWorkspaceCwd("projects/example-record-35")).toBe("projects/example-record-35");
    expect(normalizeWorkspaceCwd("leads/demo-lead")).toBe("leads/demo-lead");
    expect(normalizeWorkspaceCwd("permit-qaqc/demo")).toBe("permit-qaqc/demo");
    expect(normalizeWorkspaceCwd("projects\\example-record-35\\")).toBe("projects/example-record-35");
    expect(normalizeWorkspaceCwd("projects/../../etc")).toBe(".");
    expect(normalizeWorkspaceCwd(null)).toBe(".");
  });

  it("names each workspace the way the titlebar reads it", () => {
    expect(workspaceDisplayName("projects/example-record-35")).toBe("example record 35");
    expect(workspaceDisplayName("leads/demo-lead")).toBe("Lead · demo lead");
    expect(workspaceDisplayName("permit-qaqc/demo")).toBe("QA/QC · demo");
    expect(workspaceDisplayName(".")).toBe("Firm + personal");
    expect(workspaceDisplayName("../escape")).toBe("Firm + personal");
  });

  it("knows which routes are a pop-out card rather than a page in the app shell", () => {
    // Both of these draw their own titlebar over the whole window: the app header would
    // cover them (it is z-60 to their z-50) and the route wrapper's retained transform would
    // trap their fixed surface in a zero-height box.
    expect(isPaneWindowRoute("/terminal/window")).toBe(true);
    expect(isPaneWindowRoute("/chat")).toBe(true);
    expect(isPaneWindowRoute("/personal/window")).toBe(true);
    // The Studio terminal page, the Personal page, and every ordinary route keep the full app
    // shell. The personal chat card shipped pointed at "/personal" itself and came up as an
    // empty window with no titlebar to close it.
    expect(isPaneWindowRoute("/terminal")).toBe(false);
    expect(isPaneWindowRoute("/personal")).toBe(false);
    expect(isPaneWindowRoute("/projects/example-record-35")).toBe(false);
    expect(isPaneWindowRoute("/")).toBe(false);
  });

  it("only reports pinned windows where the desktop app can actually open one", () => {
    // Mi's packaged server answers on 127.0.0.1:3050, so these pages also load in an
    // ordinary browser. There the pty IPC is absent and a pop-out could only ever produce a
    // window with no shell behind it, so every pop-out control gates on this.
    const globals = globalThis as { window?: unknown };
    const original = globals.window;
    try {
      globals.window = {};
      expect(paneWindowsAvailable()).toBe(false);
      globals.window = { electronAPI: { windows: {} } };
      expect(paneWindowsAvailable()).toBe(false);
      globals.window = { electronAPI: { windows: { openPane: () => undefined } } };
      expect(paneWindowsAvailable()).toBe(true);
    } finally {
      globals.window = original;
    }
  });
});
