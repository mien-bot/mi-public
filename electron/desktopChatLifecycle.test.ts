import { describe, expect, it, vi } from "vitest";

const {
  PROJECT_CHAT_SHORTCUT,
  compactChatUrl,
  compactChatSize,
  createIdempotentCleanup,
  createProjectContextTracker,
  mainWindowCloseAction,
  normalizeChatWindowPath,
  normalizePaneKind,
  normalizePaneWorkspace,
  paneWindowSize,
  projectSlugFromCwd,
  terminalPaneUrl,
  terminalPaneKey,
} = require("./desktopChatLifecycle");

const ORIGIN = "http://127.0.0.1:3050";

it("gives each workspace session a separate window identity and restores the same target", () => {
  for (const kind of ["projects", "leads", "permit-qaqc"]) {
    const workspace = `${kind}/demo`;
    const keys = ["1", "2", "3", "4"].map((session) => terminalPaneKey(workspace, session));
    expect(new Set(keys).size).toBe(4);
    expect(new URL(terminalPaneUrl(ORIGIN, workspace, "3")).searchParams.get("session")).toBe("3");
    expect(terminalPaneKey(workspace, "../other")).toBe(keys[0]);
  }
  expect(terminalPaneKey("leads/demo", "2")).not.toBe(terminalPaneKey("projects/demo", "2"));
});

describe("desktop project-chat context", () => {
  it("uses the platform-neutral CommandOrControl global shortcut", () => {
    expect(PROJECT_CHAT_SHORTCUT).toBe("CommandOrControl+Shift+Space");
  });

  it("builds a contained chat-only URL with an optional validated project", () => {
    expect(compactChatUrl(ORIGIN)).toBe(`${ORIGIN}/chat?compactChat=1&chatWindow=compact`);
    expect(compactChatUrl(ORIGIN, "example-record-35", "one"))
      .toBe(`${ORIGIN}/chat?compactChat=1&chatWindow=one&project=example-record-35`);
    expect(compactChatUrl(ORIGIN, "../outside"))
      .toBe(`${ORIGIN}/chat?compactChat=1&chatWindow=compact`);
    // A card must be pointed at a pane-only route. "/personal" is an ordinary page, and
    // pointing the card there left the app header covering its titlebar and its fixed surface
    // trapped in the route wrapper's zero-height box -- an empty window with no way to close it.
    expect(compactChatUrl(ORIGIN, null, "compact-personal", "personal"))
      .toBe(`${ORIGIN}/personal/window?compactChat=1&chatWindow=compact-personal`);
  });

  it("uses bounded expanded and bar-sized compact chat dimensions", () => {
    expect(compactChatSize(false)).toEqual({ width: 480, height: 680, minWidth: 360, minHeight: 420 });
    expect(compactChatSize(true)).toEqual({ width: 420, height: 104, minWidth: 360, minHeight: 96 });
  });

  it("only forwards workspaces the terminal IPC already resolves to a pane window", () => {
    expect(normalizePaneWorkspace("projects/example-record-35")).toBe("projects/example-record-35");
    expect(normalizePaneWorkspace("leads/demo-lead")).toBe("leads/demo-lead");
    expect(normalizePaneWorkspace("permit-qaqc/demo")).toBe("permit-qaqc/demo");
    expect(normalizePaneWorkspace("projects\\example-record-35\\")).toBe("projects/example-record-35");
    expect(normalizePaneWorkspace("projects/../../etc")).toBe(".");
    expect(normalizePaneWorkspace("settings/demo")).toBe(".");
    expect(normalizePaneWorkspace(undefined)).toBe(".");
  });

  it("builds a contained terminal pane URL", () => {
    expect(terminalPaneUrl(ORIGIN, "projects/example-record-35"))
      .toBe(`${ORIGIN}/terminal/window?paneWindow=1&workspace=projects%2Fexample-record-35`);
    expect(terminalPaneUrl(ORIGIN, "../outside"))
      .toBe(`${ORIGIN}/terminal/window?paneWindow=1&workspace=.`);
  });

  it("sizes each pane kind for what it actually shows", () => {
    expect(paneWindowSize("chat", false)).toEqual(compactChatSize(false));
    expect(paneWindowSize("chat", true)).toEqual(compactChatSize(true));
    // A terminal collapsed to a one-line bar would show nothing useful, so it keeps one size.
    expect(paneWindowSize("terminal", true)).toEqual(paneWindowSize("terminal", false));
    expect(paneWindowSize("terminal").width).toBeGreaterThan(compactChatSize(false).width);
  });

  it("defaults an unknown pane kind to chat", () => {
    expect(normalizePaneKind("terminal")).toBe("terminal");
    expect(normalizePaneKind("chat")).toBe("chat");
    expect(normalizePaneKind("settings")).toBe("chat");
    expect(normalizePaneKind(undefined)).toBe("chat");
  });

  it("allows dedicated and contained lead chat routes in new windows", () => {
    expect(normalizeChatWindowPath("/")).toBe("/");
    expect(normalizeChatWindowPath("/personal")).toBe("/personal");
    expect(normalizeChatWindowPath("/leads")).toBe("/leads");
    expect(normalizeChatWindowPath("/permit-qaqc")).toBe("/permit-qaqc");
    expect(normalizeChatWindowPath("/leads/demo-lead/chat")).toBe("/leads/demo-lead/chat");
    expect(normalizeChatWindowPath("/leads/../settings/chat")).toBe("/");
    expect(normalizeChatWindowPath("/projects/demo")).toBe("/");
    expect(normalizeChatWindowPath("https://example.com")).toBe("/");
  });

  it("restores only a launch slug that exists in local project data", () => {
    const available = new Set(["example-record-35"]);
    const valid = createProjectContextTracker({
      trustedOrigin: ORIGIN,
      projectExists: (slug: string) => available.has(slug),
      initialSlug: "example-record-35",
    });
    const missing = createProjectContextTracker({
      trustedOrigin: ORIGIN,
      projectExists: (slug: string) => available.has(slug),
      initialSlug: "missing-project",
    });

    expect(valid.chatUrl()).toBe(`${ORIGIN}/?project=example-record-35`);
    expect(missing.chatUrl()).toBe(`${ORIGIN}/`);
  });

  it("tracks exact trusted project navigation and ignores untrusted origins", () => {
    const tracker = createProjectContextTracker({
      trustedOrigin: ORIGIN,
      projectExists: (slug: string) => slug === "example-project-59",
    });

    tracker.observeTrustedNavigation(`${ORIGIN}/projects/example-project-59/schedule`);
    expect(tracker.current()).toBe("example-project-59");

    tracker.observeTrustedNavigation("https://example.com/?project=example-record-35");
    expect(tracker.current()).toBe("example-project-59");
  });

  it("accepts an exact trusted project query and rejects traversal", () => {
    const tracker = createProjectContextTracker({
      trustedOrigin: ORIGIN,
      projectExists: (slug: string) => slug === "example-record-35",
    });

    tracker.observeTrustedNavigation(`${ORIGIN}/?project=example-record-35`);
    expect(tracker.current()).toBe("example-record-35");
    tracker.observeTrustedNavigation(`${ORIGIN}/?project=..%2Foutside`);
    expect(tracker.current()).toBe("example-record-35");
  });

  it("tracks trusted agent cwd and returns root when the project disappears", () => {
    const available = new Set(["example-record-35"]);
    const tracker = createProjectContextTracker({
      trustedOrigin: ORIGIN,
      projectExists: (slug: string) => available.has(slug),
    });

    tracker.observeProjectCwd("projects\\example-record-35");
    expect(tracker.chatUrl()).toBe(`${ORIGIN}/?project=example-record-35`);
    available.clear();
    expect(tracker.chatUrl()).toBe(`${ORIGIN}/`);
  });

  it("does not interpret repository root or nested paths as project cwd", () => {
    expect(projectSlugFromCwd(".")).toBeNull();
    expect(projectSlugFromCwd("projects/demo/nested")).toBeNull();
    expect(projectSlugFromCwd("projects/demo")).toBe("demo");
  });
});

describe("desktop lifecycle cleanup", () => {
  it("hides on Windows but uses the native close lifecycle on macOS", () => {
    expect(mainWindowCloseAction(false, "win32")).toBe("hide");
    expect(mainWindowCloseAction(true, "win32")).toBe("close");
    expect(mainWindowCloseAction(false, "darwin")).toBe("close");
  });

  it("runs shutdown exactly once", () => {
    const cleanup = vi.fn();
    const shutdown = createIdempotentCleanup(cleanup);

    expect(shutdown()).toBe(true);
    expect(shutdown()).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
