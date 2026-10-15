const PROJECT_CHAT_SHORTCUT = "CommandOrControl+Shift+Space";
const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CHAT_WINDOW_PATHS = new Set(["/", "/personal", "/leads", "/permit-qaqc"]);
const LEAD_CHAT_PATH = /^\/leads\/[a-z0-9][a-z0-9-]*\/chat$/;

function normalizeChatWindowPath(value) {
  return typeof value === "string" && (CHAT_WINDOW_PATHS.has(value) || LEAD_CHAT_PATH.test(value)) ? value : "/";
}

function projectSlugFromCwd(value) {
  const match = /^projects\/([^/]+)\/?$/.exec(String(value || "").replace(/\\/g, "/"));
  return match ? match[1] : null;
}

function availableProjectSlug(candidate, projectExists) {
  if (typeof candidate !== "string" || !PROJECT_SLUG_PATTERN.test(candidate)) return null;
  try {
    return projectExists(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function candidateFromTrustedUrl(targetUrl, trustedOrigin) {
  try {
    const url = new URL(targetUrl);
    if (url.origin !== trustedOrigin) return null;
    if (url.searchParams.has("project")) return url.searchParams.get("project");
    const match = /^\/projects\/([^/]+)(?:\/|$)/.exec(url.pathname);
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function createProjectContextTracker({ trustedOrigin, projectExists, initialSlug = null }) {
  let lastProjectSlug = availableProjectSlug(initialSlug, projectExists);

  function remember(candidate) {
    const validated = availableProjectSlug(candidate, projectExists);
    if (validated) lastProjectSlug = validated;
    return validated;
  }

  function current() {
    lastProjectSlug = availableProjectSlug(lastProjectSlug, projectExists);
    return lastProjectSlug;
  }

  return {
    remember,
    observeTrustedNavigation(targetUrl) {
      remember(candidateFromTrustedUrl(targetUrl, trustedOrigin));
      return current();
    },
    observeProjectCwd(cwd) {
      remember(projectSlugFromCwd(cwd));
      return current();
    },
    current,
    chatUrl() {
      const url = new URL("/", trustedOrigin);
      const slug = current();
      if (slug) url.searchParams.set("project", slug);
      return url.toString();
    },
  };
}

function mainWindowCloseAction(isQuitting, platform = process.platform) {
  return isQuitting || platform === "darwin" ? "close" : "hide";
}

function compactChatUrl(trustedOrigin, projectSlug = null, windowId = "compact", scope = "firm") {
  // Both are pane-only routes registered in isPaneWindowRoute (components/workspacePanes.ts).
  // A card must never be pointed at an ordinary page: the app header would cover its titlebar
  // and the route wrapper would collapse its fixed surface.
  const url = new URL(scope === "personal" ? "/personal/window" : "/chat", trustedOrigin);
  url.searchParams.set("compactChat", "1");
  url.searchParams.set("chatWindow", windowId);
  if (projectSlug && PROJECT_SLUG_PATTERN.test(projectSlug)) url.searchParams.set("project", projectSlug);
  return url.toString();
}

function compactChatSize(collapsed) {
  return collapsed
    ? { width: 420, height: 104, minWidth: 360, minHeight: 96 }
    : { width: 480, height: 680, minWidth: 360, minHeight: 420 };
}

/** Relative workspaces the terminal IPC already knows how to resolve (see resolveProjectCwd
 * in electron/desktopMain.js). "." is the firm-wide workspace. */
const PANE_WORKSPACE_PATTERN = /^(?:projects|leads|permit-qaqc)\/[a-z0-9][a-z0-9-]*$/;

/**
 * A terminal pane window addresses its shell by the same relative cwd the terminal IPC
 * validates, so an unrecognized value falls back to the firm-wide workspace rather than
 * being forwarded to a real shell.
 */
function normalizePaneWorkspace(value) {
  const workspace = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return PANE_WORKSPACE_PATTERN.test(workspace) ? workspace : ".";
}

function normalizeTerminalSession(value) {
  return /^[1-4]$/.test(String(value ?? "")) ? String(value) : "1";
}

function terminalPaneKey(workspace, session) {
  return `terminal:${normalizePaneWorkspace(workspace)}:${normalizeTerminalSession(session)}`;
}

function terminalPaneUrl(trustedOrigin, workspace = ".", session = "1") {
  const url = new URL("/terminal/window", trustedOrigin);
  url.searchParams.set("paneWindow", "1");
  url.searchParams.set("workspace", normalizePaneWorkspace(workspace));
  if (normalizeTerminalSession(session) !== "1") url.searchParams.set("session", normalizeTerminalSession(session));
  return url.toString();
}

/**
 * Pop-out card windows for one Mi surface each. Chat can collapse to a one-line bar;
 * a terminal collapsed to a bar would show nothing useful, so it keeps one size.
 */
function paneWindowSize(kind, collapsed = false) {
  if (kind === "terminal") return { width: 860, height: 560, minWidth: 480, minHeight: 320 };
  return compactChatSize(collapsed);
}

function normalizePaneKind(value) {
  return value === "terminal" ? "terminal" : "chat";
}

function createIdempotentCleanup(cleanup) {
  let completed = false;
  return function runCleanup() {
    if (completed) return false;
    completed = true;
    cleanup();
    return true;
  };
}

module.exports = {
  PROJECT_CHAT_SHORTCUT,
  availableProjectSlug,
  candidateFromTrustedUrl,
  createIdempotentCleanup,
  createProjectContextTracker,
  compactChatUrl,
  compactChatSize,
  mainWindowCloseAction,
  normalizeChatWindowPath,
  normalizePaneKind,
  normalizePaneWorkspace,
  paneWindowSize,
  projectSlugFromCwd,
  terminalPaneUrl,
  terminalPaneKey,
  normalizeTerminalSession,
};
