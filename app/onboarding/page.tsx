"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  canonicalizeIanaTimezone,
  DETERMINISTIC_TIMEZONE_OPTIONS,
  getRuntimeTimezoneOptions,
  includeTimezoneOption,
} from "@/lib/content/timezoneOptions";
import { ClaudeSubscriptionTokenField } from "@/components/ClaudeSubscriptionTokenField";
import { ClaudeApiKeyField } from "@/components/ClaudeApiKeyField";
import { FeatureTour } from "@/components/FeatureTour";
import { SharedMiDataSetup } from "@/components/SharedMiDataSetup";
import type {
  AgentAvailability,
  NotionSetupHealth,
  PartnerSetupConfig,
} from "@/types/electron";

const STEPS = [
  "Welcome",
  "What Mi can do",
  "Dropbox",
  "Preferences",
  "Notion",
  "AI tools",
  "Ready",
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<PartnerSetupConfig | null>(null);
  const [draft, setDraft] = useState<Partial<PartnerSetupConfig>>({});
  const tokenInput = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<NotionSetupHealth | null>(null);
  const [tools, setTools] = useState<AgentAvailability | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const baseTimezoneOptions = useMemo(
    () => (mounted ? getRuntimeTimezoneOptions() : DETERMINISTIC_TIMEZONE_OPTIONS),
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
    api.get().then(({ config: next }) => {
      setConfig(next);
      setDraft(next);
      if (next.setupCompleted) router.replace("/");
    });
  }, [router]);

  if (!mounted) return <p className="text-sm text-muted-foreground">Loading setup…</p>;

  if (!window.electronAPI) {
    return (
      <section className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        First-run setup is available in the installed Mi desktop app. Browser development ignores
        local environment settings and cannot use the operating system credential store.
      </section>
    );
  }

  if (!config) return <p className="text-sm text-muted-foreground">Loading setup…</p>;
  const api = window.electronAPI.setup;

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(overrides: Partial<PartnerSetupConfig>) {
    const merged = { ...draft, ...overrides };
    const previous = config;
    const timezone = canonicalizeIanaTimezone(merged.timezone || "America/Chicago");
    if (!timezone) throw new Error("Select a valid IANA timezone.");
    const next = await api.saveSettings({
      dropboxRoot: merged.dropboxRoot || null,
      codeLibraryRoot: merged.codeLibraryRoot || null,
      timezone,
      notionProjectsDataSourceId: merged.notionProjectsDataSourceId,
      notionScheduleDataSourceId: merged.notionScheduleDataSourceId,
      codexBin: merged.codexBin || null,
      claudeBin: merged.claudeBin || null,
      agentContextMaxBytes: merged.agentContextMaxBytes,
      dropboxFirmDataPath: merged.dropboxFirmDataPath || null,
      sharedDataRootEnabled: merged.sharedDataRootEnabled === true,
    });
    setConfig(next);
    setDraft(next);
    // Which folder Mi reads is baked into the local server's environment when it spawns, so
    // persisting it isn't enough -- without this the wizard would finish and still show the
    // empty local root until the next launch.
    const dataRootChanged = previous?.dropboxRoot !== next.dropboxRoot
      || previous?.dropboxFirmDataPath !== next.dropboxFirmDataPath
      || previous?.sharedDataRootEnabled !== next.sharedDataRootEnabled;
    if (dataRootChanged) await api.restartServer();
    return next;
  }

  const canLeaveDropboxStep = Boolean(config.dropboxRoot)
    && Boolean(config.dropboxFirmDataPath)
    && config.sharedDataRootEnabled === true;
  const canLeaveNotionStep = config.hasNotionToken;

  function goNext() {
    setMessage("");
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }
  function goBack() {
    setMessage("");
    setStep((current) => Math.max(current - 1, 0));
  }

  return (
    <section className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-card/30">
      <div className="border-b border-border bg-muted/20 px-5 py-4 sm:px-7">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Welcome to Mi
          </p>
          <p className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Setup progress">
          {STEPS.map((label, index) => (
            <li key={label} className="min-w-0">
              <span
                aria-current={index === step ? "step" : undefined}
                className={`block h-1.5 rounded-full ${
                  index <= step ? "bg-accent" : "bg-border"
                }`}
              />
              <span className="sr-only">
                {label}{index < step ? " complete" : index === step ? " current" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="px-5 py-6 sm:px-7 sm:py-8">
      <h1 className="font-display text-3xl font-light">{STEPS[step]}</h1>

      {step === 0 && (
        <div className="mt-5 space-y-6">
          <div className="max-w-2xl space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              Mi is your project operations workspace: one place to plan work, capture decisions,
              find firm knowledge, and ask Codex or Claude for help.
            </p>
            <p>
              Setup connects this Mac to the firm&apos;s confirmed Dropbox and Notion sources.
              Credentials and machine paths stay on this computer; nothing here is copied into Git.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["See the work", "Projects, leads, permits, schedules, meetings, and delivery checks."],
              ["Find the context", "Search, codes, references, files, and lessons learned."],
              ["Stay in control", "Mi previews changes; a person confirms every external write."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-xl border border-border bg-card p-4">
                <h2 className="font-display text-base font-medium">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            This takes about five minutes. You can revisit the feature guide and optional
            connections later.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="mt-5 space-y-4">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These are Mi&apos;s six main work areas. This tour stays available any time under
            <strong className="font-medium text-foreground"> Settings → Product tour</strong>.
          </p>
          <FeatureTour />
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Select the folder where this computer&apos;s Dropbox client already syncs the shared
            STUDIO Dropbox.
          </p>
          <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">
            {draft.dropboxRoot || "Not selected"}
          </code>
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(async () => {
              const result = await api.pickDropboxRoot();
              if (result.path) await saveDraft({ dropboxRoot: result.path });
            })}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Choose folder
          </button>
          {!config.dropboxRoot && (
            <p className="text-xs text-muted-foreground">Select the Dropbox root to continue.</p>
          )}

          {/* Second half of the same step on purpose: a Dropbox root alone leaves Mi reading
              its own empty local folder, so finishing here without the firm's data folder is
              the state that reads as a broken install. */}
          <SharedMiDataSetup
            relativePath={draft.dropboxFirmDataPath}
            enabled={draft.sharedDataRootEnabled === true}
            dropboxRoot={draft.dropboxRoot}
            busy={busy}
            onChange={(next) => void action(async () => {
              await saveDraft({
                ...("relativePath" in next ? { dropboxFirmDataPath: next.relativePath } : {}),
                ...("enabled" in next ? { sharedDataRootEnabled: next.enabled } : {}),
              });
            })}
          />
          {config.dropboxRoot && !canLeaveDropboxStep && (
            <p className="text-xs text-muted-foreground">
              Choose the firm&apos;s Mi data folder and turn on reading records from it to continue.
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-5 text-sm">
          <label className="block space-y-2">
            <span className="font-medium">Code-library root (optional)</span>
            <code className="block break-all rounded-md bg-muted/30 p-2 text-xs">
              {draft.codeLibraryRoot || "Not configured"}
            </code>
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
          </label>
          <label className="block space-y-2">
            <span className="font-medium">Display timezone</span>
            <input
              list="onboarding-timezones"
              value={draft.timezone || "America/Chicago"}
              onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
              placeholder="Search IANA timezones"
              className="w-full rounded-md border border-border bg-card px-3 py-2"
            />
            <datalist id="onboarding-timezones">
              {timezoneOptions.map((option) => (
                <option key={option.id} value={option.id} label={option.label} />
              ))}
            </datalist>
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="mt-4 space-y-5 text-sm">
          <div className="space-y-2">
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
                  setConfig((await api.get()).config);
                  setMessage("Notion token encrypted with operating-system credential protection.");
                })}
                className="rounded-md border border-border px-3 py-2"
              >
                {config.hasNotionToken ? "Replace" : "Store"}
              </button>
            </div>
            {!canLeaveNotionStep && (
              <p className="text-xs text-muted-foreground">Store a Notion token to continue.</p>
            )}
          </div>

          <label className="block space-y-2">
            <span className="font-medium">Studio Projects data source</span>
            <input
              value={draft.notionProjectsDataSourceId || ""}
              onChange={(event) => setDraft((current) => ({ ...current, notionProjectsDataSourceId: event.target.value }))}
              onBlur={() => void action(async () => { await saveDraft({}); })}
              className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
            />
          </label>
          <label className="block space-y-2">
            <span className="font-medium">STUDIO Schedule data source</span>
            <input
              value={draft.notionScheduleDataSourceId || ""}
              onChange={(event) => setDraft((current) => ({ ...current, notionScheduleDataSourceId: event.target.value }))}
              onBlur={() => void action(async () => { await saveDraft({}); })}
              className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
            />
          </label>

          <button
            type="button"
            disabled={busy || !config.hasNotionToken}
            onClick={() => void action(async () => setHealth(await api.testNotion()))}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Test Notion access
          </button>
          {health && (
            <div className="rounded-md border border-border p-3 text-sm">
              <ul className="grid gap-1 sm:grid-cols-2">
                <li>Studio Projects read: {health.projects.read}</li>
                <li>Studio Projects schema: {health.projects.schema.status}</li>
                <li>STUDIO Schedule read: {health.schedule.read}</li>
                <li>STUDIO Schedule schema: {health.schedule.schema.status}</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="mt-4 space-y-5 text-sm">
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(async () => setTools(await api.detectTools()))}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Detect Codex &amp; Claude
            </button>
            {tools && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p>Codex: {tools.codex.available ? "available" : "not found"}</p>
                <p>Claude: {tools.claude.available ? "available" : "not found"}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Optional. Mi works without either CLI; you can install and detect them later.
            </p>
          </div>
          <ClaudeSubscriptionTokenField
            configured={config.hasClaudeSubscriptionToken}
            busy={busy}
            onStore={async (token) => {
              await api.setClaudeSubscriptionToken(token);
              setConfig((await api.get()).config);
              await api.restartServer();
            }}
            onClear={async () => {
              await api.clearClaudeSubscriptionToken();
              setConfig((await api.get()).config);
              await api.restartServer();
            }}
          />
          <ClaudeApiKeyField
            configured={config.hasClaudeApiKey}
            busy={busy}
            onStore={async (token) => {
              await api.setClaudeApiKey(token);
              setConfig((await api.get()).config);
              await api.restartServer();
            }}
            onClear={async () => {
              await api.clearClaudeApiKey();
              setConfig((await api.get()).config);
              await api.restartServer();
            }}
          />
        </div>
      )}

      {step === 6 && (
        <div className="mt-5 space-y-6 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Dropbox", config.dropboxRoot ? "Connected to this computer" : "Still required"],
              ["Firm's Mi data", config.dropboxFirmDataPath && config.sharedDataRootEnabled
                ? `Reading ${config.dropboxFirmDataPath}`
                : "Still required"],
              ["Notion", config.hasNotionToken ? "Credential stored" : "Still required"],
              ["Claude CLI", config.hasClaudeSubscriptionToken ? "Subscription token stored" : "Optional — add later"],
              ["Claude API", config.hasClaudeApiKey ? "API key stored" : "Optional — add later"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 font-medium">{value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h2 className="font-display text-lg font-medium">What happens next</h2>
            <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <li><span className="font-medium text-accent">1.</span> Browse the portfolio.</li>
              <li><span className="font-medium text-accent">2.</span> Open one project workspace.</li>
              <li><span className="font-medium text-accent">3.</span> Ask Mi with that context.</li>
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">
            Settings holds every connection and preference. Codex and Claude remain optional.
          </p>
        </div>
      )}

      {message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}

      <div className="mt-8 flex justify-between border-t border-border pt-5">
        <button
          type="button"
          disabled={busy || step === 0}
          onClick={goBack}
          className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
          disabled={busy || (step === 2 && !canLeaveDropboxStep) || (step === 4 && !canLeaveNotionStep)}
            onClick={goNext}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !canLeaveDropboxStep || !canLeaveNotionStep}
            onClick={() => void action(async () => {
              // Persist every field chosen throughout the wizard (code-library root, timezone,
              // firm data path) -- only the Dropbox root and Notion data-source IDs are saved
              // immediately as they're entered; everything else lives in draft state until now.
              await saveDraft({});
              const next = await api.finish();
              setConfig(next);
              router.replace("/getting-started");
            })}
            className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-40"
          >
            Finish and explore Mi
          </button>
        )}
      </div>
      </div>
    </section>
  );
}
