const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  setup: {
    get: () => ipcRenderer.invoke("setup:get"),
    revealMiConfig: () => ipcRenderer.invoke("setup:reveal-mi-config"),
    pickDropboxRoot: () => ipcRenderer.invoke("setup:pick-dropbox-root"),
    pickCodeLibraryRoot: () => ipcRenderer.invoke("setup:pick-code-library-root"),
    pickPersonalDataRoot: () => ipcRenderer.invoke("setup:pick-personal-data-root"),
    pickLegacyEnv: () => ipcRenderer.invoke("setup:pick-legacy-env"),
    importLegacy: (path, confirmed) => ipcRenderer.invoke("setup:import-legacy", { path, confirmed }),
    saveSettings: (settings) => ipcRenderer.invoke("setup:save-settings", settings),
    setNotionToken: (token) => ipcRenderer.invoke("setup:set-token", { token }),
    clearNotionToken: () => ipcRenderer.invoke("setup:clear-token"),
    setClaudeSubscriptionToken: (token) =>
      ipcRenderer.invoke("setup:set-claude-subscription-token", { token }),
    clearClaudeSubscriptionToken: () =>
      ipcRenderer.invoke("setup:clear-claude-subscription-token"),
    setClaudeApiKey: (token) =>
      ipcRenderer.invoke("setup:set-claude-api-key", { token }),
    clearClaudeApiKey: () =>
      ipcRenderer.invoke("setup:clear-claude-api-key"),
    setOpenAiApiKey: (token) =>
      ipcRenderer.invoke("setup:set-openai-api-key", { token }),
    clearOpenAiApiKey: () =>
      ipcRenderer.invoke("setup:clear-openai-api-key"),
    testAgentConnection: (kind) =>
      ipcRenderer.invoke("setup:test-agent-connection", { kind }),
    testNotion: () => ipcRenderer.invoke("setup:test-notion"),
    detectTools: () => ipcRenderer.invoke("setup:detect-tools"),
    finish: () => ipcRenderer.invoke("setup:finish"),
    restartServer: () => ipcRenderer.invoke("setup:restart-server"),
  },
  diagnostics: {
    export: () => ipcRenderer.invoke("diagnostics:export"),
  },
  windows: {
    newChat: (path) => ipcRenderer.invoke("window:new-chat", { path }),
    openCompactChat: (projectSlug, scope) => ipcRenderer.invoke("window:open-compact-chat", { projectSlug, scope }),
    compactChatAction: (action, collapsed) =>
      ipcRenderer.invoke("window:compact-chat-action", { action, collapsed }),
    /** Pop a Mi surface out into its own pinned card window. */
    openPane: (kind, target) => ipcRenderer.invoke("window:open-pane", { kind, ...target }),
    closePane: (kind, target) => ipcRenderer.invoke("window:close-pane", { kind, ...target }),
    paneState: () => ipcRenderer.invoke("window:pane-state"),
    /** Window chrome actions for the pane card that is calling. */
    paneAction: (action, collapsed) =>
      ipcRenderer.invoke("window:pane-action", { action, collapsed }),
    onPaneState: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("window:pane-state", listener);
      return () => ipcRenderer.removeListener("window:pane-state", listener);
    },
  },
  harness: {
    preview: (slug) => ipcRenderer.invoke("harness:preview", { slug }),
    apply: (previewId, confirmed) => ipcRenderer.invoke("harness:apply", { previewId, confirmed }),
    previewAll: () => ipcRenderer.invoke("harness:preview-all"),
    applyAll: (previewId, confirmed) => ipcRenderer.invoke("harness:apply-all", { previewId, confirmed }),
  },
  permitQaqcHarness: {
    preview: (slug) => ipcRenderer.invoke("permit-qaqc-harness:preview", { slug }),
    apply: (previewId, confirmed) => ipcRenderer.invoke("permit-qaqc-harness:apply", { previewId, confirmed }),
  },
  leadHarness: {
    preview: (slug) => ipcRenderer.invoke("lead-harness:preview", { slug }),
    apply: (previewId, confirmed) => ipcRenderer.invoke("lead-harness:apply", { previewId, confirmed }),
  },
  terminal: {
    openLink: (target) => ipcRenderer.invoke("terminal:open-link", target),
    resolveWorkspace: (workspace) => ipcRenderer.invoke("terminal:resolve-workspace", workspace),
    create: (cwd, cols, rows, sessionKey) =>
      ipcRenderer.invoke("terminal:create", { cwd, cols, rows, sessionKey }),
    write: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
    kill: (id) => ipcRenderer.send("terminal:kill", { id }),
    pickProposalFile: (projectSlug) =>
      ipcRenderer.invoke("terminal:pick-proposal-file", { projectSlug }),
    /** callback receives { id, data } for every chunk from any open terminal. */
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
  },
  notionSync: {
    status: () => ipcRenderer.invoke("notion-sync:status"),
    setInterval: (minutes) => ipcRenderer.invoke("notion-sync:set-interval", { minutes }),
    stop: () => ipcRenderer.invoke("notion-sync:stop"),
    start: () => ipcRenderer.invoke("notion-sync:start"),
    runNow: () => ipcRenderer.invoke("notion-sync:run-once"),
  },
  schedule: {
    getSnapshot: () => ipcRenderer.invoke("schedule:get-snapshot"),
  },
  personalCalendar: {
    status: () => ipcRenderer.invoke("personal-calendar:status"),
    setToken: (token) => ipcRenderer.invoke("personal-calendar:set-token", { token }),
    clearToken: () => ipcRenderer.invoke("personal-calendar:clear-token"),
    discover: () => ipcRenderer.invoke("personal-calendar:discover"),
    select: (selection) => ipcRenderer.invoke("personal-calendar:select", selection),
    create: (input, confirmed) => ipcRenderer.invoke("personal-calendar:create", { input, confirmed }),
  },
  preferences: {
    getTimezone: () => ipcRenderer.invoke("preferences:get-timezone"),
    setTimezone: (timezone) => ipcRenderer.invoke("preferences:set-timezone", { timezone }),
  },
  zoom: {
    step: (action) => ipcRenderer.invoke("zoom:step", { action }),
  },
  dropbox: {
    pickProjectFolder: () => ipcRenderer.invoke("dropbox:pick-project-folder"),
    pickSharedFolder: () => ipcRenderer.invoke("dropbox:pick-shared-folder"),
    inspectSharedData: (relativePath) => ipcRenderer.invoke("dropbox:inspect-shared-data", { relativePath }),
    findSharedData: () => ipcRenderer.invoke("dropbox:find-shared-data"),
  },
  firmData: {
    previewMigration: () => ipcRenderer.invoke("firm-data:preview-migration"),
    applyMigration: (args) => ipcRenderer.invoke("firm-data:apply-migration", args),
  },
  personalData: {
    previewMigration: (destDir) => ipcRenderer.invoke("personal-data:preview-migration", { destDir }),
    applyMigration: (args) => ipcRenderer.invoke("personal-data:apply-migration", args),
    reveal: () => ipcRenderer.invoke("personal-data:reveal"),
  },
  notion: {
    open: (target) => ipcRenderer.invoke("notion:open", { target }),
  },
  agent: {
    availability: () => ipcRenderer.invoke("agent:availability"),
    send: (opts) => ipcRenderer.invoke("agent:send", opts),
    cancel: (requestId) => ipcRenderer.send("agent:cancel", { requestId }),
    /** callback receives { requestId, chunk } for every chunk from any in-flight agent run. */
    onChunk: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("agent:chunk", listener);
      return () => ipcRenderer.removeListener("agent:chunk", listener);
    },
  },
});
