const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain: electronIpcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
  utilityProcess,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const pty = require("node-pty");
const { load: loadYaml } = require("js-yaml");
const { getEngine } = require("./agentEngines");
const { addAttachmentContext, prepareAgentAttachments } = require("./agentAttachments");
const { loadAgentContext, buildAgentPrompt, buildInterviewStepPrompt } = require("./agentContext");
const { summarizeWorkspaceSharedWork } = require("./projectSharedWork");
const {
  buildPersonalAgentPrompt,
  ensurePersonalAgentWorkspace,
  loadPersonalAgentContext,
} = require("./personalAgentContext");
const {
  buildFirmScopedAgentPrompt,
  isFirmAgentScope,
} = require("./firmScopedAgentContext");
const { createTerminalManager } = require("./terminalManager");
const { createTerminalHistory } = require("./terminalHistory");
const { openTerminalLink } = require("./terminalLinks");
const { pickProposalFile } = require("./proposalFilePicker");
const { normalizeDropboxSelection } = require("./dropboxPaths");
const { validateNotionTarget, toNotionDeepLink } = require("./notionLinks");
const { createConfigStore, validTimezone } = require("./configStore");
const { agentEnvironmentForEngine, minimizedEnvironment } = require("./childEnvironment");
const { probeNotionSources, refreshProjectSnapshot, refreshScheduleSnapshot } = require("./notionSetup");
const {
  createPersonalCalendarEntry,
  listPersonalCalendars,
  validateCalendarSelection,
} = require("./personalNotionCalendar");
const { buildDiagnostics } = require("./diagnostics");
const { applyHarnessPreview, ensureProjectHarness, previewHarness } = require("./agentHarness");
const { applyFirmHarness, previewFirmHarness, resolveFirmHarnessRoot } = require("./firmHarness");
const { previewFirmDataMigration, applyFirmDataMigration, markSourceMigrated: markFirmDataMigrated } = require("./firmDataMigration");
const {
  previewPersonalDataMigration,
  applyPersonalDataMigration,
  markPersonalDataMigrated,
} = require("./personalDataMigration");
const { createAllProjectHarnessManager } = require("./allProjectHarness");
const { resolveInstalledProjectWorkspace } = require("./projectRuntime");
const { leadSlugFromCwd, resolveLeadTerminalWorkspace } = require("./leadRuntime");
const { resolveTerminalWorkspace } = require("./terminalWorkspace");
const { previewLeadHarness, applyLeadHarnessPreview, ensureLeadHarness } = require("./leadHarness");
const {
  permitQaqcSlugFromCwd,
  resolvePermitQaqcTerminalWorkspace,
} = require("./permitQaqcRuntime");
const {
  previewPermitQaqcHarness,
  applyPermitQaqcHarnessPreview,
  ensurePermitQaqcHarness,
} = require("./permitQaqcHarness");
const { containedSharedDataRoot, resolveRuntimeDataRoot } = require("./runtimeDataRoot");
const { ensureEditableMiConfig } = require("./editableMiConfig");
const { inspectSharedData, findSharedDataCandidates } = require("./sharedDataInspection");
const { detectOptionalTools: detectTools, testCliConnection, validToolCommand } = require("./toolDetection");
const { testOpenAiConnection } = require("./openAiConnection");
const { testAnthropicConnection } = require("./anthropicConnection");
const { createApplicationMenuTemplate } = require("./desktopMenu");
const { applyZoomAction, installZoomControls } = require("./desktopZoom");
const {
  initializeLaunchAtLogin,
  readLaunchAtLogin,
  setLaunchAtLogin,
} = require("./launchAtLogin");
const { desktopPort, nextDevArgs } = require("./nextDev");
const { waitForServer: probeServer } = require("./serverProbe");
const {
  PROJECT_CHAT_SHORTCUT,
  compactChatUrl,
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
  normalizeTerminalSession,
} = require("./desktopChatLifecycle");

const PORT = desktopPort({ packaged: app.isPackaged, override: process.env.STUDIO_ELECTRON_PORT });
const DEV_ROOT = path.join(__dirname, "..");
const APP_ROOT = app.isPackaged ? app.getAppPath() : DEV_ROOT;
const PACKAGED_RUNTIME_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "app-runtime")
  : APP_ROOT;
const APP_ICON = path.join(APP_ROOT, "assets", "mi-icon.png");
const TEMPLATE_PATH = path.join(APP_ROOT, "installer", "agent-harness", "common-rules.md");
const FIRM_TEMPLATE_PATH = path.join(APP_ROOT, "installer", "agent-harness", "firm-common-rules.md");
const PERMIT_QAQC_TEMPLATE_PATH = path.join(APP_ROOT, "installer", "agent-harness", "permit-qaqc-common-rules.md");
const LEAD_TEMPLATE_PATH = path.join(APP_ROOT, "installer", "agent-harness", "lead-common-rules.md");
const MI_CONFIG_TEMPLATE_PATH = path.join(APP_ROOT, "mi.config.yaml");
const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`;
// Per-launch bearer capability shared only with Mi's local server and project terminal.
// Chat subprocesses pass through childEnvironment's allowlist and never inherit it.
const TERMINAL_CAPABILITY_SECRET = crypto.randomBytes(32).toString("hex");

if (process.env.MI_USER_DATA_DIR) {
  fs.mkdirSync(process.env.MI_USER_DATA_DIR, { recursive: true });
  app.setPath("userData", path.resolve(process.env.MI_USER_DATA_DIR));
}

// A release smoke test has its own user-data directory and loopback port, so it
// must be able to run beside an already-open installed Mi instance.
const hasSingleInstanceLock = Boolean(process.env.MI_SMOKE_REPORT_PATH) || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (!app.isPackaged) {
  try {
    process.loadEnvFile(path.join(DEV_ROOT, ".env.local"));
  } catch {
    // Legacy development configuration is optional.
  }
}

let nextProcess = null;
let nextProcessFailure = null;
let mainWindow = null;
/**
 * Pop-out "pane" windows: frameless, always-on-top cards holding exactly one Mi surface --
 * "chat" (Talk to Mi) or "terminal". One reused window per kind, re-pointed at a new
 * project/workspace rather than stacking a second card, so the pinned overlay never
 * multiplies behind the user's back. paneTargets remembers what each one is pointed at so
 * the in-app view of the same surface can step aside (see broadcastPaneState).
 */
const paneWindows = new Map();
const paneTargets = new Map();
const chatWindows = new Set();
let tray = null;
let shortcutRegistered = false;
let isQuitting = false;
let desktopReady = false;
let configStore = null;
let editableMiConfigPath = null;
let runtimeDataRoot = null;
let projectContextTracker = null;
let latestNotionHealth = null;
let latestCliStatus = null;
let notionSyncTimer = null;
const activeAgentRequests = new Map();
const harnessPreviews = new Map();
const permitQaqcHarnessPreviews = new Map();
const leadHarnessPreviews = new Map();
const allProjectHarnessManager = createAllProjectHarnessManager();

/** Every window Mi itself opened, in a single list -- the trust check, terminal output
 * broadcast, and pane-state broadcast all mean the same set. */
function trustedWindows() {
  return [mainWindow, ...paneWindows.values(), ...chatWindows].filter(
    (window) => window && !window.isDestroyed(),
  );
}

function broadcastToTrustedWindows(channel, payload) {
  for (const window of trustedWindows()) {
    try {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    } catch { /* A window can close between the liveness check and delivery. */ }
  }
}

function trustedIpcSender(event) {
  const trustedWindow = trustedWindows().some((window) => event.sender === window.webContents);
  if (!trustedWindow) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  try {
    return new URL(senderUrl).origin === LOCAL_ORIGIN;
  } catch {
    return false;
  }
}

const ipcMain = {
  handle(channel, listener) {
    electronIpcMain.handle(channel, (event, ...args) => {
      if (!trustedIpcSender(event)) throw new Error("Rejected IPC from an untrusted renderer.");
      return listener(event, ...args);
    });
  },
  on(channel, listener) {
    electronIpcMain.on(channel, (event, ...args) => {
      if (trustedIpcSender(event)) listener(event, ...args);
    });
  },
};

function secureStorageAdapter() {
  return {
    async isAvailable() {
      if (typeof safeStorage.isAsyncEncryptionAvailable === "function") {
        return safeStorage.isAsyncEncryptionAvailable();
      }
      return safeStorage.isEncryptionAvailable();
    },
    async encrypt(value) {
      if (typeof safeStorage.encryptStringAsync === "function") return safeStorage.encryptStringAsync(value);
      return safeStorage.encryptString(value);
    },
    async decrypt(value) {
      if (typeof safeStorage.decryptStringAsync === "function") {
        const decrypted = await safeStorage.decryptStringAsync(value);
        return { plainText: decrypted.result, shouldReEncrypt: decrypted.shouldReEncrypt };
      }
      return { plainText: safeStorage.decryptString(value), shouldReEncrypt: false };
    },
  };
}

function waitForServer(url, timeoutMs = 60_000) {
  return probeServer(url, { timeoutMs, failure: () => nextProcessFailure });
}

async function trustedServerEnvironment() {
  const settings = configStore.getSettings();
  const token = await configStore.getNotionToken();
  const claudeSubscriptionToken = await configStore.getClaudeSubscriptionToken();
  const claudeApiKey = await configStore.getClaudeApiKey();
  return minimizedEnvironment(process.env, {
    NODE_ENV: "production",
    MI_DESKTOP_PACKAGED: "1",
    PORT,
    HOSTNAME: "127.0.0.1",
    MI_CONTENT_ROOT: runtimeDataRoot,
    MI_CONFIG_PATH: editableMiConfigPath,
    // The packaged server is an Electron utilityProcess, so PDF.js cannot detect Node and
    // needs the worker's exact location. See resolveWorkerSource in electron/pdfExtraction.js.
    MI_PDF_WORKER_SRC: path.join(
      PACKAGED_RUNTIME_ROOT, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs",
    ),
    MI_PERSONAL_DATA_ROOT: settings.personalDataRootOverride || path.join(configStore.dataRoot, "personal"),
    MI_CHAT_DATA_ROOT: path.join(configStore.dataRoot, "chat"),
    DROPBOX_ROOT: settings.dropboxRoot,
    DROPBOX_FIRM_DATA_PATH: settings.dropboxFirmDataMigrated ? settings.dropboxFirmDataPath : null,
    MI_CODE_LIBRARY_ROOT: settings.codeLibraryRoot,
    MI_TIMEZONE: settings.timezone,
    NOTION_PROJECTS_DATA_SOURCE_ID: settings.notionProjectsDataSourceId,
    NOTION_SCHEDULE_DATA_SOURCE_ID: settings.notionScheduleDataSourceId,
    MI_AGENT_CONTEXT_MAX_BYTES: settings.agentContextMaxBytes,
    MI_TERMINAL_CAPABILITY_SECRET: TERMINAL_CAPABILITY_SECRET,
    MI_CODEX_BIN: settings.codexBin,
    MI_CLAUDE_BIN: settings.claudeBin,
    // Absent means default-on; see app/api/local-fetch/route.ts.
    MI_LOCAL_FETCH: process.env.MI_LOCAL_FETCH,
    MI_REMOTE_ACCESS: process.env.MI_REMOTE_ACCESS,
    MI_REMOTE_HOSTNAME: process.env.MI_REMOTE_HOSTNAME,
    MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: process.env.MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    MI_CLOUDFLARE_ACCESS_AUD: process.env.MI_CLOUDFLARE_ACCESS_AUD,
    MI_REMOTE_ALLOWED_EMAILS: process.env.MI_REMOTE_ALLOWED_EMAILS,
    MI_REMOTE_PROJECT_GRANTS: process.env.MI_REMOTE_PROJECT_GRANTS,
    NOTION_API_KEY: token,
    CLAUDE_CODE_OAUTH_TOKEN: claudeSubscriptionToken,
    ANTHROPIC_API_KEY: claudeApiKey,
  });
}

async function startNextServer() {
  nextProcessFailure = null;
  if (app.isPackaged) {
    // Next's standalone entry point changes into its own directory, so it must
    // be a real filesystem resource rather than a virtual path inside app.asar.
    const serverPath = path.join(PACKAGED_RUNTIME_ROOT, "server.js");
    nextProcess = utilityProcess.fork(serverPath, [], {
      cwd: runtimeDataRoot,
      env: await trustedServerEnvironment(),
      stdout: true,
      stderr: true,
      serviceName: "Mi local application server",
    });
    nextProcess.stdout?.on("data", (data) => console.log(data.toString("utf8").trimEnd()));
    nextProcess.stderr?.on("data", (data) => console.error(data.toString("utf8").trimEnd()));
    nextProcess.on("exit", (code) => {
      if (code !== 0) {
        nextProcessFailure = new Error(`Mi local server exited during startup (code ${code}).`);
      }
    });
  } else {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    nextProcess = spawn(npmCommand, nextDevArgs(PORT), {
      cwd: DEV_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: minimizedEnvironment(process.env, {
        NODE_ENV: "development",
        MI_CONTENT_ROOT: DEV_ROOT,
        MI_PERSONAL_DATA_ROOT: configStore.getSettings().personalDataRootOverride
          || path.join(configStore.dataRoot, "personal"),
        MI_CHAT_DATA_ROOT: path.join(configStore.dataRoot, "chat"),
        DROPBOX_ROOT: configStore.getSettings().dropboxRoot || process.env.DROPBOX_ROOT,
        DROPBOX_FIRM_DATA_PATH: configStore.getSettings().dropboxFirmDataMigrated
          ? configStore.getSettings().dropboxFirmDataPath
          : process.env.DROPBOX_FIRM_DATA_PATH,
        MI_CODE_LIBRARY_ROOT: configStore.getSettings().codeLibraryRoot || process.env.MI_CODE_LIBRARY_ROOT,
        MI_TIMEZONE: configStore.getSettings().timezone,
        MI_CODEX_BIN: configStore.getSettings().codexBin || process.env.MI_CODEX_BIN,
        MI_CLAUDE_BIN: configStore.getSettings().claudeBin || process.env.MI_CLAUDE_BIN,
        MI_TERMINAL_CAPABILITY_SECRET: TERMINAL_CAPABILITY_SECRET,
        MI_LOCAL_FETCH: process.env.MI_LOCAL_FETCH,
        MI_REMOTE_ACCESS: process.env.MI_REMOTE_ACCESS,
        MI_REMOTE_HOSTNAME: process.env.MI_REMOTE_HOSTNAME,
        MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: process.env.MI_CLOUDFLARE_ACCESS_TEAM_DOMAIN,
        MI_CLOUDFLARE_ACCESS_AUD: process.env.MI_CLOUDFLARE_ACCESS_AUD,
        MI_REMOTE_ALLOWED_EMAILS: process.env.MI_REMOTE_ALLOWED_EMAILS,
        MI_REMOTE_PROJECT_GRANTS: process.env.MI_REMOTE_PROJECT_GRANTS,
        NOTION_API_KEY: await configStore.getNotionToken() || process.env.NOTION_API_KEY,
        CLAUDE_CODE_OAUTH_TOKEN:
          await configStore.getClaudeSubscriptionToken()
          || process.env.CLAUDE_CODE_OAUTH_TOKEN,
        ANTHROPIC_API_KEY:
          await configStore.getClaudeApiKey()
          || process.env.ANTHROPIC_API_KEY,
      }),
    });
  }
}

function stopNextServer() {
  if (!nextProcess) return;
  if (!app.isPackaged && process.platform === "win32" && nextProcess.pid) {
    // npm.cmd owns another cmd/node tree. Killing only its wrapper leaves the
    // dev server compiling into .next after Mi exits and corrupts the next run.
    spawnSync("taskkill.exe", ["/PID", String(nextProcess.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore", timeout: 5000, env: minimizedEnvironment(process.env),
    });
  }
  if (typeof nextProcess.kill === "function") nextProcess.kill();
  nextProcess = null;
}

async function restartApplicationServer() {
  // Resolve before tearing anything down. Saving a Dropbox root now restarts the server, and
  // this throws whenever the shared Mi data folder isn't reachable underneath the new root --
  // routine on a second computer whose Dropbox sits elsewhere. Stopping first would turn that
  // into a dead server with no working UI left to correct the path from, so let it surface as
  // a settings error while the running server stays up.
  const nextDataRoot = configuredRuntimeDataRoot();
  stopNextServer();
  runtimeDataRoot = nextDataRoot;
  await startNextServer();
  await waitForServer(`http://127.0.0.1:${PORT}`);
  mainWindow?.reload();
  for (const window of paneWindows.values()) {
    if (!window.isDestroyed()) window.reload();
  }
}

function configuredRuntimeDataRoot() {
  const settings = configStore.getSettings();
  return resolveRuntimeDataRoot({
    packaged: app.isPackaged,
    developmentRoot: DEV_ROOT,
    localDataRoot: configStore.dataRoot,
    dropboxRoot: settings.dropboxRoot,
    sharedRelativePath: settings.dropboxFirmDataPath,
    sharedDataRootEnabled: settings.sharedDataRootEnabled,
  });
}

function readProject(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || "")) throw new Error("Invalid project slug.");
  const file = path.join(runtimeDataRoot, "projects", slug, "project.yaml");
  const relative = path.relative(path.join(runtimeDataRoot, "projects"), file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file)) {
    throw new Error("Project is not available on this computer.");
  }
  return loadYaml(fs.readFileSync(file, "utf8"));
}


/**
 * Runs a workspace generator before the matching terminal resolver checks its gate. A
 * generation failure is returned rather than thrown so the resolver still gets to speak: its
 * diagnosis (unlinked Dropbox folder, missing record, escaped path) is the more useful one, and
 * only when the resolver also fails does the generation error become the better explanation.
 */
function generateWorkspaceBeforeLaunch(generate, resolve) {
  let generationError = null;
  try {
    generate();
  } catch (error) {
    generationError = error instanceof Error ? error : new Error(String(error));
  }
  try {
    return resolve();
  } catch (error) {
    throw generationError || error;
  }
}

function resolveProjectCwd(relativeCwd) {
  const slug = projectSlugFromCwd(relativeCwd);
  const leadSlug = leadSlugFromCwd(relativeCwd);
  if (leadSlug) {
    const settings = configStore.getSettings();
    return generateWorkspaceBeforeLaunch(
      () => ensureLeadHarness({ runtimeDataRoot, settings, slug: leadSlug, templatePath: LEAD_TEMPLATE_PATH }),
      () => resolveLeadTerminalWorkspace({ runtimeDataRoot, settings, slug: leadSlug }),
    );
  }
  const permitQaqcSlug = permitQaqcSlugFromCwd(relativeCwd);
  if (permitQaqcSlug) {
    const settings = configStore.getSettings();
    return generateWorkspaceBeforeLaunch(
      () => ensurePermitQaqcHarness({
        runtimeDataRoot,
        settings,
        slug: permitQaqcSlug,
        templatePath: PERMIT_QAQC_TEMPLATE_PATH,
      }),
      () => resolvePermitQaqcTerminalWorkspace({ runtimeDataRoot, settings, slug: permitQaqcSlug }),
    );
  }
  if (!app.isPackaged) {
    const target = path.resolve(DEV_ROOT, relativeCwd || ".");
    if (target !== DEV_ROOT && !target.startsWith(`${DEV_ROOT}${path.sep}`)) throw new Error("Working directory escapes Mi.");
    return target;
  }
  if (!slug) {
    // No project selected -- the firm-wide holistic planning chat. Requires the shared Mi
    // data folder to already be confirmed (dropboxFirmDataPath) and its workspace to have
    // been generated at least once by the background sync (see refreshFirmHarness).
    const settings = configStore.getSettings();
    if (!settings.dropboxRoot || !settings.dropboxFirmDataPath) {
      throw new Error("Confirm the shared Mi data folder in Settings before opening firm-wide chat.");
    }
    const { harnessRoot } = resolveFirmHarnessRoot(settings.dropboxRoot, settings.dropboxFirmDataPath);
    if (!fs.existsSync(path.join(harnessRoot, "AGENTS.md"))) {
      throw new Error("The firm-wide chat workspace hasn't been generated yet. It refreshes automatically in the background shortly after Notion sync is confirmed -- try again in a moment.");
    }
    return harnessRoot;
  }
  const project = readProject(slug);
  const settings = configStore.getSettings();
  // No dropbox_path is a normal state -- it is human-confirmed and never guessed --
  // so the agent falls back to a workspace under the project's own record folder
  // rather than being unavailable. Only a *broken* Dropbox link is an error.
  if (project.dropbox_path && !settings.dropboxRoot) {
    throw new Error("Select a local STUDIO Dropbox root first.");
  }
  const localProjectRoot = path.join(runtimeDataRoot, "projects", slug);
  return generateWorkspaceBeforeLaunch(
    () => ensureProjectHarness(projectHarnessOptions({ slug, metadata: project, settings })),
    () => resolveInstalledProjectWorkspace({
      dropboxRoot: settings.dropboxRoot,
      dropboxPath: project.dropbox_path,
      localProjectRoot,
    }),
  );
}

function agentEnvironment() {
  return minimizedEnvironment(process.env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    MI_LOCAL_ORIGIN: LOCAL_ORIGIN,
    MI_AGENT_MODE: "terminal-agent",
  });
}

const terminalManager = createTerminalManager({
  pty,
  history: createTerminalHistory({
    directory: () => path.join(app.getPath("userData"), "terminal-history"),
    secureStorage: safeStorage,
  }),
  resolveCwd: resolveProjectCwd,
  env: agentEnvironment(),
  sessionEnvironment({ cwd }) {
    const match = /^projects\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(String(cwd).replaceAll("\\", "/"));
    if (!match) return {};
    return {
      MI_AGENT_PROJECT_SLUG: match[1],
      MI_TERMINAL_CAPABILITY_TOKEN: crypto
        .createHmac("sha256", TERMINAL_CAPABILITY_SECRET)
        .update(match[1])
        .digest("hex"),
    };
  },
  // Every Mi window, not just the main one: a terminal can now be attached from a pop-out
  // pane window or an extra chat window, and a PTY whose output only reached mainWindow
  // would look permanently frozen there. Renderers already ignore ids they didn't open.
  send(channel, payload) {
    broadcastToTrustedWindows(channel, payload);
  },
});

function setupTerminalIPC() {
  ipcMain.handle("terminal:open-link", (_event, target) => openTerminalLink(target, shell));
  ipcMain.handle("terminal:resolve-workspace", (_event, workspace) => currentTerminalWorkspace(workspace));
  ipcMain.handle("terminal:create", (_event, options) => {
    if (currentTerminalWorkspace(options.cwd) !== options.cwd) {
      throw new Error("This terminal now belongs to a linked project. Reopen the terminal to use its current workspace.");
    }
    return terminalManager.create(options);
  });
  ipcMain.handle("terminal:pick-proposal-file", async (_event, { projectSlug }) => {
    if (typeof projectSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)) {
      throw new Error("Choose a valid project before loading proposals.");
    }
    const workspace = resolveProjectCwd(`projects/${projectSlug}`);
    const scratchpad = path.join(workspace, "scratchpad");
    return pickProposalFile({
      dialog,
      parent: mainWindow,
      defaultPath: isExistingDirectory(scratchpad) ? scratchpad : workspace,
    });
  });
  ipcMain.on("terminal:write", (_event, { id, data }) => terminalManager.write(id, data));
  ipcMain.on("terminal:resize", (_event, { id, cols, rows }) => terminalManager.resize(id, cols, rows));
  ipcMain.on("terminal:kill", (_event, { id }) => terminalManager.kill(id));
}

async function detectOptionalTools() {
  const settings = configStore.getSettings();
  latestCliStatus = await detectTools({
    codexCommand: settings.codexBin || "codex",
    claudeCommand: settings.claudeBin || "claude",
    env: agentEnvironment(),
  });
  return latestCliStatus;
}

/** fs.statSync throws ENOENT rather than returning false, and a raw ENOENT surfaced in the
 * Settings UI names no field and offers no next step. */
function isExistingDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** True when a save actually moves a directory setting, comparing the way configStore stores
 * it (path.resolve'd) so a trailing separator alone doesn't read as a change. */
function changedDirectory(next, current) {
  if (!next) return false;
  return !current || path.resolve(next) !== path.resolve(current);
}

function projectHarnessOptions({ slug, metadata, settings }) {
  return {
    dropboxRoot: settings.dropboxRoot,
    dropboxPath: metadata.dropbox_path,
    timezone: settings.timezone,
    templatePath: TEMPLATE_PATH,
    projectSourceDir: path.join(runtimeDataRoot, "projects", slug),
    skipProjectMirror: metadata.content_location === "dropbox",
    dataRoot: configStore.dataRoot,
    notionAttendeeName: settings.notionAttendeeName,
    project: {
      name: metadata.name,
      slug,
      notionPageId: metadata.notion_page_id,
    },
  };
}

function desktopPublicConfig() {
  const config = configStore.getPublicConfig();
  const startup = readLaunchAtLogin(app, { fallbackEnabled: config.launchAtLogin });
  return {
    ...config,
    launchAtLogin: startup.enabled,
    launchAtLoginSupported: startup.supported,
    miConfigPath: editableMiConfigPath,
  };
}

function notionScheduleCreateAllowed() {
  try {
    const config = loadYaml(fs.readFileSync(editableMiConfigPath, "utf8"));
    return config?.notion?.allowed_write_fields?.schedule?.includes?.("create") === true;
  } catch {
    return false;
  }
}

function pickDirectory(title, defaultPath) {
  return dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath,
    properties: ["openDirectory"],
  }).then((result) => (
    result.canceled || !result.filePaths[0]
      ? { canceled: true }
      : { path: path.resolve(result.filePaths[0]) }
  ));
}

function setupConfigurationIPC() {
  ipcMain.handle("setup:get", () => ({
    version: app.getVersion(),
    config: desktopPublicConfig(),
    connectionTests: configStore.getConnectionTests(),
  }));
  ipcMain.handle("setup:reveal-mi-config", () => {
    shell.showItemInFolder(editableMiConfigPath);
    return { path: editableMiConfigPath };
  });
  ipcMain.handle("setup:pick-dropbox-root", () => pickDirectory("Choose the local STUDIO Dropbox root"));
  ipcMain.handle("setup:pick-code-library-root", () => pickDirectory("Choose the optional local code-library root"));
  ipcMain.handle("setup:pick-personal-data-root", () =>
    pickDirectory("Choose where Mi stores your personal journal, thoughts, and plans"));
  ipcMain.handle("setup:pick-legacy-env", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a legacy .env.local",
      properties: ["openFile"],
      filters: [{ name: "Environment files", extensions: ["local", "env", "txt"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return configStore.previewLegacyEnv(result.filePaths[0]);
  });
  ipcMain.handle("setup:import-legacy", (_event, { path: envPath, confirmed }) =>
    configStore.importLegacyEnv(envPath, { confirmed }));
  ipcMain.handle("setup:save-settings", (_event, patch) => {
    const allowed = {
      dropboxRoot: patch.dropboxRoot,
      codeLibraryRoot: patch.codeLibraryRoot,
      timezone: patch.timezone,
      notionProjectsDataSourceId: patch.notionProjectsDataSourceId,
      notionScheduleDataSourceId: patch.notionScheduleDataSourceId,
      codexBin: patch.codexBin,
      claudeBin: patch.claudeBin,
      agentContextMaxBytes: patch.agentContextMaxBytes,
      dropboxFirmDataPath: patch.dropboxFirmDataPath,
      terminalPanelEnabled: patch.terminalPanelEnabled,
      launchAtLogin: patch.launchAtLogin === undefined
        ? configStore.getSettings().launchAtLogin
        : patch.launchAtLogin === true,
      notionAttendeeName: patch.notionAttendeeName,
      // Absent means "leave as is", not "turn off": the onboarding screen saves a narrower
      // patch than Settings does, and it must not silently drop a computer back to its own
      // empty local data.
      sharedDataRootEnabled: patch.sharedDataRootEnabled === undefined
        ? configStore.getSettings().sharedDataRootEnabled
        : patch.sharedDataRootEnabled === true,
    };
    if (!validTimezone(allowed.timezone)) throw new Error("Select a valid IANA timezone.");
    // Only what this save actually changes has to be reachable. A path that has since gone
    // missing must never block correcting a different one: when someone's Dropbox folder is
    // renamed, their codeLibraryRoot underneath it goes stale too, and validating that
    // untouched field would reject the very save that fixes the root.
    const current = configStore.getSettings();
    if (changedDirectory(allowed.dropboxRoot, current.dropboxRoot) && !isExistingDirectory(allowed.dropboxRoot)) {
      throw new Error("Dropbox root must be an existing directory.");
    }
    if (changedDirectory(allowed.codeLibraryRoot, current.codeLibraryRoot) && !isExistingDirectory(allowed.codeLibraryRoot)) {
      throw new Error("Code-library root must be an existing directory.");
    }
    // Each computer points at the same shared folder through its own absolute Dropbox root, so
    // this must be reachable here before it becomes this machine's data source -- otherwise the
    // save persists and the restart below has nothing to serve.
    if (allowed.sharedDataRootEnabled) {
      if (!allowed.dropboxRoot || !allowed.dropboxFirmDataPath) {
        throw new Error("Choose this computer's Dropbox root and the shared Mi data folder before using it as the data source.");
      }
      containedSharedDataRoot(allowed.dropboxRoot, allowed.dropboxFirmDataPath);
    }
    if (allowed.codexBin && !validToolCommand(allowed.codexBin)) throw new Error("Invalid Codex command.");
    if (allowed.claudeBin && !validToolCommand(allowed.claudeBin)) throw new Error("Invalid Claude command.");
    const { launchAtLogin, ...persistedSettings } = allowed;
    configStore.updateSettings(persistedSettings);
    if (patch.codexBin !== undefined && allowed.codexBin !== current.codexBin) {
      configStore.clearConnectionTest("codex-cli");
    }
    if (patch.claudeBin !== undefined && allowed.claudeBin !== current.claudeBin) {
      configStore.clearConnectionTest("claude-cli");
    }
    if (patch.launchAtLogin !== undefined) {
      const startup = setLaunchAtLogin(app, launchAtLogin);
      configStore.updateSettings({
        launchAtLogin: startup.enabled,
        launchAtLoginConfigured: startup.supported
          ? true
          : configStore.getSettings().launchAtLoginConfigured,
      });
    }
    // Fire-and-forget: get the firm-wide chat workspace ready promptly after confirming the
    // shared Mi data folder, rather than waiting up to notionSyncIntervalMinutes for the
    // next background sync to generate it.
    if (allowed.dropboxFirmDataPath) void refreshFirmHarness();
    return desktopPublicConfig();
  });
  ipcMain.handle("setup:set-token", (_event, { token }) => configStore.setNotionToken(token));
  ipcMain.handle("setup:clear-token", () => configStore.clearNotionToken());
  ipcMain.handle("personal-calendar:status", () => {
    const config = configStore.getPublicConfig();
    return {
      hasToken: config.hasPersonalNotionToken,
      dataSourceId: config.personalCalendarDataSourceId,
      name: config.personalCalendarName,
      titleProperty: config.personalCalendarTitleProperty,
      dateProperty: config.personalCalendarDateProperty,
    };
  });
  ipcMain.handle("personal-calendar:set-token", (_event, { token }) =>
    configStore.setPersonalNotionToken(token));
  ipcMain.handle("personal-calendar:clear-token", () => configStore.clearPersonalNotionToken());
  ipcMain.handle("personal-calendar:discover", async () => {
    const token = await configStore.getPersonalNotionToken();
    return listPersonalCalendars({ token });
  });
  ipcMain.handle("personal-calendar:select", async (_event, selection) => {
    const token = await configStore.getPersonalNotionToken();
    const calendars = await listPersonalCalendars({ token });
    const calendar = calendars.find((candidate) => candidate.id === String(selection?.dataSourceId || "").replace(/-/g, ""));
    const patch = validateCalendarSelection(calendar, selection);
    configStore.updateSettings(patch);
    return {
      hasToken: true,
      dataSourceId: patch.personalCalendarDataSourceId,
      name: patch.personalCalendarName,
      titleProperty: patch.personalCalendarTitleProperty,
      dateProperty: patch.personalCalendarDateProperty,
    };
  });
  ipcMain.handle("personal-calendar:create", async (_event, { input, confirmed }) => {
    if (confirmed !== true) throw new Error("Explicit confirmation is required.");
    if (!notionScheduleCreateAllowed()) {
      throw new Error("Notion schedule-item creation is disabled in mi.config.yaml.");
    }
    const token = await configStore.getPersonalNotionToken();
    return createPersonalCalendarEntry({ token, settings: configStore.getSettings(), input });
  });
  ipcMain.handle("setup:set-claude-subscription-token", (_event, { token }) =>
    configStore.setClaudeSubscriptionToken(token));
  ipcMain.handle("setup:clear-claude-subscription-token", () =>
    configStore.clearClaudeSubscriptionToken());
  ipcMain.handle("setup:set-claude-api-key", (_event, { token }) =>
    configStore.setClaudeApiKey(token));
  ipcMain.handle("setup:clear-claude-api-key", () =>
    configStore.clearClaudeApiKey());
  ipcMain.handle("setup:set-openai-api-key", (_event, { token }) =>
    configStore.setOpenAiApiKey(token));
  ipcMain.handle("setup:clear-openai-api-key", () =>
    configStore.clearOpenAiApiKey());
  ipcMain.handle("setup:test-agent-connection", async (_event, { kind }) => {
    const settings = configStore.getSettings();
    let result;
    if (kind === "codex-cli") {
      result = await testCliConnection(kind, settings.codexBin || "codex", { env: agentEnvironment() });
    } else if (kind === "claude-cli") {
      const token = await configStore.getClaudeSubscriptionToken();
      result = await testCliConnection(kind, settings.claudeBin || "claude", {
        env: agentEnvironmentForEngine("claude", agentEnvironment(), token),
      });
    } else if (kind === "claude-api") {
      result = await testAnthropicConnection(await configStore.getClaudeApiKey());
    } else if (kind === "openai-api") {
      result = await testOpenAiConnection(await configStore.getOpenAiApiKey());
    } else {
      throw new Error("Unsupported AI connection test.");
    }
    return configStore.setConnectionTest(result);
  });
  ipcMain.handle("setup:test-notion", async () => {
    const settings = configStore.getSettings();
    const token = await configStore.getNotionToken();
    latestNotionHealth = await probeNotionSources({
      token,
      projectsDataSourceId: settings.notionProjectsDataSourceId,
      scheduleDataSourceId: settings.notionScheduleDataSourceId,
    });
    if (latestNotionHealth.projects.read === "available") {
      latestNotionHealth.localSnapshot = await refreshProjectSnapshot({
        token,
        projectsDataSourceId: settings.notionProjectsDataSourceId,
        dataRoot: configStore.dataRoot,
      });
    }
    if (latestNotionHealth.schedule.read === "available" && settings.notionScheduleDataSourceId) {
      latestNotionHealth.scheduleSnapshot = await refreshScheduleSnapshot({
        token,
        scheduleDataSourceId: settings.notionScheduleDataSourceId,
        dataRoot: configStore.dataRoot,
      });
    }
    return latestNotionHealth;
  });
  ipcMain.handle("setup:detect-tools", detectOptionalTools);
  ipcMain.handle("setup:finish", () => {
    const config = configStore.getPublicConfig();
    if (!config.dropboxRoot) throw new Error("Choose the local STUDIO Dropbox root.");
    // Without this a packaged Mi completes setup and then shows an empty app, because it keeps
    // reading its own local dataRoot (electron/runtimeDataRoot.js). Finishing setup in that
    // state looks exactly like a broken install, so the shared folder is part of the minimum.
    if (!config.dropboxFirmDataPath) throw new Error("Choose the firm's Mi data folder inside your Dropbox.");
    if (!config.sharedDataRootEnabled) {
      throw new Error("Turn on reading the firm's records from the shared Mi data folder.");
    }
    if (!config.hasNotionToken) throw new Error("Store the Notion integration token.");
    return configStore.updateSettings({ setupCompleted: true });
  });
  ipcMain.handle("setup:restart-server", restartApplicationServer);
  ipcMain.handle("firm-data:preview-migration", () => {
    const settings = configStore.getSettings();
    if (settings.dropboxFirmDataMigrated) {
      throw new Error("Firm-wide data has already migrated to Dropbox.");
    }
    if (!settings.dropboxRoot || !settings.dropboxFirmDataPath) {
      throw new Error("Choose a firm-wide shared data folder in Settings before migrating.");
    }
    const shared = path.join(settings.dropboxRoot, settings.dropboxFirmDataPath);
    return previewFirmDataMigration({
      clientsSourceDir: path.join(runtimeDataRoot, "clients"),
      clientsDestDir: path.join(shared, "clients"),
      leadsSourceDir: path.join(runtimeDataRoot, "leads"),
      leadsDestDir: path.join(shared, "leads"),
    });
  });
  ipcMain.handle("firm-data:apply-migration", (_event, { clientsPreview, leadsPreview, includeRelativePaths, confirmed }) => {
    if (confirmed !== true) throw new Error("Migration requires explicit confirmation.");
    const settings = configStore.getSettings();
    if (settings.dropboxFirmDataMigrated) {
      throw new Error("Firm-wide data has already migrated to Dropbox.");
    }
    const result = applyFirmDataMigration({ clientsPreview, leadsPreview, includeRelativePaths });
    if (result.migrationComplete) {
      const migratedAt = new Date().toISOString();
      markFirmDataMigrated(path.join(runtimeDataRoot, "clients"), migratedAt);
      markFirmDataMigrated(path.join(runtimeDataRoot, "leads"), migratedAt);
      configStore.updateSettings({ dropboxFirmDataMigrated: true });
    }
    return result;
  });
  ipcMain.handle("personal-data:preview-migration", (_event, { destDir }) => {
    if (typeof destDir !== "string" || !destDir.trim()) throw new Error("Choose a destination folder first.");
    const settings = configStore.getSettings();
    const sourceDir = settings.personalDataRootOverride || path.join(configStore.dataRoot, "personal");
    return previewPersonalDataMigration({ sourceDir, destDir: path.resolve(destDir) });
  });
  ipcMain.handle("personal-data:apply-migration", (_event, { preview, confirmed, confirmOverwrite }) => {
    if (confirmed !== true) throw new Error("Changing the personal data location requires explicit confirmation.");
    const result = applyPersonalDataMigration(preview, { confirmOverwrite: confirmOverwrite === true });
    if (result.status === "needs-review") return result;
    markPersonalDataMigrated(preview.sourceDir, preview.destDir, new Date().toISOString());
    const updated = configStore.updateSettings({ personalDataRootOverride: preview.destDir });
    return { ...result, personalDataRoot: updated.personalDataRoot };
  });
  ipcMain.handle("personal-data:reveal", () => {
    const settings = configStore.getSettings();
    const dir = settings.personalDataRootOverride || path.join(configStore.dataRoot, "personal");
    const target = path.join(dir, "records.json");
    shell.showItemInFolder(fs.existsSync(target) ? target : dir);
  });
  ipcMain.handle("diagnostics:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export redacted Mi diagnostics",
      defaultPath: `Mi-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const diagnostic = buildDiagnostics({
      version: app.getVersion(),
      config: configStore.getPublicConfig(),
      cliStatus: latestCliStatus,
      notionHealth: latestNotionHealth,
    });
    fs.writeFileSync(result.filePath, `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
    return { saved: true };
  });
}

function notionSyncStatus() {
  const settings = configStore.getSettings();
  return { enabled: settings.notionSyncEnabled, intervalMinutes: settings.notionSyncIntervalMinutes };
}

function clearNotionSyncTimer() {
  if (notionSyncTimer) {
    clearInterval(notionSyncTimer);
    notionSyncTimer = null;
  }
}

/**
 * Silently refreshes data/notion/project-map.json in the background. Never touches
 * project.yaml/schedule.yaml — those always require a manual, confirmed `mi notion pull
 * --apply`. Missing token/data-source configuration (e.g. a fresh install) is a silent
 * no-op rather than a background error dialog.
 */
async function runNotionSyncOnce() {
  try {
    const settings = configStore.getSettings();
    const token = await configStore.getNotionToken();
    if (!token || !settings.notionProjectsDataSourceId) return;
    const snapshot = await refreshProjectSnapshot({
      token,
      projectsDataSourceId: settings.notionProjectsDataSourceId,
      dataRoot: configStore.dataRoot,
    });
    if (latestNotionHealth) latestNotionHealth.localSnapshot = snapshot;
    if (settings.notionScheduleDataSourceId) {
      const scheduleSnapshot = await refreshScheduleSnapshot({
        token,
        scheduleDataSourceId: settings.notionScheduleDataSourceId,
        dataRoot: configStore.dataRoot,
      });
      if (latestNotionHealth) latestNotionHealth.scheduleSnapshot = scheduleSnapshot;
    }
    await refreshFirmHarness();
  } catch (error) {
    console.error("Notion auto-pull failed:", error instanceof Error ? error.message : error);
  }
}

async function fetchPortfolioBriefing() {
  try {
    const response = await fetch(`${LOCAL_ORIGIN}/api/portfolio/briefing`);
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.briefing === "string" ? data.briefing : null;
  } catch {
    return null;
  }
}

/**
 * Regenerates the firm-wide chat workspace (electron/firmHarness.js) so opening "No
 * project" chat doesn't depend on a manual repair action for something the user never
 * explicitly manages. Silent no-op when the shared Mi data folder isn't confirmed yet, same
 * philosophy as runNotionSyncOnce. The portfolio briefing fetch can fail if the local Next
 * server isn't up yet (e.g. the very first sync at cold start, before startNextServer
 * resolves) -- that's fine, PORTFOLIO_CONTEXT.md is just skipped for this pass and picked
 * up on the next one.
 */
async function refreshFirmHarness() {
  try {
    const settings = configStore.getSettings();
    if (!settings.dropboxRoot || !settings.dropboxFirmDataPath) return;
    const portfolioBriefing = await fetchPortfolioBriefing();
    const preview = previewFirmHarness({
      dropboxRoot: settings.dropboxRoot,
      dropboxFirmDataPath: settings.dropboxFirmDataPath,
      templatePath: FIRM_TEMPLATE_PATH,
      dataRoot: configStore.dataRoot,
      notionAttendeeName: settings.notionAttendeeName,
      portfolioBriefing,
    });
    applyFirmHarness(preview, { confirmed: true });
  } catch (error) {
    console.error("Firm-wide chat workspace refresh failed:", error instanceof Error ? error.message : error);
  }
}

function startNotionSyncTimer(intervalMinutes) {
  clearNotionSyncTimer();
  notionSyncTimer = setInterval(() => { void runNotionSyncOnce(); }, intervalMinutes * 60_000);
  notionSyncTimer.unref?.();
  void runNotionSyncOnce();
}

function setupWorkspaceIPC() {
  ipcMain.handle("window:new-chat", (_event, payload = {}) => {
    const window = createNewChatWindow(payload.path);
    return { opened: !window.isDestroyed() };
  });
  ipcMain.handle("window:open-compact-chat", (_event, payload = {}) => {
    const projectSlug = projectContextTracker.remember(payload.projectSlug);
    const window = createProjectChatWindow(projectSlug, payload.scope === "personal" ? "personal" : "firm");
    return { opened: !window.isDestroyed() };
  });
  ipcMain.handle("window:open-pane", (_event, payload = {}) => {
    const kind = normalizePaneKind(payload.kind);
    const target = kind === "terminal"
      ? { workspace: payload.workspace, session: payload.session }
      : { projectSlug: projectContextTracker.remember(payload.projectSlug), scope: payload.scope };
    const window = createPaneWindow(kind, target);
    return { opened: !window.isDestroyed() };
  });
  ipcMain.handle("window:close-pane", (_event, payload = {}) => {
    // Any Mi window may dismiss a pane -- that is how "bring this back into the page"
    // works from the in-app view that stepped aside for it.
    const kind = normalizePaneKind(payload.kind);
    const key = kind === "terminal" ? terminalPaneKey(currentTerminalWorkspace(normalizePaneWorkspace(payload.workspace)), payload.session) : kind;
    const window = livePaneWindow(key);
    if (window) dismissPaneWindow(kind, window);
    return paneState();
  });
  ipcMain.handle("window:pane-state", () => paneState());
  ipcMain.handle("window:pane-action", (event, payload = {}) => {
    const pane = senderPaneWindow(event.sender);
    if (!pane) throw new Error("Pane window controls are only available inside a pop-out window.");
    return applyPaneAction(pane.kind, pane.window, payload.action, payload.collapsed);
  });
  ipcMain.handle("window:compact-chat-action", (event, payload = {}) => {
    const pane = senderPaneWindow(event.sender);
    if (!pane || pane.kind !== "chat") {
      throw new Error("Compact chat controls are only available in the compact chat window.");
    }
    return applyPaneAction("chat", pane.window, payload.action, payload.collapsed);
  });
  ipcMain.handle("preferences:get-timezone", () => configStore.getSettings().timezone);
  ipcMain.handle("preferences:set-timezone", (_event, { timezone }) => {
    if (!validTimezone(timezone)) throw new Error("Select a valid IANA timezone.");
    return configStore.updateSettings({ timezone }).timezone;
  });
  // Ctrl/Cmd + wheel and trackpad pinch, interpreted in the renderer (components/ZoomGesture.tsx)
  // because before-mouse-event never delivered wheel events. Applies to the calling window only.
  ipcMain.handle("zoom:step", (event, { action } = {}) => {
    const sender = event.sender;
    if (!sender || sender.isDestroyed()) return null;
    return applyZoomAction(sender, action);
  });
  ipcMain.handle("dropbox:pick-project-folder", async () => {
    const root = configStore.getSettings().dropboxRoot;
    if (!root) return { error: "Select a local STUDIO Dropbox root in Settings first." };
    const result = await pickDirectory("Choose a project folder inside the STUDIO Dropbox root", root);
    if (result.canceled) return result;
    try {
      return { relativePath: normalizeDropboxSelection(root, result.path) };
    } catch (error) {
      return { error: error.message };
    }
  });
  ipcMain.handle("dropbox:pick-shared-folder", async () => {
    const root = configStore.getSettings().dropboxRoot;
    if (!root) return { error: "Select a local STUDIO Dropbox root in Settings first." };
    const result = await pickDirectory("Choose (or create) a firm-wide Mi data folder inside the STUDIO Dropbox root", root);
    if (result.canceled) return result;
    try {
      return { relativePath: normalizeDropboxSelection(root, result.path) };
    } catch (error) {
      return { error: error.message };
    }
  });
  // Read-only. Answers "is the firm's data actually in there, and is this computer using it?"
  // before any setting changes -- the second-computer case where projects read zero because
  // the local dataRoot is still the source. Accepts a not-yet-saved draft path so the check
  // can run right after the folder picker, without committing the setting first.
  ipcMain.handle("dropbox:inspect-shared-data", (_event, { relativePath } = {}) => {
    const settings = configStore.getSettings();
    return inspectSharedData({
      dropboxRoot: settings.dropboxRoot,
      sharedRelativePath: typeof relativePath === "string" && relativePath.trim()
        ? relativePath
        : settings.dropboxFirmDataPath,
      sharedDataRootEnabled: settings.sharedDataRootEnabled,
      localDataRoot: configStore.dataRoot,
    });
  });
  // Proposes folders that already hold Mi records so nobody has to hunt through a picker.
  // Read-only, and deliberately never applies a result: the human still confirms which folder
  // is theirs, the same rule that governs dropbox_path and notion_page_id.
  ipcMain.handle("dropbox:find-shared-data", () => {
    const root = configStore.getSettings().dropboxRoot;
    if (!root) return { error: "Select this computer's local STUDIO Dropbox root first.", candidates: [] };
    return { error: null, candidates: findSharedDataCandidates(root) };
  });
  ipcMain.handle("notion:open", async (_event, { target }) => {
    const httpsUrl = validateNotionTarget(target);
    if (!httpsUrl) throw new Error("Only validated Notion URLs or page IDs may be opened.");
    const nativeUrl = toNotionDeepLink(httpsUrl);
    if (nativeUrl) {
      try {
        await shell.openExternal(nativeUrl);
        return { opened: "native", url: nativeUrl };
      } catch {
        // Fall through to the validated HTTPS URL.
      }
    }
    await shell.openExternal(httpsUrl);
    return { opened: "https", url: httpsUrl };
  });
  ipcMain.handle("notion-sync:status", () => notionSyncStatus());
  ipcMain.handle("notion-sync:set-interval", (_event, { minutes }) => {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("Interval must be a positive integer number of minutes.");
    }
    const settings = configStore.updateSettings({ notionSyncIntervalMinutes: value });
    if (settings.notionSyncEnabled) startNotionSyncTimer(value);
    return notionSyncStatus();
  });
  ipcMain.handle("notion-sync:stop", () => {
    configStore.updateSettings({ notionSyncEnabled: false });
    clearNotionSyncTimer();
    return notionSyncStatus();
  });
  ipcMain.handle("notion-sync:start", () => {
    const settings = configStore.updateSettings({ notionSyncEnabled: true });
    startNotionSyncTimer(settings.notionSyncIntervalMinutes);
    return notionSyncStatus();
  });
  // On-demand refresh that doesn't touch the enabled/interval setting -- for a manual
  // "Sync now" action even when background sync is off.
  ipcMain.handle("notion-sync:run-once", async () => {
    await runNotionSyncOnce();
    return readScheduleSnapshot();
  });
  ipcMain.handle("schedule:get-snapshot", () => readScheduleSnapshot());
}

function readScheduleSnapshot() {
  try {
    const raw = fs.readFileSync(path.join(configStore.dataRoot, "notion", "schedule-snapshot.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setupHarnessIPC() {
  ipcMain.handle("harness:preview", (_event, { slug }) => {
    const metadata = readProject(slug);
    const settings = configStore.getSettings();
    const preview = previewHarness(projectHarnessOptions({ slug, metadata, settings }));
    const previewId = require("node:crypto").randomUUID();
    harnessPreviews.set(previewId, preview);
    return { previewId, entries: preview.entries, dropboxPath: metadata.dropbox_path };
  });
  ipcMain.handle("harness:apply", (_event, { previewId, confirmed }) => {
    const preview = harnessPreviews.get(previewId);
    if (!preview) throw new Error("Preview expired. Preview the workspace again.");
    harnessPreviews.delete(previewId);
    return { results: applyHarnessPreview(preview, { confirmed }) };
  });
  ipcMain.handle("harness:preview-all", () => {
    const settings = configStore.getSettings();
    return allProjectHarnessManager.previewAll({
      dataRoot: runtimeDataRoot,
      dropboxRoot: settings.dropboxRoot,
      timezone: settings.timezone,
      templatePath: TEMPLATE_PATH,
      notionDataRoot: configStore.dataRoot,
      notionAttendeeName: settings.notionAttendeeName,
    });
  });
  ipcMain.handle("harness:apply-all", (_event, { previewId, confirmed }) => (
    allProjectHarnessManager.applyAll({ previewId, confirmed })
  ));
  ipcMain.handle("permit-qaqc-harness:preview", (_event, { slug }) => {
    const settings = configStore.getSettings();
    const preview = previewPermitQaqcHarness({
      runtimeDataRoot,
      settings,
      slug,
      templatePath: PERMIT_QAQC_TEMPLATE_PATH,
    });
    const previewId = require("node:crypto").randomUUID();
    permitQaqcHarnessPreviews.set(previewId, preview);
    return { previewId, entries: preview.entries, dropboxPath: preview.dropboxPath };
  });
  ipcMain.handle("permit-qaqc-harness:apply", (_event, { previewId, confirmed }) => {
    const preview = permitQaqcHarnessPreviews.get(previewId);
    if (!preview) throw new Error("Preview expired. Preview the workspace again.");
    permitQaqcHarnessPreviews.delete(previewId);
    return { results: applyPermitQaqcHarnessPreview(preview, { confirmed }) };
  });
  ipcMain.handle("lead-harness:preview", (_event, { slug }) => {
    const settings = configStore.getSettings();
    const preview = previewLeadHarness({
      runtimeDataRoot,
      settings,
      slug,
      templatePath: LEAD_TEMPLATE_PATH,
    });
    const previewId = require("node:crypto").randomUUID();
    leadHarnessPreviews.set(previewId, preview);
    return { previewId, entries: preview.entries, dropboxPath: preview.dropboxPath };
  });
  ipcMain.handle("lead-harness:apply", (_event, { previewId, confirmed }) => {
    const preview = leadHarnessPreviews.get(previewId);
    if (!preview) throw new Error("Preview expired. Preview the workspace again.");
    leadHarnessPreviews.delete(previewId);
    return { results: applyLeadHarnessPreview(preview, { confirmed }) };
  });
}

function quoteArgWin(arg) {
  if (arg === "") return '""';
  if (!/[ \t\n\v"]/.test(arg)) return arg;
  let result = '"';
  for (let index = 0; index <= arg.length; index++) {
    let slashes = 0;
    while (arg[index] === "\\") {
      slashes++;
      index++;
    }
    if (index === arg.length) {
      result += "\\".repeat(slashes * 2);
      break;
    }
    if (arg[index] === '"') result += `${"\\".repeat(slashes * 2 + 1)}"`;
    else result += `${"\\".repeat(slashes)}${arg[index]}`;
  }
  return `${result}"`;
}

const attachmentsRoot = () => path.join(app.getPath("userData"), "cache", "chat-attachments");

function setupAgentIPC() {
  ipcMain.handle("agent:availability", detectOptionalTools);
  ipcMain.handle("agent:send", async (event, options) => {
    const {
      requestId,
      engine: engineName,
      cwd,
      prompt,
      sessionId,
      model,
      images,
      attachments,
      scope,
      entitySlug,
      entityName,
      // Guided-interview-only, optional. Absent for every existing call site
      // (plain free-form chat) -- see the interviewStepId branch below, which
      // is the ONLY behavior this pair of fields can affect. When
      // interviewStepId is absent, this handler's behavior is byte-for-byte
      // identical to before these fields existed.
      interviewStepId,
      interviewAlreadyKnownSummary,
    } = options;
    const engine = getEngine(engineName);
    const settings = configStore.getSettings();
    const command = engineName === "codex" ? settings.codexBin || engine.command : settings.claudeBin || engine.command;
    if (!validToolCommand(command)) throw new Error(`Invalid ${engineName} command.`);
    const personalScope = scope === "personal";
    const focusedFirmScope = isFirmAgentScope(scope);
    const firmWorkspaceScope = scope === "firm" || focusedFirmScope;
    const resolvedCwd = personalScope
      ? ensurePersonalAgentWorkspace(configStore.dataRoot)
      : resolveProjectCwd(firmWorkspaceScope ? "." : cwd);
    if (!personalScope && !firmWorkspaceScope) projectContextTracker.observeProjectCwd(cwd);
    const responseTarget = event.sender;
    const sendChunk = (chunk) => {
      if (!responseTarget.isDestroyed()) responseTarget.send("agent:chunk", { requestId, chunk });
    };
    const isNewSession = !sessionId;
    const resolvedSessionId = engine.prepareSessionId(sessionId);
    const preparedAttachments = await prepareAgentAttachments({
      root: attachmentsRoot(),
      requestId,
      attachments: attachments ?? images,
    });
    const imagePaths = preparedAttachments
      .filter((attachment) => attachment.isImage)
      .map((attachment) => attachment.filePath);
    let effectivePrompt = focusedFirmScope
      ? buildFirmScopedAgentPrompt(prompt, scope, {
          packaged: app.isPackaged,
          entitySlug,
          entityName,
          dataRoot: configStore.dataRoot,
          timezone: configStore.getSettings().timezone,
        })
      : prompt;
    if (personalScope) {
      effectivePrompt = buildPersonalAgentPrompt(
        prompt,
        loadPersonalAgentContext(configStore.dataRoot, {
          personalDataRoot: settings.personalDataRootOverride,
          query: prompt,
        }),
      );
    } else if (interviewStepId) {
      // Always -- ignoring app.isPackaged/isNewSession -- unlike the
      // free-form branch below: the guided interview needs its step-specific
      // directive (which proposal kind to aim for, what's already known, the
      // milestone-status prohibition) on every step, including in a packaged
      // build. That directive is inherently per-request/dynamic, so it can
      // never be pre-baked into a generated project harness file the way the
      // general mi-proposals protocol instructions are. This only changes
      // prompt content passed to the CLI's stdin; readOnly/sandbox flags on
      // engine.buildArgs below are untouched.
      const context = loadAgentContext(DEV_ROOT, projectSlugFromCwd(cwd), configStore.dataRoot, settings.notionAttendeeName);
      effectivePrompt = buildInterviewStepPrompt(
        { prompt, stepId: interviewStepId, alreadyKnownSummary: interviewAlreadyKnownSummary || "" },
        context,
      );
    } else if (!app.isPackaged && isNewSession) {
      const context = loadAgentContext(DEV_ROOT, projectSlugFromCwd(cwd), configStore.dataRoot, settings.notionAttendeeName);
      effectivePrompt = buildAgentPrompt(prompt, context);
    }
    if (app.isPackaged && isNewSession && !personalScope && !firmWorkspaceScope && projectSlugFromCwd(cwd)) {
      const sharedWork = summarizeWorkspaceSharedWork(resolvedCwd);
      if (sharedWork) effectivePrompt += `\n\n<shared_project_reference>\n${sharedWork}\n</shared_project_reference>`;
    }
    effectivePrompt = addAttachmentContext(effectivePrompt, preparedAttachments);
    const args = engine.buildArgs({
      sessionId: resolvedSessionId,
      isNewSession,
      model,
      images: imagePaths,
      readOnly: app.isPackaged || personalScope || firmWorkspaceScope,
      skipGitRepoCheck: app.isPackaged || personalScope || firmWorkspaceScope,
    });
    const claudeSubscriptionToken = engineName === "claude"
      ? await configStore.getClaudeSubscriptionToken()
        || (!app.isPackaged ? process.env.CLAUDE_CODE_OAUTH_TOKEN : null)
      : null;
    const isWindows = process.platform === "win32";
    const child = spawn(command, isWindows ? args.map(quoteArgWin) : args, {
      cwd: resolvedCwd,
      windowsHide: true,
      shell: isWindows,
      env: agentEnvironmentForEngine(engineName, agentEnvironment(), claudeSubscriptionToken),
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeAgentRequests.set(requestId, child);
    child.stdin.end(effectivePrompt, "utf8");
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    child.stdout.on("data", (buffer) => {
      const text = buffer.toString("utf8");
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      for (const line of lines) {
        const chunk = engine.extractDelta(line);
        if (chunk) sendChunk(chunk);
      }
    });
    child.stderr.on("data", (buffer) => { stderr += buffer.toString("utf8"); });
    return new Promise((resolve) => {
      const finish = (result) => {
        activeAgentRequests.delete(requestId);
        fs.rmSync(path.join(attachmentsRoot(), requestId), { recursive: true, force: true });
        resolve(result);
      };
      child.on("error", (error) => finish({
        requestId,
        sessionId: resolvedSessionId,
        fullOutput: `Failed to start ${engineName}: ${error.message}`,
        exitCode: null,
        isError: true,
      }));
      child.on("exit", (exitCode) => {
        if (lineBuffer.trim()) {
          const chunk = engine.extractDelta(lineBuffer);
          if (chunk) sendChunk(chunk);
        }
        const parsed = engine.parseFinalOutput(stdout, stderr);
        finish({
          requestId,
          sessionId: parsed.sessionId || resolvedSessionId,
          fullOutput: parsed.text || stderr.trim() || (exitCode ? "The CLI exited with an error." : ""),
          exitCode,
          isError: parsed.isError || exitCode !== 0,
        });
      });
    });
  });
  ipcMain.on("agent:cancel", (_event, { requestId }) => {
    activeAgentRequests.get(requestId)?.kill();
    activeAgentRequests.delete(requestId);
  });
}

function localProjectExists(slug) {
  try {
    readProject(slug);
    return true;
  } catch {
    return false;
  }
}

function showWindow(window) {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function configureTrustedWindow(window) {
  installZoomControls(window.webContents);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(target.toString());
    } catch {
      // Invalid and non-web targets are ignored.
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin === LOCAL_ORIGIN) return;
    } catch {
      // Invalid navigation targets are blocked below.
    }
    event.preventDefault();
  });
  window.webContents.on("did-navigate", (_event, targetUrl) => {
    projectContextTracker.observeTrustedNavigation(targetUrl);
  });
  window.webContents.on("did-navigate-in-page", (_event, targetUrl, isMainFrame) => {
    if (isMainFrame) projectContextTracker.observeTrustedNavigation(targetUrl);
  });
}

function createTrustedWindow(options) {
  const window = new BrowserWindow({
    ...options,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureTrustedWindow(window);
  return window;
}

function mainWindowUrl() {
  const config = configStore.getPublicConfig();
  const url = new URL(config.setupCompleted ? "/" : "/onboarding", LOCAL_ORIGIN);
  const projectSlug = projectContextTracker.current();
  const launchEngine = process.env.MI_CHAT_ENGINE || "";
  if (config.setupCompleted && projectSlug) url.searchParams.set("project", projectSlug);
  if (launchEngine === "claude" || launchEngine === "codex") url.searchParams.set("engine", launchEngine);
  return url.toString();
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showWindow(mainWindow);
    return mainWindow;
  }
  mainWindow = createTrustedWindow({
    width: 1440,
    height: 900,
  });
  mainWindow.on("close", (event) => {
    if (mainWindowCloseAction(isQuitting, process.platform) === "close") return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(mainWindowUrl());
  return mainWindow;
}

function livePaneWindow(kind) {
  const window = paneWindows.get(kind);
  return window && !window.isDestroyed() ? window : null;
}

/** What the in-app views need to know: which surfaces are currently living in a pop-out
 * card, so the page-embedded copy can offer "focus that window" instead of attaching a
 * second view to the same shell and fighting it over the pty size. */
function paneState() {
  const chat = livePaneWindow("chat");
  const terminals = [...paneTargets.entries()].flatMap(([key, target]) =>
    key.startsWith("terminal:") && livePaneWindow(key)?.isVisible() ? [target] : []);
  const chatOpen = Boolean(chat?.isVisible());
  return {
    chat: chatOpen,
    chatProject: chatOpen ? paneTargets.get("chat") ?? null : null,
    terminalWorkspace: terminals.find((target) => target.session === "1")?.workspace ?? null,
    terminals,
  };
}

function broadcastPaneState() {
  broadcastToTrustedWindows("window:pane-state", paneState());
}

function currentTerminalWorkspace(workspace) {
  return resolveTerminalWorkspace({ workspace, runtimeDataRoot, settings: configStore.getSettings() });
}

/** Resolves the pane identity and URL together, after following confirmed terminal links. */
function resolvePaneTarget(kind, target = {}) {
  if (kind === "terminal") {
    const workspace = currentTerminalWorkspace(normalizePaneWorkspace(target.workspace));
    const session = normalizeTerminalSession(target.session);
    return { target: { workspace, session }, url: terminalPaneUrl(LOCAL_ORIGIN, workspace, session) };
  }
  const scope = target.scope === "personal" ? "personal" : "firm";
  const projectSlug = scope === "personal" ? null : target.projectSlug || projectContextTracker.current();
  return {
    target: projectSlug,
    url: compactChatUrl(
      LOCAL_ORIGIN,
      projectSlug,
      scope === "personal" ? "compact-personal" : "compact",
      scope,
    ),
  };
}

/**
 * Opens or refocuses a card: one for chat, one per workspace/session for terminals. Dismissing a
 * card never ends the work behind it -- chat threads and a terminal's pty both outlive it;
 * see the close handler below for why only one of the two keeps its window around.
 */
function createPaneWindow(requestedKind, target = {}) {
  const kind = normalizePaneKind(requestedKind);
  const resolved = resolvePaneTarget(kind, target);
  const key = kind === "terminal" ? terminalPaneKey(target.workspace, target.session) : kind;
  const targetUrl = resolved.url;
  paneTargets.set(key, resolved.target);
  const existing = livePaneWindow(key);
  if (existing) {
    if (existing.webContents.getURL() !== targetUrl) existing.loadURL(targetUrl);
    showWindow(existing);
    broadcastPaneState();
    return existing;
  }
  const size = paneWindowSize(kind, false);
  const window = createTrustedWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    autoHideMenuBar: true,
    frame: false,
    alwaysOnTop: true,
    title: kind === "terminal" ? "Mi Terminal" : "Mi Chat",
    backgroundColor: kind === "terminal" ? "#07111b" : "#0a0a0a",
  });
  paneWindows.set(key, window);
  // A frameless, always-on-top card has no OS chrome, so the only visible way out is the
  // titlebar its own renderer draws. When that titlebar failed to render -- as the personal
  // chat card's did while it was pointed at an ordinary page route -- what was left was a
  // window pinned above everything with no dismiss control on it at all. Escape and Ctrl/Cmd+W
  // dismiss the chat card from the main process, out of reach of any renderer problem.
  //
  // The terminal card deliberately gets neither: Escape and Ctrl+W both belong to the shell
  // inside it (vim, readline's delete-word), and stealing them would break the surface to guard
  // against a failure its own titlebar already survives. Alt+F4 still dismisses either card.
  if (kind === "chat") {
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const dismissChord = input.key === "Escape"
        || (input.key.toLowerCase() === "w" && (input.control || input.meta));
      if (!dismissChord) return;
      event.preventDefault();
      dismissPaneWindow(kind, window);
    });
  }
  window.on("close", (event) => {
    // A chat card is hidden, never torn down: its threads live in that renderer. A terminal
    // card is disposable -- the pty and its replay buffer live here in the main process, so
    // destroying the view frees the second xterm attached to the shell and reopening it
    // replays straight back into the same session.
    if (isQuitting || kind === "terminal") return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (paneWindows.get(key) === window) {
      paneWindows.delete(key);
      paneTargets.delete(key);
    }
    broadcastPaneState();
  });
  window.on("show", broadcastPaneState);
  window.on("hide", broadcastPaneState);
  window.loadURL(targetUrl);
  // Announced here as well as on "show": the in-app view has to step aside for this card
  // whether or not the platform reports a show event for a window created visible.
  broadcastPaneState();
  return window;
}

/** Kept as the name the tray, menu, and global shortcut already speak. */
function createProjectChatWindow(requestedSlug = null, requestedScope = "firm") {
  return createPaneWindow("chat", { projectSlug: requestedSlug, scope: requestedScope });
}

/** "Dismiss this card" -- see the close handler in createPaneWindow for why the two kinds
 * part ways here. */
function dismissPaneWindow(kind, window) {
  if (kind === "terminal") window.close();
  else window.hide();
}

function applyPaneAction(kind, window, action, collapsed) {
  if (action === "hide") dismissPaneWindow(kind, window);
  else if (action === "minimize") window.minimize();
  else if (action === "toggle-pin") window.setAlwaysOnTop(!window.isAlwaysOnTop());
  else if (action === "collapse") {
    const size = paneWindowSize(kind, collapsed === true);
    window.setMinimumSize(size.minWidth, size.minHeight);
    window.setSize(size.width, size.height, true);
  } else {
    throw new Error("Unknown pane window action.");
  }
  return {
    visible: window.isVisible(),
    pinned: window.isAlwaysOnTop(),
  };
}

/** Window chrome actions are only offered to the card that owns the chrome, so the sender
 * -- not a caller-supplied id -- decides which window is being driven. */
function senderPaneWindow(sender) {
  for (const [kind, window] of paneWindows) {
    if (!window.isDestroyed() && sender === window.webContents) return { kind: kind.startsWith("terminal:") ? "terminal" : kind, window };
  }
  return null;
}

function createNewChatWindow(requestedPath = "/") {
  const windowId = crypto.randomUUID();
  const pathname = normalizeChatWindowPath(requestedPath);
  const url = new URL(pathname, LOCAL_ORIGIN);
  url.searchParams.set("chatWindow", windowId);
  url.searchParams.set("newChat", "1");
  const window = createTrustedWindow({
    width: 1080,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: pathname === "/" ? "Mi — New Chat" : `Mi — ${pathname.slice(1)} Chat`,
  });
  chatWindows.add(window);
  window.on("closed", () => chatWindows.delete(window));
  window.loadURL(url.toString());
  return window;
}

function requestQuit() {
  if (isQuitting) return;
  isQuitting = true;
  app.quit();
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate({
    openMainWindow: createWindow,
    openNewChatWindow: () => createNewChatWindow(),
    openProjectChatWindow: () => createProjectChatWindow(),
    quitApp: requestQuit,
    platform: process.platform,
    appName: app.name || "Mi",
  })));
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const icon = nativeImage.createFromPath(APP_ICON);
  const trayIcon = process.platform === "darwin" ? icon.resize({ width: 18, height: 18 }) : icon;
  if (process.platform === "darwin") trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip("Mi");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Mi", click: createWindow },
    { label: "New Chat Window", click: () => createNewChatWindow() },
    { label: "Open Compact Chat", click: () => createProjectChatWindow() },
    { type: "separator" },
    { label: "Quit Mi", click: requestQuit },
  ]));
  tray.on(process.platform === "darwin" ? "click" : "double-click", createWindow);
  return tray;
}

function registerProjectChatShortcut() {
  try {
    shortcutRegistered = globalShortcut.register(PROJECT_CHAT_SHORTCUT, () => createProjectChatWindow());
  } catch (error) {
    shortcutRegistered = false;
    console.warn(`Mi project-chat shortcut could not be registered: ${error.message}`);
  }
  if (!shortcutRegistered) {
    console.warn(`Mi project-chat shortcut ${PROJECT_CHAT_SHORTCUT} is unavailable; use the tray menu instead.`);
  }
}

async function runSmokeTest(reportPath) {
  let status = "passed";
  let error = null;
  // Probe the exact URL a real launch would load (mainWindowUrl()), not a hardcoded route,
  // so this check fails if a fresh profile ever stops resolving to the onboarding wizard.
  const launchUrl = mainWindowUrl();
  try {
    await waitForServer(launchUrl);
  } catch (cause) {
    status = "failed";
    error = cause instanceof Error ? cause.message : String(cause);
  }
  fs.writeFileSync(reportPath, `${JSON.stringify({
    status,
    error,
    packaged: app.isPackaged,
    version: app.getVersion(),
    setupCompleted: configStore.getPublicConfig().setupCompleted,
    launchPath: new URL(launchUrl).pathname,
    externalNodeRequired: false,
  }, null, 2)}\n`, "utf8");
  app.quit();
}

const shutdown = createIdempotentCleanup(() => {
  clearNotionSyncTimer();
  stopNextServer();
  terminalManager.killAll();
  for (const child of activeAgentRequests.values()) child.kill();
  activeAgentRequests.clear();
  allProjectHarnessManager.clear();
  if (shortcutRegistered) {
    globalShortcut.unregister(PROJECT_CHAT_SHORTCUT);
    shortcutRegistered = false;
  }
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (desktopReady) createWindow();
  });
  app.on("activate", () => {
    if (desktopReady) createWindow();
  });

  app.whenReady().then(async () => {
    app.setAppLogsPath();
    editableMiConfigPath = app.isPackaged
      ? path.join(app.getPath("userData"), "config", "mi.config.yaml")
      : path.join(DEV_ROOT, "mi.config.yaml");
    configStore = createConfigStore({
      userDataPath: app.getPath("userData"),
      secureStorage: secureStorageAdapter(),
      miConfigPath: editableMiConfigPath,
    });
    configStore.initialize();
    if (!process.env.MI_SMOKE_REPORT_PATH) {
      try {
        initializeLaunchAtLogin(app, configStore);
      } catch (error) {
        console.warn(`Mi could not configure Windows startup: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (app.isPackaged) {
      ensureEditableMiConfig({ templatePath: MI_CONFIG_TEMPLATE_PATH, configPath: editableMiConfigPath });
    }
    runtimeDataRoot = configuredRuntimeDataRoot();
    projectContextTracker = createProjectContextTracker({
      trustedOrigin: LOCAL_ORIGIN,
      projectExists: localProjectExists,
      initialSlug: process.env.MI_CHAT_PROJECT || null,
    });
    setupTerminalIPC();
    setupConfigurationIPC();
    setupWorkspaceIPC();
    setupHarnessIPC();
    setupAgentIPC();
    const initialSyncSettings = configStore.getSettings();
    if (initialSyncSettings.notionSyncEnabled) startNotionSyncTimer(initialSyncSettings.notionSyncIntervalMinutes);
    await startNextServer();
    const smokeReport = process.env.MI_SMOKE_REPORT_PATH;
    if (smokeReport) await runSmokeTest(smokeReport);
    else {
      await waitForServer(LOCAL_ORIGIN);
      if (process.platform === "darwin" && app.dock) app.dock.setIcon(APP_ICON);
      installApplicationMenu();
      ensureTray();
      registerProjectChatShortcut();
      desktopReady = true;
      createWindow();
    }
  }).catch((error) => {
    dialog.showErrorBox("Mi could not start", error instanceof Error ? error.message : String(error));
    requestQuit();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  shutdown();
});
