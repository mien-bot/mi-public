const fs = require("node:fs");
const path = require("node:path");
const { renameDurably, retryWhileLocked } = require("./durableRename");

const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_PROJECTS_SOURCE = "";
const DEFAULT_SCHEDULE_SOURCE = "";
const IMPORT_KEYS = new Set([
  "NOTION_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DROPBOX_ROOT",
  "MI_CODE_LIBRARY_ROOT",
  "NOTION_PROJECTS_DATA_SOURCE_ID",
  "NOTION_SCHEDULE_DATA_SOURCE_ID",
  "MI_CODEX_BIN",
  "MI_CLAUDE_BIN",
  "MI_AGENT_CONTEXT_MAX_BYTES",
  "DROPBOX_FIRM_DATA_PATH",
]);
const CREDENTIAL_FIELDS = ["notionToken", "personalNotionToken", "claudeSubscriptionToken", "claudeApiKey", "openAiApiKey"];
const CONNECTION_TEST_KINDS = new Set(["claude-cli", "codex-cli", "claude-api", "openai-api"]);

function validTimezone(value) {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value === "UTC" || value.includes("/");
  } catch {
    return false;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const backupDir = path.join(path.dirname(filePath), "backups");
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  if (fs.existsSync(filePath)) {
    fs.mkdirSync(backupDir, { recursive: true });
    retryWhileLocked(() => fs.copyFileSync(filePath, path.join(backupDir, `${path.basename(filePath)}.previous`)));
  }
  renameDurably(temporary, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function defaultSettings() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    setupCompleted: false,
    dropboxRoot: null,
    codeLibraryRoot: null,
    timezone: DEFAULT_TIMEZONE,
    notionProjectsDataSourceId: DEFAULT_PROJECTS_SOURCE,
    notionScheduleDataSourceId: DEFAULT_SCHEDULE_SOURCE,
    codexBin: null,
    claudeBin: null,
    agentContextMaxBytes: 250_000,
    importedLegacyAt: null,
    // Background, read-only refresh of data/notion/project-map.json while the desktop app
    // is open. Never writes project.yaml/schedule.yaml — see notion-sync IPC in desktopMain.js.
    notionSyncEnabled: true,
    notionSyncIntervalMinutes: 240,
    // Terminal is a first-class project workspace. It stays optional so a
    // partner can hide the embedded tab, while Mi Studio remains available.
    terminalPanelEnabled: true,
    // Enabled once on the first packaged Windows launch. The configured marker prevents a
    // later launch from silently undoing a choice made in Mi or Windows Startup Apps.
    launchAtLogin: true,
    launchAtLoginConfigured: false,
    // Exact Notion display name in STUDIO Schedule's Attendance property -- same
    // human-confirmed, never-guessed convention as notion_page_id/dropbox_path. Used
    // only to filter schedule entries for "when am I busy/free" chat context.
    notionAttendeeName: null,
    // Firm-wide (not per-project) shared location for clients/leads, relative to
    // dropboxRoot -- same human-confirmed, never-guessed convention as a project's
    // dropbox_path. dropboxFirmDataMigrated only flips via the confirmed migration flow
    // (lib/content/contentMigration.ts), never just by setting the path, so the two can't
    // collapse into the same instant.
    dropboxFirmDataPath: null,
    dropboxFirmDataMigrated: false,
    // Separate from the clients/leads migration flag. This only becomes true after a
    // human confirms that the complete structured Mi dataset has been seeded at the
    // configured shared path. Credentials and personal settings always remain local.
    sharedDataRootEnabled: false,
    // Absolute path override for where records.json (journal/thoughts/tasks/plans) lives.
    // Null means the default <dataRoot>/personal. Only flips via the confirmed
    // electron/personalDataMigration.js copy flow, which the renderer calls before saving
    // this setting -- so the new location always already has the data by the time this
    // takes effect on the next server restart. Personal data always stays local to this
    // machine regardless of where it points.
    personalDataRootOverride: null,
    // Optional private Notion calendar. The ID and property names are saved only after the
    // human selects an exact data source returned by that separately scoped integration.
    personalCalendarDataSourceId: null,
    personalCalendarName: null,
    personalCalendarTitleProperty: null,
    personalCalendarDateProperty: null,
  };
}

function normalizeSettings(input) {
  const defaults = defaultSettings();
  const max = Number(input?.agentContextMaxBytes);
  return {
    ...defaults,
    ...input,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    setupCompleted: input?.setupCompleted === true,
    dropboxRoot: typeof input?.dropboxRoot === "string" && input.dropboxRoot.trim()
      ? path.resolve(input.dropboxRoot)
      : null,
    codeLibraryRoot: typeof input?.codeLibraryRoot === "string" && input.codeLibraryRoot.trim()
      ? path.resolve(input.codeLibraryRoot)
      : null,
    timezone: validTimezone(input?.timezone) ? input.timezone : DEFAULT_TIMEZONE,
    notionProjectsDataSourceId: input?.notionProjectsDataSourceId || DEFAULT_PROJECTS_SOURCE,
    notionScheduleDataSourceId: input?.notionScheduleDataSourceId || DEFAULT_SCHEDULE_SOURCE,
    codexBin: typeof input?.codexBin === "string" && input.codexBin.trim() ? input.codexBin.trim() : null,
    claudeBin: typeof input?.claudeBin === "string" && input.claudeBin.trim() ? input.claudeBin.trim() : null,
    agentContextMaxBytes: Number.isInteger(max) && max > 0 ? max : defaults.agentContextMaxBytes,
    notionSyncEnabled: input?.notionSyncEnabled !== false,
    terminalPanelEnabled: input?.terminalPanelEnabled !== false,
    launchAtLogin: input?.launchAtLogin !== false,
    launchAtLoginConfigured: input?.launchAtLoginConfigured === true,
    notionAttendeeName: typeof input?.notionAttendeeName === "string" && input.notionAttendeeName.trim()
      ? input.notionAttendeeName.trim()
      : null,
    notionSyncIntervalMinutes: Number.isInteger(Number(input?.notionSyncIntervalMinutes)) && Number(input.notionSyncIntervalMinutes) > 0
      ? Number(input.notionSyncIntervalMinutes)
      : defaults.notionSyncIntervalMinutes,
    // Relative to dropboxRoot, like a project's dropbox_path -- never path.resolve()'d here.
    dropboxFirmDataPath: typeof input?.dropboxFirmDataPath === "string" && input.dropboxFirmDataPath.trim()
      ? input.dropboxFirmDataPath.trim()
      : null,
    dropboxFirmDataMigrated: input?.dropboxFirmDataMigrated === true,
    sharedDataRootEnabled: input?.sharedDataRootEnabled === true,
    personalDataRootOverride: typeof input?.personalDataRootOverride === "string" && input.personalDataRootOverride.trim()
      ? path.resolve(input.personalDataRootOverride)
      : null,
    personalCalendarDataSourceId: typeof input?.personalCalendarDataSourceId === "string" && input.personalCalendarDataSourceId.trim()
      ? input.personalCalendarDataSourceId.trim()
      : null,
    personalCalendarName: typeof input?.personalCalendarName === "string" && input.personalCalendarName.trim()
      ? input.personalCalendarName.trim().slice(0, 200)
      : null,
    personalCalendarTitleProperty: typeof input?.personalCalendarTitleProperty === "string" && input.personalCalendarTitleProperty.trim()
      ? input.personalCalendarTitleProperty.trim().slice(0, 200)
      : null,
    personalCalendarDateProperty: typeof input?.personalCalendarDateProperty === "string" && input.personalCalendarDateProperty.trim()
      ? input.personalCalendarDateProperty.trim().slice(0, 200)
      : null,
  };
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !IMPORT_KEYS.has(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function createConfigStore({ userDataPath, secureStorage, miConfigPath: configuredMiConfigPath }) {
  const configDir = path.join(userDataPath, "config");
  const settingsPath = path.join(configDir, "settings.json");
  const credentialsPath = path.join(configDir, "credentials.json");
  const connectionTestsPath = path.join(configDir, "connection-tests.json");
  const dataRoot = path.join(userDataPath, "data");
  const miConfigPath = configuredMiConfigPath || path.join(configDir, "mi.config.yaml");

  function initialize() {
    for (const dir of ["projects", "clients", "leads", "codes", "reference", "library", "notion"]) {
      fs.mkdirSync(path.join(dataRoot, dir), { recursive: true });
    }
    if (!fs.existsSync(settingsPath)) atomicWriteJson(settingsPath, defaultSettings());
    return getPublicConfig();
  }

  function getSettings() {
    return normalizeSettings(readJson(settingsPath, {}));
  }

  function getCredentials() {
    return readJson(credentialsPath, {});
  }

  function getConnectionTests() {
    const stored = readJson(connectionTestsPath, {});
    return Object.fromEntries(Object.entries(stored).filter(([kind, result]) => (
      CONNECTION_TEST_KINDS.has(kind)
      && result
      && typeof result === "object"
      && typeof result.ok === "boolean"
      && typeof result.detail === "string"
      && typeof result.testedAt === "string"
    )));
  }

  function setConnectionTest(result) {
    if (!result || !CONNECTION_TEST_KINDS.has(result.kind)) throw new Error("Unsupported connection test result.");
    const safe = {
      kind: result.kind,
      ok: result.ok === true,
      detail: String(result.detail || "Connection test completed.").slice(0, 500),
      testedAt: new Date().toISOString(),
      ...(typeof result.version === "string" ? { version: result.version.slice(0, 200) } : {}),
      ...(typeof result.model === "string" ? { model: result.model.slice(0, 100) } : {}),
    };
    atomicWriteJson(connectionTestsPath, { ...getConnectionTests(), [safe.kind]: safe });
    return safe;
  }

  function clearConnectionTest(kind) {
    if (!CONNECTION_TEST_KINDS.has(kind)) return;
    const stored = getConnectionTests();
    if (!(kind in stored)) return;
    delete stored[kind];
    if (Object.keys(stored).length === 0) fs.rmSync(connectionTestsPath, { force: true });
    else atomicWriteJson(connectionTestsPath, stored);
  }

  function hasCredential(field) {
    const credentials = getCredentials();
    return typeof credentials[field] === "string" && credentials[field].length > 0;
  }

  function purgeCredentialBackups() {
    const backupDir = path.join(configDir, "backups");
    if (!fs.existsSync(backupDir)) return;
    for (const entry of fs.readdirSync(backupDir)) {
      if (entry.startsWith(`${path.basename(credentialsPath)}.`)) {
        fs.rmSync(path.join(backupDir, entry), { force: true });
      }
    }
  }

  function getPublicConfig() {
    const settings = getSettings();
    return {
      ...settings,
      hasNotionToken: hasCredential("notionToken"),
      hasPersonalNotionToken: hasCredential("personalNotionToken"),
      hasClaudeSubscriptionToken: hasCredential("claudeSubscriptionToken"),
      hasClaudeApiKey: hasCredential("claudeApiKey"),
      hasOpenAiApiKey: hasCredential("openAiApiKey"),
      dataRoot,
      miConfigPath,
      // Resolved read location -- mirrors the MI_PERSONAL_DATA_ROOT construction in
      // desktopMain.js's server spawn so the Settings UI always shows where Mi is actually
      // reading from, not just the raw override setting.
      personalDataRoot: settings.personalDataRootOverride || path.join(dataRoot, "personal"),
    };
  }

  function updateSettings(patch) {
    const next = normalizeSettings({ ...getSettings(), ...patch });
    atomicWriteJson(settingsPath, next);
    return getPublicConfig();
  }

  function validatedCredential(token, message) {
    if (
      typeof token !== "string"
      || !token.trim()
      || token.length > 16_384
      || /[\0\r\n]/.test(token)
    ) {
      throw new Error(message);
    }
    return token.trim();
  }

  async function setCredential(field, token, validationMessage) {
    const value = validatedCredential(token, validationMessage);
    if (!(await secureStorage.isAvailable())) throw new Error("Secure credential storage is unavailable.");
    const encrypted = await secureStorage.encrypt(value);
    atomicWriteJson(credentialsPath, {
      ...getCredentials(),
      schemaVersion: CONFIG_SCHEMA_VERSION,
      [field]: Buffer.from(encrypted).toString("base64"),
    });
  }

  async function getCredential(field, setter) {
    const credentials = getCredentials();
    if (typeof credentials[field] !== "string") return null;
    const result = await secureStorage.decrypt(Buffer.from(credentials[field], "base64"));
    const plainText = typeof result === "string" ? result : result?.plainText;
    if (typeof plainText !== "string") return null;
    if (result?.shouldReEncrypt) await setter(plainText);
    return plainText;
  }

  function clearCredential(field, publicField) {
    const credentials = getCredentials();
    delete credentials[field];
    const remainingFields = CREDENTIAL_FIELDS
      .filter((candidate) => typeof credentials[candidate] === "string");
    if (remainingFields.length > 0) {
      atomicWriteJson(credentialsPath, {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        ...Object.fromEntries(remainingFields.map((candidate) => [candidate, credentials[candidate]])),
      });
    } else {
      fs.rmSync(credentialsPath, { force: true });
    }
    purgeCredentialBackups();
    return { [publicField]: false };
  }

  async function setNotionToken(token) {
    await setCredential("notionToken", token, "Enter a Notion integration token.");
    return { hasNotionToken: true };
  }

  async function getNotionToken() {
    return getCredential("notionToken", setNotionToken);
  }

  function clearNotionToken() {
    return clearCredential("notionToken", "hasNotionToken");
  }

  async function setPersonalNotionToken(token) {
    await setCredential("personalNotionToken", token, "Enter a personal Notion integration token.");
    return { hasPersonalNotionToken: true };
  }

  async function getPersonalNotionToken() {
    return getCredential("personalNotionToken", setPersonalNotionToken);
  }

  function clearPersonalNotionToken() {
    updateSettings({
      personalCalendarDataSourceId: null,
      personalCalendarName: null,
      personalCalendarTitleProperty: null,
      personalCalendarDateProperty: null,
    });
    return clearCredential("personalNotionToken", "hasPersonalNotionToken");
  }

  async function setClaudeSubscriptionToken(token) {
    await setCredential(
      "claudeSubscriptionToken",
      token,
      "Enter a valid Claude subscription token generated by claude setup-token.",
    );
    clearConnectionTest("claude-cli");
    return { hasClaudeSubscriptionToken: true };
  }

  async function getClaudeSubscriptionToken() {
    return getCredential("claudeSubscriptionToken", setClaudeSubscriptionToken);
  }

  function clearClaudeSubscriptionToken() {
    clearConnectionTest("claude-cli");
    return clearCredential("claudeSubscriptionToken", "hasClaudeSubscriptionToken");
  }

  async function setClaudeApiKey(token) {
    await setCredential("claudeApiKey", token, "Enter a valid Claude API key.");
    clearConnectionTest("claude-api");
    return { hasClaudeApiKey: true };
  }

  async function getClaudeApiKey() {
    return getCredential("claudeApiKey", setClaudeApiKey);
  }

  function clearClaudeApiKey() {
    clearConnectionTest("claude-api");
    return clearCredential("claudeApiKey", "hasClaudeApiKey");
  }

  async function setOpenAiApiKey(token) {
    await setCredential("openAiApiKey", token, "Enter a valid OpenAI API key.");
    clearConnectionTest("openai-api");
    return { hasOpenAiApiKey: true };
  }

  async function getOpenAiApiKey() {
    return getCredential("openAiApiKey", setOpenAiApiKey);
  }

  function clearOpenAiApiKey() {
    clearConnectionTest("openai-api");
    return clearCredential("openAiApiKey", "hasOpenAiApiKey");
  }

  function previewLegacyEnv(envPath) {
    const values = parseEnv(fs.readFileSync(envPath, "utf8"));
    return {
      path: path.resolve(envPath),
      hasNotionToken: Boolean(values.NOTION_API_KEY),
      hasClaudeSubscriptionToken: Boolean(values.CLAUDE_CODE_OAUTH_TOKEN),
      hasClaudeApiKey: Boolean(values.ANTHROPIC_API_KEY),
      hasOpenAiApiKey: Boolean(values.OPENAI_API_KEY),
      settings: {
        dropboxRoot: values.DROPBOX_ROOT || null,
        codeLibraryRoot: values.MI_CODE_LIBRARY_ROOT || null,
        notionProjectsDataSourceId: values.NOTION_PROJECTS_DATA_SOURCE_ID || null,
        notionScheduleDataSourceId: values.NOTION_SCHEDULE_DATA_SOURCE_ID || null,
        codexBin: values.MI_CODEX_BIN || null,
        claudeBin: values.MI_CLAUDE_BIN || null,
        agentContextMaxBytes: values.MI_AGENT_CONTEXT_MAX_BYTES
          ? Number(values.MI_AGENT_CONTEXT_MAX_BYTES)
          : null,
        dropboxFirmDataPath: values.DROPBOX_FIRM_DATA_PATH || null,
      },
    };
  }

  async function importLegacyEnv(envPath, { confirmed }) {
    if (confirmed !== true) throw new Error("Legacy import requires explicit confirmation.");
    const values = parseEnv(fs.readFileSync(envPath, "utf8"));
    const patch = {
      dropboxRoot: values.DROPBOX_ROOT || getSettings().dropboxRoot,
      codeLibraryRoot: values.MI_CODE_LIBRARY_ROOT || getSettings().codeLibraryRoot,
      notionProjectsDataSourceId:
        values.NOTION_PROJECTS_DATA_SOURCE_ID || getSettings().notionProjectsDataSourceId,
      notionScheduleDataSourceId:
        values.NOTION_SCHEDULE_DATA_SOURCE_ID || getSettings().notionScheduleDataSourceId,
      codexBin: values.MI_CODEX_BIN || getSettings().codexBin,
      claudeBin: values.MI_CLAUDE_BIN || getSettings().claudeBin,
      agentContextMaxBytes: values.MI_AGENT_CONTEXT_MAX_BYTES
        ? Number(values.MI_AGENT_CONTEXT_MAX_BYTES)
        : getSettings().agentContextMaxBytes,
      dropboxFirmDataPath: values.DROPBOX_FIRM_DATA_PATH || getSettings().dropboxFirmDataPath,
      importedLegacyAt: new Date().toISOString(),
    };
    updateSettings(patch);
    if (values.NOTION_API_KEY) await setNotionToken(values.NOTION_API_KEY);
    if (values.CLAUDE_CODE_OAUTH_TOKEN) {
      await setClaudeSubscriptionToken(values.CLAUDE_CODE_OAUTH_TOKEN);
    }
    if (values.ANTHROPIC_API_KEY) await setClaudeApiKey(values.ANTHROPIC_API_KEY);
    if (values.OPENAI_API_KEY) await setOpenAiApiKey(values.OPENAI_API_KEY);
    return getPublicConfig();
  }

  return {
    initialize,
    getSettings,
    getPublicConfig,
    getConnectionTests,
    setConnectionTest,
    clearConnectionTest,
    updateSettings,
    setNotionToken,
    getNotionToken,
    clearNotionToken,
    setPersonalNotionToken,
    getPersonalNotionToken,
    clearPersonalNotionToken,
    setClaudeSubscriptionToken,
    getClaudeSubscriptionToken,
    clearClaudeSubscriptionToken,
    setClaudeApiKey,
    getClaudeApiKey,
    clearClaudeApiKey,
    setOpenAiApiKey,
    getOpenAiApiKey,
    clearOpenAiApiKey,
    previewLegacyEnv,
    importLegacyEnv,
    dataRoot,
  };
}

module.exports = {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_TIMEZONE,
  DEFAULT_PROJECTS_SOURCE,
  DEFAULT_SCHEDULE_SOURCE,
  atomicWriteJson,
  createConfigStore,
  parseEnv,
  validTimezone,
};
