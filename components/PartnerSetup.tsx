"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeIanaTimezone,
  DETERMINISTIC_TIMEZONE_OPTIONS,
  getRuntimeTimezoneOptions,
  includeTimezoneOption,
} from "@/lib/content/timezoneOptions";
import { ClaudeSubscriptionTokenField } from "@/components/ClaudeSubscriptionTokenField";
import { ClaudeApiKeyField } from "@/components/ClaudeApiKeyField";
import { OpenAiApiKeyField } from "@/components/OpenAiApiKeyField";
import { FirmDataMigrationPanel } from "@/components/FirmDataMigrationPanel";
import { SharedMiDataSetup } from "@/components/SharedMiDataSetup";
import { NotionHealthPanel } from "@/components/NotionHealthPanel";
import { ActivityIndicator } from "@/components/UiState";
import type {
  AgentConnectionKind,
  AgentConnectionTestResult,
  NotionSetupHealth,
  PartnerSetupConfig,
} from "@/types/electron";

/** Settings that electron/desktopMain.js's trustedServerEnvironment passes to the local server
 * at spawn time, and which therefore only take effect on the next restart. */
const SERVER_ENVIRONMENT_SETTINGS = [
  "dropboxRoot",
  "codeLibraryRoot",
  "dropboxFirmDataPath",
  "timezone",
  "notionProjectsDataSourceId",
  "notionScheduleDataSourceId",
  "codexBin",
  "claudeBin",
  "agentContextMaxBytes",
  "sharedDataRootEnabled",
] as const satisfies readonly (keyof PartnerSetupConfig)[];

/** Everything "Save local settings" actually writes -- used to tell whether a draft is dirty. */
const SAVED_SETTINGS = [
  ...SERVER_ENVIRONMENT_SETTINGS,
  "terminalPanelEnabled",
  "launchAtLogin",
  "notionAttendeeName",
] as const satisfies readonly (keyof PartnerSetupConfig)[];

/** A cleared text field reads as "" while the stored value is null; they mean the same thing. */
function sameSetting(a: unknown, b: unknown): boolean {
  return (a === "" ? null : a ?? null) === (b === "" ? null : b ?? null);
}

export function PartnerSetup() {
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState("");
  const [config, setConfig] = useState<PartnerSetupConfig | null>(null);
  const [draft, setDraft] = useState<Partial<PartnerSetupConfig>>({});
  const tokenInput = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<NotionSetupHealth | null>(null);
  const [agentTests, setAgentTests] = useState<Partial<Record<AgentConnectionKind, AgentConnectionTestResult>>>({});
  const [message, setMessage] = useState("");
  const [messageState, setMessageState] = useState<"success" | "error">("success");
  const [dropboxCopyMessage, setDropboxCopyMessage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [legacy, setLegacy] = useState<{
    path: string;
    hasNotionToken: boolean;
    hasClaudeSubscriptionToken: boolean;
    hasClaudeApiKey: boolean;
    hasOpenAiApiKey: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const baseTimezoneOptions = useMemo(
    () => mounted ? getRuntimeTimezoneOptions() : DETERMINISTIC_TIMEZONE_OPTIONS,
    [mounted],
  );
  const timezoneOptions = useMemo(
    () => includeTimezoneOption(baseTimezoneOptions, draft.timezone || config?.timezone),
    [baseTimezoneOptions, config?.timezone, draft.timezone],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Electron preload exists only after hydration
    setMounted(true);
    const api = window.electronAPI?.setup;
    if (!api) return;
    api.get().then(({ version: value, config: next, connectionTests }) => {
      setVersion(value);
      setConfig(next);
      setDraft(next);
      setAgentTests(connectionTests ?? {});
    });
  }, []);

  if (!mounted) return <ActivityIndicator label="Loading local setup…" className="text-sm" />;

  if (!window.electronAPI) {
    return (
      <section className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        Partner setup is available in the installed Mi desktop app. Browser development ignores
        local environment settings and cannot use the operating system credential store.
      </section>
    );
  }

  if (!config) return <ActivityIndicator label="Loading local setup…" className="text-sm" />;
  const api = window.electronAPI.setup;
  const unsavedChanges = SAVED_SETTINGS.some((key) => !sameSetting(draft[key], config[key]));

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setMessageState("success");
    try {
      await work();
    } catch (error) {
      setMessageState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const timezone = canonicalizeIanaTimezone(draft.timezone || "America/Chicago");
    if (!timezone) throw new Error("Select a valid IANA timezone.");
    const previous = config;
    const next = await api.saveSettings({
      dropboxRoot: draft.dropboxRoot || null,
      codeLibraryRoot: draft.codeLibraryRoot || null,
      timezone,
      notionProjectsDataSourceId: draft.notionProjectsDataSourceId,
      notionScheduleDataSourceId: draft.notionScheduleDataSourceId,
      codexBin: draft.codexBin || null,
      claudeBin: draft.claudeBin || null,
      agentContextMaxBytes: draft.agentContextMaxBytes,
      dropboxFirmDataPath: draft.dropboxFirmDataPath || null,
      terminalPanelEnabled: draft.terminalPanelEnabled === true,
      launchAtLogin: draft.launchAtLogin === true,
      notionAttendeeName: draft.notionAttendeeName || null,
      sharedDataRootEnabled: draft.sharedDataRootEnabled === true,
    });
    setConfig(next);
    setDraft(next);
    // These are baked into the local server's environment when it spawns, so persisting them
    // isn't enough -- until the server restarts, every page keeps reading the old Dropbox root
    // and the save looks like it silently did nothing.
    if (SERVER_ENVIRONMENT_SETTINGS.some((key) => previous?.[key] !== next[key])) {
      setMessage("Local settings saved; restarting the local server so the new paths take effect…");
      await api.restartServer();
      return;
    }
    setMessage("Local settings saved.");
  }

  async function testAgent(kind: AgentConnectionKind) {
    const result = await api.testAgentConnection(kind);
    setAgentTests((current) => ({ ...current, [kind]: result }));
  }

  async function copyDropboxPath() {
    const dropboxRoot = config?.dropboxRoot?.trim();
    setDropboxCopyMessage("");
    if (!dropboxRoot) {
      setDropboxCopyMessage("Choose and save a local STUDIO Dropbox root before copying it.");
      return;
    }
    if (draft.dropboxRoot !== config?.dropboxRoot) {
      setDropboxCopyMessage("Save the selected Dropbox root before copying it for handoff.");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(dropboxRoot);
      setDropboxCopyMessage("Copied this computer's local Dropbox path for setup handoff.");
    } catch {
      setDropboxCopyMessage("Could not copy the path. Select the visible path and copy it manually.");
    }
  }

  return (
    <section className="surface-depth rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {config.setupCompleted ? "Partner configuration" : "First-run setup"}
          </p>
          <h2 className="mt-1 font-display text-xl font-light">Connections</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Connect Mi {version} to the firm&apos;s shared records, Notion, and an optional AI
            assistant. Credentials and machine paths stay on this computer.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs">
          {config.setupCompleted ? "Setup complete" : "Setup required"}
        </span>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3" aria-label="Connection status">
        <ConnectionStatus
          label="Shared STUDIO records"
          ready={Boolean(config.dropboxRoot && config.dropboxFirmDataPath) && config.sharedDataRootEnabled}
          readyText="Connected through Dropbox"
          missingText="Choose the shared folder"
        />
        <ConnectionStatus label="Notion" ready={config.hasNotionToken} readyText="Credential stored" missingText="Token needed" />
        <ConnectionStatus label="AI connections" ready={config.hasClaudeSubscriptionToken || config.hasOpenAiApiKey} readyText="A credential is stored" missingText="Test an option below" neutral={!config.hasClaudeSubscriptionToken && !config.hasOpenAiApiKey} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Shared STUDIO records</h3>
              <p className="mt-1 text-xs text-muted-foreground">Choose your local STUDIO Dropbox, then the shared Mi records folder inside it.</p>
            </div>
            {/* Choosing a folder only updates the draft, and the page's Save button is far
                enough below these fields to read as "there is no way to save this". */}
            {unsavedChanges && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(saveSettings)}
                className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                Save these changes
              </button>
            )}
          </div>
          {unsavedChanges && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              Unsaved changes on this computer. Saving a path also restarts the local server so it takes effect.
            </p>
          )}
        </div>
        <SetupField
          label="Your STUDIO Dropbox location"
          value={draft.dropboxRoot || ""}
          description={
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Each partner selects their own local path. Mi stores it only on this computer.
              </p>
              {dropboxCopyMessage && <p role="status">{dropboxCopyMessage}</p>}
            </div>
          }
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(async () => {
              const result = await api.pickDropboxRoot();
              if (result.path) setDraft((current) => ({ ...current, dropboxRoot: result.path }));
            })}
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Choose STUDIO Dropbox
          </button>
          {showAdvanced && <button
            type="button"
            disabled={busy}
            onClick={() => void copyDropboxPath()}
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Copy path for handoff
          </button>}
        </SetupField>
        {showAdvanced && <SetupField label="Code-library folder (optional)" value={draft.codeLibraryRoot || "Not configured"}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(async () => {
              const result = await api.pickCodeLibraryRoot();
              if (result.path) setDraft((current) => ({ ...current, codeLibraryRoot: result.path }));
            })}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Choose folder
          </button>
          {draft.codeLibraryRoot && (
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, codeLibraryRoot: null }))}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Clear
            </button>
          )}
        </SetupField>}
        <SharedMiDataSetup
          relativePath={draft.dropboxFirmDataPath}
          enabled={draft.sharedDataRootEnabled === true}
          dropboxRoot={draft.dropboxRoot}
          busy={busy}
          onChange={(next) => setDraft((current) => ({
            ...current,
            ...("relativePath" in next ? { dropboxFirmDataPath: next.relativePath } : {}),
            ...("enabled" in next ? { sharedDataRootEnabled: next.enabled } : {}),
          }))}
        />

        {showAdvanced && <div className="space-y-2 text-sm">
          <span className="font-medium">Local Mi data folder</span>
          <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">{config.dataRoot}</code>
          <p className="text-xs text-muted-foreground">
            Mi manages this automatically. It is not another shared-folder choice.
          </p>
        </div>}

        {showAdvanced && <div className="space-y-2 text-sm">
          <span className="font-medium">Notion write allowlist</span>
          <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">{config.miConfigPath}</code>
          <p className="text-xs text-muted-foreground">
            This editable file is local to this computer. Removing a field tightens what Mi can write; restart Mi after editing it.
          </p>
          <button
            type="button"
            onClick={() => void api.revealMiConfig()}
            className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Show config file
          </button>
        </div>}

        {showAdvanced && <label className="space-y-2 text-sm">
          <span className="font-medium">Display timezone</span>
          <input
            list="partner-setup-timezones"
            value={draft.timezone || "America/Chicago"}
            onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
            placeholder="Search IANA timezones"
            className="w-full rounded-md border border-border bg-card px-3 py-2"
          />
          <datalist id="partner-setup-timezones">
            {timezoneOptions.map((option) => (
              <option key={option.id} value={option.id} label={option.label} />
            ))}
          </datalist>
          <span className="block text-xs text-muted-foreground">
            Search canonical IANA zones. Offset labels show January/July differences; the saved ID
            keeps daylight-saving changes correct.
          </span>
        </label>}

        <div className="lg:col-span-2 border-t border-border pt-5">
          <h3 className="font-medium">Notion</h3>
          <p className="mt-1 text-xs text-muted-foreground">Secure connection to STUDIO&apos;s Notion databases.</p>
        </div>

        <div className="space-y-2 text-sm">
          <span className="font-medium">Notion integration token</span>
          <div className="flex gap-2">
            <input
              ref={tokenInput}
              type="password"
              autoComplete="off"
              placeholder={config.hasNotionToken ? "Stored securely — enter to replace" : "Enter token"}
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(async () => {
                const token = tokenInput.current?.value || "";
                if (!token.trim()) throw new Error("Enter a Notion integration token.");
                await api.setNotionToken(token);
                if (tokenInput.current) tokenInput.current.value = "";
                const next = (await api.get()).config;
                setConfig(next);
                setMessage("Notion token encrypted with operating-system credential protection.");
              })}
              className="tactile-control rounded-md border border-border px-3 py-2 hover:border-accent"
            >
              {config.hasNotionToken ? "Replace" : "Store"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !config.hasNotionToken}
              onClick={() => void action(async () => setHealth(await api.testNotion()))}
              className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50"
            >
              {busy ? <ActivityIndicator label="Testing Notion…" /> : "Test Notion connection"}
            </button>
            {config.hasNotionToken && (
              <button
                type="button"
                onClick={() => void action(async () => {
                  await api.clearNotionToken();
                  setConfig((await api.get()).config);
                  setHealth(null);
                  setMessage("Stored Notion credential cleared. Restart the local server to remove it from memory.");
                })}
                className="text-xs text-muted-foreground underline"
              >
                Clear stored credential
              </button>
            )}
          </div>
          {!config.hasNotionToken && (
            <p className="text-xs text-muted-foreground">Store a token before testing the connection.</p>
          )}
          {health && <NotionHealthPanel health={health} />}
        </div>

        <div className="lg:col-span-2 border-t border-border pt-5">
          <h3 className="font-medium">AI connections</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Test each connection independently. CLI subscriptions and API billing remain separate.
          </p>
        </div>

        <AgentConnectionCard
          title="Claude CLI"
          description="Uses the Claude desktop CLI and your Claude subscription authentication."
          result={agentTests["claude-cli"]}
          busy={busy}
          onTest={() => action(() => testAgent("claude-cli"))}
        >
          <ClaudeSubscriptionTokenField
              configured={config.hasClaudeSubscriptionToken}
              busy={busy}
              onStore={async (token) => {
                await api.setClaudeSubscriptionToken(token);
                setConfig((await api.get()).config);
                setAgentTests((current) => ({ ...current, "claude-cli": undefined }));
                await api.restartServer();
                setMessage("Claude subscription token stored; the local server was restarted.");
              }}
              onClear={async () => {
                await api.clearClaudeSubscriptionToken();
                setConfig((await api.get()).config);
                setAgentTests((current) => ({ ...current, "claude-cli": undefined }));
                await api.restartServer();
                setMessage("Claude subscription token cleared; the local server was restarted.");
              }}
            />
        </AgentConnectionCard>

        <AgentConnectionCard
          title="Codex CLI"
          description="Uses the Codex CLI and the ChatGPT account signed in on this computer."
          result={agentTests["codex-cli"]}
          busy={busy}
          onTest={() => action(() => testAgent("codex-cli"))}
        >
          <p className="text-xs text-muted-foreground">
            No API key is needed. The test checks both the installed executable and <code>codex login status</code>.
          </p>
        </AgentConnectionCard>

        <AgentConnectionCard
          title="OpenAI API"
          description="Uses one OpenAI API key and API billing. This is separate from the Codex CLI subscription."
          result={agentTests["openai-api"]}
          busy={busy}
          testDisabled={!config.hasOpenAiApiKey}
          onTest={() => action(() => testAgent("openai-api"))}
        >
          <OpenAiApiKeyField
            configured={config.hasOpenAiApiKey}
            busy={busy}
            onStore={async (token) => {
              await api.setOpenAiApiKey(token);
              setConfig((await api.get()).config);
              setAgentTests((current) => ({ ...current, "openai-api": undefined }));
              setMessage("OpenAI API key stored securely. Test the OpenAI API connection when ready.");
            }}
            onClear={async () => {
              await api.clearOpenAiApiKey();
              setConfig((await api.get()).config);
              setAgentTests((current) => ({ ...current, "openai-api": undefined }));
              setMessage("OpenAI API key cleared.");
            }}
          />
        </AgentConnectionCard>

        <AgentConnectionCard
          title="Claude API"
          description="Uses a Claude API key and separate API billing. This is independent of the Claude CLI subscription."
          result={agentTests["claude-api"]}
          busy={busy}
          testDisabled={!config.hasClaudeApiKey}
          onTest={() => action(() => testAgent("claude-api"))}
        >
          <ClaudeApiKeyField
            configured={config.hasClaudeApiKey}
            busy={busy}
            onStore={async (token) => {
              await api.setClaudeApiKey(token);
              setConfig((await api.get()).config);
              setAgentTests((current) => ({ ...current, "claude-api": undefined }));
              await api.restartServer();
              setMessage("Claude API key stored securely; the local server restarted. Test the Claude API connection when ready.");
            }}
            onClear={async () => {
              await api.clearClaudeApiKey();
              setConfig((await api.get()).config);
              setAgentTests((current) => ({ ...current, "claude-api": undefined }));
              await api.restartServer();
              setMessage("Claude API key cleared; the local server restarted.");
            }}
          />
        </AgentConnectionCard>

        {showAdvanced && <div className="lg:col-span-2 rounded-md border border-border bg-muted/10 p-4 text-sm">
          <h4 className="font-medium">Integration details</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Source IDs, attendance identity, and executable overrides. Most people do not need to change these after setup.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span>Studio Projects data source</span>
              <input
                value={draft.notionProjectsDataSourceId || ""}
                onChange={(event) => setDraft((current) => ({ ...current, notionProjectsDataSourceId: event.target.value }))}
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="space-y-1">
              <span>STUDIO Schedule data source</span>
              <input
                value={draft.notionScheduleDataSourceId || ""}
                onChange={(event) => setDraft((current) => ({ ...current, notionScheduleDataSourceId: event.target.value }))}
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span>Your name in STUDIO Schedule Attendance</span>
              <input
                value={draft.notionAttendeeName || ""}
                onChange={(event) => setDraft((current) => ({ ...current, notionAttendeeName: event.target.value || null }))}
                placeholder="Exact name as it appears in Notion"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
              <span className="block text-xs text-muted-foreground">
                Used only for busy/free chat context. It must exactly match Notion and is never auto-detected.
              </span>
            </label>
            <label className="space-y-1">
              <span>Codex executable</span>
              <input
                value={draft.codexBin || ""}
                onChange={(event) => setDraft((current) => ({ ...current, codexBin: event.target.value || null }))}
                placeholder="codex"
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="space-y-1">
              <span>Claude executable</span>
              <input
                value={draft.claudeBin || ""}
                onChange={(event) => setDraft((current) => ({ ...current, claudeBin: event.target.value || null }))}
                placeholder="claude"
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
              />
            </label>
          </div>
        </div>}
        <label className={`flex items-start gap-2.5 text-sm lg:col-span-2 ${config.launchAtLoginSupported ? "cursor-pointer" : "opacity-65"}`}>
          <input
            type="checkbox"
            checked={draft.launchAtLogin === true}
            disabled={!config.launchAtLoginSupported}
            onChange={(event) => setDraft((current) => ({ ...current, launchAtLogin: event.target.checked }))}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="block font-medium">Launch Mi when Windows starts</span>
            <span className="block text-xs text-muted-foreground">
              On by default after installation. Turn it off here any time. This setting is
              available in the installed Windows app.
            </span>
          </span>
        </label>
        {showAdvanced && <label className="flex cursor-pointer items-start gap-2.5 text-sm lg:col-span-2">
          <input
            type="checkbox"
            checked={draft.terminalPanelEnabled === true}
            onChange={(event) => setDraft((current) => ({ ...current, terminalPanelEnabled: event.target.checked }))}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="block font-medium">Show Terminal in the project workspace</span>
            <span className="block text-xs text-muted-foreground">
              On by default. The project workspace header offers Terminal next to Talk to Mi; it
              opens the same durable project shell as Mi Studio, keeps running while you
              navigate, and can be popped out into a pinned window. Hide it here if a partner
              only wants guided chat.
            </span>
          </span>
        </label>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button disabled={busy || !unsavedChanges} onClick={() => void action(saveSettings)} className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
          {unsavedChanges ? "Save changes" : "Settings saved"}
        </button>
        <button
          type="button"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((current) => !current)}
          className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
        >
          {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
        </button>
      </div>

      {showAdvanced && <section className="mt-5 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">Migration & recovery</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Use these only when moving from an older Mi setup, recovering configuration, or diagnosing a local server problem.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => void action(async () => {
              const result = await api.pickLegacyEnv();
              if (result.path) setLegacy({
                path: result.path,
                hasNotionToken: result.hasNotionToken === true,
                hasClaudeSubscriptionToken: result.hasClaudeSubscriptionToken === true,
                hasClaudeApiKey: result.hasClaudeApiKey === true,
                hasOpenAiApiKey: result.hasOpenAiApiKey === true,
              });
            })}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Preview legacy settings
          </button>
          <button
            disabled={busy}
            onClick={() => void action(async () => {
              await api.restartServer();
              setMessage("Local application server restarted with current secure settings.");
            })}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Restart local server
          </button>
        </div>
        <div className="mt-4">
          <FirmDataMigrationPanel />
        </div>
      </section>}

      {showAdvanced && legacy && (
        <div className="mt-4 rounded-md border border-status-warning-foreground/40 p-3 text-sm">
          <p>Legacy import candidate: <code>{legacy.path}</code></p>
          <p className="text-xs text-muted-foreground">
            Notion token: {legacy.hasNotionToken ? "present" : "absent"}; Claude subscription
            token: {legacy.hasClaudeSubscriptionToken ? "present" : "absent"}. Present
            credentials will be encrypted. Claude API key: {legacy.hasClaudeApiKey ? "present" : "absent"};
            OpenAI API key: {legacy.hasOpenAiApiKey ? "present" : "absent"}.
            Nothing has been imported.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(async () => {
              const next = await api.importLegacy(legacy.path, true);
              setConfig(next);
              setDraft(next);
              setLegacy(null);
              setMessage("Confirmed legacy settings imported into per-user secure configuration.");
            })}
            className="mt-2 rounded-md bg-foreground px-3 py-2 text-xs text-background"
          >
            Confirm one-time import
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        {!config.setupCompleted && <button
          type="button"
          disabled={busy}
          onClick={() => void action(async () => {
            const next = await api.finish();
            setConfig(next);
            setMessage("Setup complete. Codex and Claude remain optional.");
          })}
          className="tactile-control rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground"
        >
          Finish setup
        </button>}
        {showAdvanced && <button
          type="button"
          disabled={busy}
          onClick={() => void action(async () => {
            await window.electronAPI!.diagnostics.export();
            setMessage("Redacted diagnostics export completed or was canceled.");
          })}
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          Export redacted diagnostics
        </button>}
        {busy && message
          ? <ActivityIndicator label={message} className="text-sm" />
          : message
            ? <ActivityIndicator state={messageState} label={message} className="text-sm" />
            : null}
      </div>
    </section>
  );
}

function SetupField({
  label,
  value,
  description,
  children,
}: {
  label: string;
  value: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">{value || "Not selected"}</code>
      {description}
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function ConnectionStatus({
  label,
  ready,
  readyText,
  missingText,
  neutral = false,
}: {
  label: string;
  ready: boolean;
  readyText: string;
  missingText: string;
  neutral?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className={`status-chip ${ready ? "status-chip-success" : neutral ? "status-chip-missing" : "status-chip-attention"}`}>
          {ready ? "Configured" : neutral ? "Optional" : "Review"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{ready ? readyText : missingText}</p>
    </div>
  );
}

function AgentConnectionCard({
  title,
  description,
  result,
  busy,
  testDisabled = false,
  onTest,
  children,
}: {
  title: string;
  description: string;
  result?: AgentConnectionTestResult;
  busy: boolean;
  testDisabled?: boolean;
  onTest: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-muted/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] ${
          result?.ok
            ? "bg-accent/15 text-accent"
            : result
              ? "bg-status-warning-foreground/10 text-status-warning-foreground"
              : "bg-muted text-muted-foreground"
        }`}>
          {result?.ok ? "Connected" : result ? "Needs attention" : "Not tested"}
        </span>
      </div>
      <div className="mt-4 flex-1">{children}</div>
      <button
        type="button"
        disabled={busy || testDisabled}
        onClick={onTest}
        className="tactile-control mt-4 w-full rounded-md border border-border px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
      >
        {busy ? <ActivityIndicator label={`Testing ${title}…`} /> : `Test ${title}`}
      </button>
      {testDisabled && !result && (
        <p className="mt-2 text-xs text-muted-foreground">Store an API key before testing.</p>
      )}
      {result && (
        <div role="status" className={`mt-3 rounded-md border p-3 text-xs ${
          result.ok ? "border-accent/40 bg-accent/5" : "border-status-warning-foreground/40"
        }`}>
          <p>{result.detail}</p>
          {result.version && <code className="mt-1 block text-muted-foreground">{result.version}</code>}
          <p className="mt-1 text-muted-foreground">
            Last checked {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.testedAt))}
          </p>
        </div>
      )}
    </section>
  );
}
