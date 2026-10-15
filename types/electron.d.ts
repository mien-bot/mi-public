export interface ElectronTerminalAPI {
  openLink: (target: string) => Promise<{ opened: "browser" | "file" | "folder" | "revealed" }>;
  resolveWorkspace: (workspace: string) => Promise<string>;
  create: (
    cwd: string,
    cols: number,
    rows: number,
    sessionKey?: string,
  ) => Promise<{ id: number; replay: string; reused: boolean }>;
  write: (id: number, data: string) => void;
  resize: (id: number, cols: number, rows: number) => void;
  kill: (id: number) => void;
  pickProposalFile: (projectSlug: string) => Promise<
    | { canceled: true }
    | {
      canceled: false;
      name: string;
      path: string;
      mtime: string;
      bytes: number;
      rawReply: string;
    }
  >;
  onData: (callback: (payload: { id: number; data: string }) => void) => () => void;
  onExit: (
    callback: (payload: { id: number; exitCode: number; signal?: number }) => void,
  ) => () => void;
}

export interface NotionSyncStatus {
  enabled: boolean;
  intervalMinutes: number;
}

export interface ElectronNotionSyncAPI {
  status: () => Promise<NotionSyncStatus>;
  setInterval: (minutes: number) => Promise<NotionSyncStatus>;
  stop: () => Promise<NotionSyncStatus>;
  start: () => Promise<NotionSyncStatus>;
  /** Refreshes the project/schedule snapshots immediately without changing the enabled/interval setting. */
  runNow: () => Promise<ScheduleSnapshot | null>;
}

/** Mirrors electron/notionSetup.js::refreshScheduleSnapshot's on-disk shape (schedule-snapshot.json). */
export interface ScheduleSnapshotEntry {
  notion_page_id: string;
  name: string;
  /** Start of Notion's Date property. Date-only for all-day entries, timestamp for timed entries. */
  date: string | null;
  /** End of Notion's Date property. This is the calendar event end, not the work-session End Time field. */
  date_end?: string | null;
  /** Work-session tracking fields; never used to position an event on the calendar. */
  start_time: string | null;
  end_time: string | null;
  last_edited_time: string | null;
  type: string[];
  status: string | null;
  hours: number | null;
  attendees: { id: string; name: string | null }[];
  project_page_ids: string[];
}
export interface ScheduleSnapshot {
  schema_version: number;
  generated_at: string;
  window: { from: string; to: string };
  entries: ScheduleSnapshotEntry[];
}

export interface ElectronScheduleAPI {
  getSnapshot: () => Promise<ScheduleSnapshot | null>;
}

export interface PersonalCalendarStatus {
  hasToken: boolean;
  dataSourceId: string | null;
  name: string | null;
  titleProperty: string | null;
  dateProperty: string | null;
}

export interface PersonalCalendarOption {
  id: string;
  name: string;
  titleProperties: string[];
  dateProperties: string[];
  compatible: boolean;
}

export interface ElectronPersonalCalendarAPI {
  status: () => Promise<PersonalCalendarStatus>;
  setToken: (token: string) => Promise<{ hasPersonalNotionToken: boolean }>;
  clearToken: () => Promise<{ hasPersonalNotionToken: boolean }>;
  discover: () => Promise<PersonalCalendarOption[]>;
  select: (selection: {
    dataSourceId: string;
    titleProperty: string;
    dateProperty: string;
  }) => Promise<PersonalCalendarStatus>;
  create: (input: {
    name: string;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
  }, confirmed: boolean) => Promise<{ id: string; url: string }>;
}

export type AgentEngine = "claude" | "codex";
export type AgentScope = "project" | "firm" | "personal" | "leads" | "permit-qaqc" | "schedule";

export interface AgentFileAttachment {
  name: string;
  /** data: URL written to a bounded scratch file by the Electron main process. */
  dataUrl: string;
}

export type AgentImageAttachment = AgentFileAttachment;

export interface AgentSendOptions {
  requestId: string;
  engine: AgentEngine;
  cwd: string;
  prompt: string;
  sessionId?: string | null;
  model?: string | null;
  images?: AgentImageAttachment[];
  attachments?: AgentFileAttachment[];
  /** Personal is Mi-local; firm scopes use the confirmed read-only firm harness. */
  scope?: AgentScope;
  /** Exact selected firm record. Used only to narrow a focused read-only firm conversation. */
  entitySlug?: string;
  entityName?: string;
  /**
   * Present only for a guided-interview step's request. Routes prompt-building
   * through buildInterviewStepPrompt (electron/agentContext.js) instead of the
   * default free-form path, always -- regardless of packaged/session state --
   * so proposal instructions reach the model on every interview step,
   * including in a packaged build. Absent for ordinary chat; existing
   * call sites are unaffected by this field's presence in the type.
   */
  interviewStepId?: string;
  /**
   * Short human-readable summary of fields already known for this interview
   * step (e.g. "team=[...], fee=50000"), so the model doesn't re-propose
   * them. Only meaningful together with interviewStepId.
   */
  interviewAlreadyKnownSummary?: string;
}

export interface AgentSendResult {
  requestId: string;
  sessionId: string | null;
  fullOutput: string;
  exitCode: number | null;
  isError: boolean;
}

export interface ElectronAgentAPI {
  availability: () => Promise<AgentAvailability>;
  send: (opts: AgentSendOptions) => Promise<AgentSendResult>;
  cancel: (requestId: string) => void;
  onChunk: (callback: (payload: { requestId: string; chunk: string }) => void) => () => void;
}

export interface AgentAvailability {
  codex: { available: boolean; version: string | null };
  claude: { available: boolean; version: string | null };
}

export type AgentConnectionKind = "claude-cli" | "codex-cli" | "claude-api" | "openai-api";

export interface AgentConnectionTestResult {
  kind: AgentConnectionKind;
  ok: boolean;
  detail: string;
  version?: string | null;
  model?: string;
  testedAt: string;
}

export interface PartnerSetupConfig {
  schemaVersion: number;
  setupCompleted: boolean;
  dropboxRoot: string | null;
  codeLibraryRoot: string | null;
  timezone: string;
  notionProjectsDataSourceId: string;
  notionScheduleDataSourceId: string;
  codexBin: string | null;
  claudeBin: string | null;
  agentContextMaxBytes: number;
  importedLegacyAt: string | null;
  hasNotionToken: boolean;
  hasPersonalNotionToken: boolean;
  hasClaudeSubscriptionToken: boolean;
  hasClaudeApiKey: boolean;
  hasOpenAiApiKey: boolean;
  dataRoot: string;
  /** Per-machine editable write allowlist; never stored in shared Dropbox data. */
  miConfigPath: string;
  /** Relative to dropboxRoot, like a project's dropbox_path. Null until configured. */
  dropboxFirmDataPath: string | null;
  /** Only true after the confirmed firm-wide clients/leads migration has actually run. */
  dropboxFirmDataMigrated: boolean;
  /** On by default -- a partner may hide the embedded Terminal tab while Studio remains available. */
  terminalPanelEnabled: boolean;
  /** Current Windows Startup Apps state. Defaults on after the first packaged launch. */
  launchAtLogin: boolean;
  /** False in browser/development builds and on non-Windows platforms. */
  launchAtLoginSupported: boolean;
  /**
   * Exact Notion display name as it appears in STUDIO Schedule's Attendance property --
   * same discipline as notion_page_id/dropbox_path: human-confirmed, never guessed or
   * auto-detected (the shared integration token has no per-user identity). Used only to
   * filter schedule entries for "when am I busy/free" chat context. Null until set.
   */
  notionAttendeeName: string | null;
  /** Absolute override for where records.json (journal/thoughts/tasks/plans) lives. Null means
   * the default `<dataRoot>/personal`. Only flips via the confirmed personalData migration
   * flow -- see ElectronPersonalDataAPI. */
  personalDataRootOverride: string | null;
  /** Resolved read location -- personalDataRootOverride if set, otherwise the default. Always
   * local to this machine. */
  personalDataRoot: string;
  /** When true this computer reads and writes the firm's Mi data inside dropboxFirmDataPath
   * instead of its own local dataRoot. Each machine reaches the same shared folder through its
   * own absolute dropboxRoot, so the Dropbox folder's name and location may differ per person
   * while the structure inside it stays identical. */
  sharedDataRootEnabled: boolean;
  personalCalendarDataSourceId: string | null;
  personalCalendarName: string | null;
  personalCalendarTitleProperty: string | null;
  personalCalendarDateProperty: string | null;
}

export interface NotionSetupHealth {
  projects: NotionSourceHealth;
  schedule: NotionSourceHealth;
  capabilities: { read: string; update: string; insert: string };
  mutationCount: 0;
  localSnapshot?: { projectCount: number; generatedAt: string };
  scheduleSnapshot?: { entryCount: number; generatedAt: string; window: { from: string; to: string } };
}

export interface NotionSourceHealth {
  label: string;
  read: "available" | "unavailable";
  id: string | null;
  error: string | null;
  schema: {
    status: "compatible" | "incompatible" | "not-reported" | "unavailable";
    missing: string[];
    incompatible: Array<{ name: string; expected: string[]; actual: string }>;
  };
}

export interface ElectronSetupAPI {
  get: () => Promise<{
    version: string;
    config: PartnerSetupConfig;
    connectionTests: Partial<Record<AgentConnectionKind, AgentConnectionTestResult>>;
  }>;
  revealMiConfig: () => Promise<{ path: string }>;
  pickDropboxRoot: () => Promise<{ path?: string; canceled?: boolean }>;
  pickCodeLibraryRoot: () => Promise<{ path?: string; canceled?: boolean }>;
  pickPersonalDataRoot: () => Promise<{ path?: string; canceled?: boolean }>;
  pickLegacyEnv: () => Promise<{
    path?: string;
    canceled?: boolean;
    hasNotionToken?: boolean;
    hasClaudeSubscriptionToken?: boolean;
    hasClaudeApiKey?: boolean;
    hasOpenAiApiKey?: boolean;
    settings?: Record<string, unknown>;
  }>;
  importLegacy: (path: string, confirmed: boolean) => Promise<PartnerSetupConfig>;
  saveSettings: (settings: Partial<PartnerSetupConfig>) => Promise<PartnerSetupConfig>;
  setNotionToken: (token: string) => Promise<{ hasNotionToken: boolean }>;
  clearNotionToken: () => Promise<{ hasNotionToken: boolean }>;
  setClaudeSubscriptionToken: (token: string) => Promise<{ hasClaudeSubscriptionToken: boolean }>;
  clearClaudeSubscriptionToken: () => Promise<{ hasClaudeSubscriptionToken: boolean }>;
  setClaudeApiKey: (token: string) => Promise<{ hasClaudeApiKey: boolean }>;
  clearClaudeApiKey: () => Promise<{ hasClaudeApiKey: boolean }>;
  setOpenAiApiKey: (token: string) => Promise<{ hasOpenAiApiKey: boolean }>;
  clearOpenAiApiKey: () => Promise<{ hasOpenAiApiKey: boolean }>;
  testAgentConnection: (kind: AgentConnectionKind) => Promise<AgentConnectionTestResult>;
  testNotion: () => Promise<NotionSetupHealth>;
  detectTools: () => Promise<AgentAvailability>;
  finish: () => Promise<PartnerSetupConfig>;
  restartServer: () => Promise<void>;
}

export interface HarnessEntry {
  relativePath: string;
  action: "create" | "update" | "preserve" | "conflict";
  existingHash: string | null;
  desiredHash: string;
}

export interface ElectronHarnessAPI {
  preview: (slug: string) => Promise<{ previewId: string; entries: HarnessEntry[]; dropboxPath: string }>;
  apply: (previewId: string, confirmed: boolean) => Promise<{
    results: Array<{ relativePath: string; status: string; error?: string }>;
  }>;
  previewAll: () => Promise<AllProjectHarnessPreview>;
  applyAll: (previewId: string, confirmed: boolean) => Promise<AllProjectHarnessApplyResult>;
}

export interface ElectronPermitQaqcHarnessAPI {
  preview: (slug: string) => Promise<{ previewId: string; entries: HarnessEntry[]; dropboxPath: string | null }>;
  apply: (previewId: string, confirmed: boolean) => Promise<{
    results: Array<{ relativePath: string; status: string; error?: string }>;
  }>;
}

export interface ElectronLeadHarnessAPI {
  preview: (slug: string) => Promise<{ previewId: string; entries: HarnessEntry[]; dropboxPath: string | null }>;
  apply: (previewId: string, confirmed: boolean) => Promise<{
    results: Array<{ relativePath: string; status: string; error?: string }>;
  }>;
}

export interface AllProjectHarnessPreviewEntry {
  relativePath: string;
  action: HarnessEntry["action"];
}

export type AllProjectHarnessPreviewProject =
  | {
      previewId: string;
      name: string;
      slug: string;
      dropboxPath: string;
      status: "ready";
      entries: AllProjectHarnessPreviewEntry[];
    }
  | {
      name: string;
      slug: string;
      dropboxPath: string | null;
      status: "error";
      error: string;
    };

export interface AllProjectHarnessPreview {
  previewId: string;
  projects: AllProjectHarnessPreviewProject[];
  skipped: Array<{ name: string; slug: string; reason: string }>;
}

export type AllProjectHarnessApplyProject =
  | {
      previewId: string;
      name: string;
      slug: string;
      dropboxPath: string;
      status: "applied" | "partial";
      results: Array<{ relativePath: string; status: string; error?: string }>;
    }
  | {
      previewId: string;
      name: string;
      slug: string;
      dropboxPath: string;
      status: "failed";
      error: string;
    };

export interface AllProjectHarnessApplyResult {
  projects: AllProjectHarnessApplyProject[];
}

export interface ElectronPreferencesAPI {
  getTimezone: () => Promise<string>;
  setTimezone: (timezone: string) => Promise<string>;
}

/** Per-kind record counts in one data root. Null means that kind's folder is absent entirely,
 * which is different from a synced folder holding zero records. */
export interface SharedDataCounts {
  projects: number | null;
  leads: number | null;
  clients: number | null;
  permitQaqc: number | null;
}

/** Read-only comparison of the candidate shared Dropbox folder against this computer's own
 * local data root -- see electron/sharedDataInspection.js. */
export interface SharedDataInspection {
  relativePath: string | null;
  absolutePath: string | null;
  reachable: boolean;
  error: string | null;
  /** Whether this computer currently reads the shared folder rather than its local root. */
  usingAsDataSource: boolean;
  shared: SharedDataCounts | null;
  local: SharedDataCounts | null;
  sharedTotal: number;
  localTotal: number;
}

/** Ctrl/Cmd + wheel and pinch zoom; the gesture is read in the renderer, applied in main. */
export interface ElectronZoomAPI {
  step: (action: "in" | "out" | "reset") => Promise<number | null>;
}

export interface ElectronDropboxAPI {
  pickProjectFolder: () => Promise<{ relativePath?: string; canceled?: boolean; error?: string }>;
  pickSharedFolder: () => Promise<{ relativePath?: string; canceled?: boolean; error?: string }>;
  /** Pass an unsaved draft path to check it before committing the setting. */
  inspectSharedData: (relativePath?: string | null) => Promise<SharedDataInspection>;
  /** Proposes folders that already hold Mi records. Never applies one -- the human confirms. */
  findSharedData: () => Promise<{ error: string | null; candidates: SharedDataCandidate[] }>;
}

/** A folder inside the Dropbox root that already holds Mi records, matched by contents. */
export interface SharedDataCandidate {
  relativePath: string;
  counts: SharedDataCounts;
  total: number;
}

export interface ElectronNotionAPI {
  open: (target: string) => Promise<{ opened: "native" | "https"; url: string }>;
}

export interface FirmDataMigrationPreviewEntry {
  relativePath: string;
  status: "will-copy" | "identical" | "needs-review";
  sourceHash: string;
  destHash: string | null;
}

export interface FirmDataMigrationPreview {
  sourceDir: string;
  destDir: string;
  entries: FirmDataMigrationPreviewEntry[];
}

export interface FirmDataMigrationResultEntry {
  relativePath: string;
  status: "copied" | "skipped" | "failed";
  error?: string;
}

export interface ElectronFirmDataAPI {
  previewMigration: () => Promise<{ clients: FirmDataMigrationPreview; leads: FirmDataMigrationPreview }>;
  applyMigration: (args: {
    clientsPreview: FirmDataMigrationPreview;
    leadsPreview: FirmDataMigrationPreview;
    includeRelativePaths: string[];
    confirmed: boolean;
  }) => Promise<{
    clients: FirmDataMigrationResultEntry[];
    leads: FirmDataMigrationResultEntry[];
    migrationComplete: boolean;
  }>;
}

export interface PersonalDataMigrationPreview {
  sourceDir: string;
  destDir: string;
  status: "nothing-to-copy" | "will-copy" | "identical" | "needs-review";
  sourceHash: string | null;
  destHash: string | null;
}

export interface PersonalDataMigrationResult {
  copied: boolean;
  status: "nothing-to-copy" | "identical" | "copied" | "needs-review";
  error?: string;
  /** Only present after a successful (non-needs-review) apply. */
  personalDataRoot?: string;
}

export interface ElectronPersonalDataAPI {
  previewMigration: (destDir: string) => Promise<PersonalDataMigrationPreview>;
  applyMigration: (args: {
    preview: PersonalDataMigrationPreview;
    confirmed: boolean;
    confirmOverwrite?: boolean;
  }) => Promise<PersonalDataMigrationResult>;
  /** Opens the current personal-data folder in the OS file manager. */
  reveal: () => Promise<void>;
}

/** A Mi surface that can live in its own pinned pop-out card window. */
export type MiPaneKind = "chat" | "terminal";

export interface MiPaneTarget {
  /** Chat panes only. */
  projectSlug?: string;
  /** Chat panes only. */
  scope?: "firm" | "personal";
  /** Terminal panes only: the relative workspace cwd, e.g. "projects/<slug>". */
  workspace?: string;
  session?: string;
}

export interface MiPaneState {
  /** The chat card is open and on screen. */
  chat: boolean;
  /** Project slug the chat card is pointed at; null for firm-wide and personal chat. */
  chatProject: string | null;
  /** Workspace cwd the terminal card is showing, or null when no terminal card is on screen. */
  terminalWorkspace: string | null;
  terminals: { workspace: string; session: string }[];
}

export interface ElectronAPI {
  isElectron: true;
  windows: {
    newChat: (path?: "/" | "/personal" | "/leads" | "/permit-qaqc" | `/leads/${string}/chat`) => Promise<{ opened: boolean }>;
    openCompactChat: (projectSlug?: string, scope?: "firm" | "personal") => Promise<{ opened: boolean }>;
    compactChatAction: (
      action: "hide" | "minimize" | "toggle-pin" | "collapse",
      collapsed?: boolean,
    ) => Promise<{ visible: boolean; pinned: boolean }>;
    openPane: (kind: MiPaneKind, target?: MiPaneTarget) => Promise<{ opened: boolean }>;
    closePane: (kind: MiPaneKind, target?: MiPaneTarget) => Promise<MiPaneState>;
    paneState: () => Promise<MiPaneState>;
    paneAction: (
      action: "hide" | "minimize" | "toggle-pin" | "collapse",
      collapsed?: boolean,
    ) => Promise<{ visible: boolean; pinned: boolean }>;
    onPaneState: (callback: (state: MiPaneState) => void) => () => void;
  };
  setup: ElectronSetupAPI;
  diagnostics: { export: () => Promise<{ saved?: boolean; canceled?: boolean }> };
  harness: ElectronHarnessAPI;
  permitQaqcHarness: ElectronPermitQaqcHarnessAPI;
  leadHarness: ElectronLeadHarnessAPI;
  terminal: ElectronTerminalAPI;
  notionSync: ElectronNotionSyncAPI;
  agent: ElectronAgentAPI;
  preferences: ElectronPreferencesAPI;
  zoom: ElectronZoomAPI;
  dropbox: ElectronDropboxAPI;
  firmData: ElectronFirmDataAPI;
  personalData: ElectronPersonalDataAPI;
  notion: ElectronNotionAPI;
  schedule: ElectronScheduleAPI;
  personalCalendar: ElectronPersonalCalendarAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
