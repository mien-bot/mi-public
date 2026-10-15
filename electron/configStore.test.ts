import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { createConfigStore, parseEnv } = require("./configStore");

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-config-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function secureStorage() {
  return {
    isAvailable: async () => true,
    encrypt: async (value: string) => Buffer.from(`encrypted:${value}`),
    decrypt: async (value: Buffer) => ({
      plainText: value.toString("utf8").replace(/^encrypted:/, ""),
      shouldReEncrypt: false,
    }),
  };
}

describe("per-user configuration", () => {
  it("persists redacted connection results across store instances and invalidates credential changes", async () => {
    const root = temporaryRoot();
    const first = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    first.initialize();
    const cached = first.setConnectionTest({
      kind: "openai-api",
      ok: true,
      detail: "OpenAI API is connected.",
      model: "gpt-test",
      secret: "must-not-persist",
    });

    expect(cached.testedAt).toEqual(expect.any(String));
    const restarted = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(restarted.getConnectionTests()["openai-api"]).toMatchObject({
      ok: true,
      detail: "OpenAI API is connected.",
      model: "gpt-test",
    });
    expect(JSON.stringify(restarted.getConnectionTests())).not.toContain("must-not-persist");

    await restarted.setOpenAiApiKey("replacement-key");
    expect(restarted.getConnectionTests()["openai-api"]).toBeUndefined();
  });

  it("encrypts credentials, preserves both across replacement, and persists settings", async () => {
    const root = temporaryRoot();
    const first = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    first.initialize();
    first.updateSettings({ timezone: "America/Denver", setupCompleted: true });
    await first.setNotionToken("fake-partner-token");
    await first.setClaudeSubscriptionToken("fake-claude-subscription-token");
    await first.setClaudeApiKey("fake-claude-api-key");
    await first.setOpenAiApiKey("fake-openai-api-key");
    await first.setNotionToken("replacement-notion-token");

    const credentialText = fs.readFileSync(path.join(root, "config", "credentials.json"), "utf8");
    expect(credentialText).not.toContain("fake-partner-token");
    expect(credentialText).not.toContain("replacement-notion-token");
    expect(credentialText).not.toContain("fake-claude-subscription-token");
    expect(credentialText).not.toContain("fake-claude-api-key");
    expect(credentialText).not.toContain("fake-openai-api-key");

    const restarted = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(restarted.initialize().timezone).toBe("America/Denver");
    expect(restarted.getPublicConfig().hasNotionToken).toBe(true);
    expect(restarted.getPublicConfig().hasClaudeSubscriptionToken).toBe(true);
    expect(restarted.getPublicConfig().hasClaudeApiKey).toBe(true);
    expect(restarted.getPublicConfig().hasOpenAiApiKey).toBe(true);
    expect(await restarted.getNotionToken()).toBe("replacement-notion-token");
    expect(await restarted.getClaudeSubscriptionToken()).toBe("fake-claude-subscription-token");
    expect(await restarted.getClaudeApiKey()).toBe("fake-claude-api-key");
    expect(await restarted.getOpenAiApiKey()).toBe("fake-openai-api-key");
  });

  it("defaults the firm-wide data path to unset/unmigrated, and only flips migrated via an explicit patch", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    const initial = store.initialize();
    expect(initial.dropboxFirmDataPath).toBeNull();
    expect(initial.dropboxFirmDataMigrated).toBe(false);

    const pathOnly = store.updateSettings({ dropboxFirmDataPath: "Mi Data" });
    expect(pathOnly.dropboxFirmDataPath).toBe("Mi Data");
    expect(pathOnly.dropboxFirmDataMigrated).toBe(false);

    const migrated = store.updateSettings({ dropboxFirmDataMigrated: true });
    expect(migrated.dropboxFirmDataMigrated).toBe(true);
    expect(migrated.dropboxFirmDataPath).toBe("Mi Data");
  });

  it("normalizes the confirmed Notion attendee name, trimming and blanking to null", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(store.initialize().notionAttendeeName).toBeNull();

    const set = store.updateSettings({ notionAttendeeName: "  Example User  " });
    expect(set.notionAttendeeName).toBe("Example User");

    const cleared = store.updateSettings({ notionAttendeeName: "" });
    expect(cleared.notionAttendeeName).toBeNull();
  });

  it("keeps the complete shared data root disabled unless explicitly confirmed", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(store.initialize().sharedDataRootEnabled).toBe(false);

    const pathOnly = store.updateSettings({ dropboxFirmDataPath: "7.00 Mi Data" });
    expect(pathOnly.sharedDataRootEnabled).toBe(false);

    const enabled = store.updateSettings({ sharedDataRootEnabled: true });
    expect(enabled.sharedDataRootEnabled).toBe(true);
  });

  it("defaults Notion auto-pull to disabled/240min and preserves an explicit opt-in", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    const initial = store.initialize();
    expect(initial.notionSyncEnabled).toBe(false);
    expect(initial.notionSyncIntervalMinutes).toBe(240);

    const updated = store.updateSettings({ notionSyncEnabled: true, notionSyncIntervalMinutes: 15 });
    expect(updated.notionSyncEnabled).toBe(true);
    expect(updated.notionSyncIntervalMinutes).toBe(15);

    const restarted = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(restarted.initialize().notionSyncEnabled).toBe(true);

    const invalid = store.updateSettings({ notionSyncIntervalMinutes: -5 });
    expect(invalid.notionSyncIntervalMinutes).toBe(240);
  });

  it("shows the project terminal by default while preserving an explicit local opt-out", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(store.initialize().terminalPanelEnabled).toBe(true);
    expect(store.updateSettings({ terminalPanelEnabled: false }).terminalPanelEnabled).toBe(false);
  });

  it("keeps the personal Notion credential and selected calendar separate from STUDIO", async () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    store.initialize();
    await store.setNotionToken("firm-token");
    await store.setPersonalNotionToken("personal-token");
    store.updateSettings({
      personalCalendarDataSourceId: "1234567890abcdef1234567890abcdef",
      personalCalendarName: "Alex Schedule",
      personalCalendarTitleProperty: "Name",
      personalCalendarDateProperty: "Date",
    });

    expect(store.getPublicConfig()).toMatchObject({
      hasNotionToken: true,
      hasPersonalNotionToken: true,
      personalCalendarName: "Alex Schedule",
    });
    expect(await store.getNotionToken()).toBe("firm-token");
    expect(await store.getPersonalNotionToken()).toBe("personal-token");
    expect(fs.readFileSync(path.join(root, "config", "credentials.json"), "utf8")).not.toContain("personal-token");

    store.clearPersonalNotionToken();
    expect(store.getPublicConfig()).toMatchObject({
      hasNotionToken: true,
      hasPersonalNotionToken: false,
      personalCalendarDataSourceId: null,
      personalCalendarName: null,
    });
    expect(await store.getNotionToken()).toBe("firm-token");
  });

  it("defaults Windows startup on while preserving initialization and opt-out state", () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    expect(store.initialize().launchAtLogin).toBe(true);
    expect(store.getSettings().launchAtLoginConfigured).toBe(false);
    const updated = store.updateSettings({ launchAtLogin: false, launchAtLoginConfigured: true });
    expect(updated.launchAtLogin).toBe(false);
    expect(updated.launchAtLoginConfigured).toBe(true);
  });

  it("previews legacy values without exposing credentials and imports only after confirmation", async () => {
    const root = temporaryRoot();
    const dropbox = path.join(root, "Dropbox");
    fs.mkdirSync(dropbox);
    const envPath = path.join(root, ".env.local");
    fs.writeFileSync(
      envPath,
      `NOTION_API_KEY=fake-notion-secret\nCLAUDE_CODE_OAUTH_TOKEN=fake-claude-secret\nANTHROPIC_API_KEY=fake-api-key\nOPENAI_API_KEY=fake-openai-key\nDROPBOX_ROOT=${dropbox}\nUNSUPPORTED=ignored\n`,
      "utf8",
    );
    const store = createConfigStore({ userDataPath: path.join(root, "profile"), secureStorage: secureStorage() });
    store.initialize();
    const preview = store.previewLegacyEnv(envPath);
    expect(preview.hasNotionToken).toBe(true);
    expect(preview.hasClaudeSubscriptionToken).toBe(true);
    expect(preview.hasClaudeApiKey).toBe(true);
    expect(preview.hasOpenAiApiKey).toBe(true);
    expect(JSON.stringify(preview)).not.toContain("fake-notion-secret");
    expect(JSON.stringify(preview)).not.toContain("fake-claude-secret");
    expect(JSON.stringify(preview)).not.toContain("fake-api-key");
    expect(JSON.stringify(preview)).not.toContain("fake-openai-key");
    expect(JSON.stringify(store.getPublicConfig())).not.toContain("fake-claude-secret");
    await expect(store.importLegacyEnv(envPath, { confirmed: false })).rejects.toThrow(/confirmation/);
    expect(store.getPublicConfig().dropboxRoot).toBeNull();
    await store.importLegacyEnv(envPath, { confirmed: true });
    expect(store.getPublicConfig().dropboxRoot).toBe(path.resolve(dropbox));
    expect(await store.getNotionToken()).toBe("fake-notion-secret");
    expect(await store.getClaudeSubscriptionToken()).toBe("fake-claude-secret");
    expect(await store.getClaudeApiKey()).toBe("fake-api-key");
    expect(await store.getOpenAiApiKey()).toBe("fake-openai-key");
  });

  it("accepts only the documented legacy keys", () => {
    expect(parseEnv("NOTION_API_KEY=fake\nCLAUDE_CODE_OAUTH_TOKEN=oauth\nANTHROPIC_API_KEY=api-key\nOPENAI_API_KEY=openai-key\nPATH=do-not-import\nDROPBOX_ROOT=C:\\\\Dropbox")).toEqual({
      NOTION_API_KEY: "fake",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth",
      ANTHROPIC_API_KEY: "api-key",
      OPENAI_API_KEY: "openai-key",
      DROPBOX_ROOT: "C:\\\\Dropbox",
    });
  });

  it("clears either credential without erasing the other", async () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    store.initialize();
    await store.setNotionToken("fake-notion-token");
    await store.setClaudeSubscriptionToken("fake-claude-token");
    await store.setClaudeApiKey("fake-api-key");
    await store.setOpenAiApiKey("fake-openai-key");

    store.clearNotionToken();
    expect(store.getPublicConfig().hasNotionToken).toBe(false);
    expect(store.getPublicConfig().hasClaudeSubscriptionToken).toBe(true);
    expect(store.getPublicConfig().hasClaudeApiKey).toBe(true);
    expect(store.getPublicConfig().hasOpenAiApiKey).toBe(true);
    expect(await store.getClaudeSubscriptionToken()).toBe("fake-claude-token");

    await store.setNotionToken("replacement-notion-token");
    store.clearClaudeSubscriptionToken();
    expect(store.getPublicConfig().hasClaudeSubscriptionToken).toBe(false);
    expect(store.getPublicConfig().hasNotionToken).toBe(true);
    expect(store.getPublicConfig().hasClaudeApiKey).toBe(true);
    expect(await store.getNotionToken()).toBe("replacement-notion-token");
    store.clearClaudeApiKey();
    expect(store.getPublicConfig().hasClaudeApiKey).toBe(false);
    expect(store.getPublicConfig().hasNotionToken).toBe(true);
    expect(store.getPublicConfig().hasOpenAiApiKey).toBe(true);
    store.clearOpenAiApiKey();
    expect(store.getPublicConfig().hasOpenAiApiKey).toBe(false);
  });

  it("removes active credentials and encrypted credential backups when the last is cleared", async () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    store.initialize();
    await store.setClaudeSubscriptionToken("first-fake-token");
    await store.setClaudeSubscriptionToken("replacement-fake-token");

    const backupDir = path.join(root, "config", "backups");
    expect(fs.existsSync(path.join(backupDir, "credentials.json.previous"))).toBe(true);

    store.clearClaudeSubscriptionToken();

    expect(store.getPublicConfig().hasClaudeSubscriptionToken).toBe(false);
    expect(fs.existsSync(path.join(root, "config", "credentials.json"))).toBe(false);
    expect(
      fs.readdirSync(backupDir).filter((entry) => entry.startsWith("credentials.json.")),
    ).toEqual([]);
  });

  it("rejects unsafe credential input with safe messages", async () => {
    const root = temporaryRoot();
    const store = createConfigStore({ userDataPath: root, secureStorage: secureStorage() });
    store.initialize();

    await expect(store.setClaudeSubscriptionToken("")).rejects.toThrow(
      "Enter a valid Claude subscription token generated by claude setup-token.",
    );
    await expect(store.setClaudeSubscriptionToken("value\nwith-newline")).rejects.toThrow(
      "Enter a valid Claude subscription token generated by claude setup-token.",
    );
    await expect(store.setClaudeApiKey("value\nwith-newline")).rejects.toThrow(
      "Enter a valid Claude API key.",
    );
    await expect(store.setOpenAiApiKey("value\nwith-newline")).rejects.toThrow(
      "Enter a valid OpenAI API key.",
    );
  });
});
