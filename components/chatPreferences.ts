import type { AgentEngine } from "@/types/electron";
import {
  createDefaultProviderModels,
  normalizeStoredModelId,
  type ProviderModelPreferences,
} from "./agentModels";
import { ROOT_PROJECT_VALUE, createTab, makeThreadKey, type OpenTab } from "./chatTypes";

export const CHAT_PREFS_STORAGE_KEY = "mi:chatWidget:v4";
export const V3_CHAT_PREFS_STORAGE_KEY = "mi:chatWidget:v3";
export const LEGACY_CHAT_PREFS_STORAGE_KEY = "mi:chatWidget:v2";

export interface ChatWidgetPreferences {
  collapsed: boolean;
  modelsByEngine: ProviderModelPreferences;
  tabs: OpenTab[];
  activeTabId: string;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
}

function defaultPreferences(): ChatWidgetPreferences {
  const tab = createTab("claude", ROOT_PROJECT_VALUE);
  return {
    collapsed: true,
    modelsByEngine: createDefaultProviderModels(),
    tabs: [tab],
    activeTabId: tab.id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCollapsed(parsed: Record<string, unknown>): boolean {
  return typeof parsed.collapsed === "boolean" ? parsed.collapsed : true;
}

function readModelsByEngine(storedModels: Record<string, unknown>): ProviderModelPreferences {
  return {
    codex: normalizeStoredModelId(storedModels.codex),
    claude: normalizeStoredModelId(storedModels.claude),
  };
}

/** Used by both the v3 and legacy v2 migrations, which only ever tracked one project/engine. */
function readSingleEngineAndProjectSlug(parsed: Record<string, unknown>): { engine: AgentEngine; projectSlug: string } {
  return {
    engine: parsed.engine === "codex" ? "codex" : "claude",
    projectSlug: typeof parsed.projectSlug === "string" ? parsed.projectSlug : ROOT_PROJECT_VALUE,
  };
}

function isOpenTabLike(value: unknown): value is OpenTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    (value.engine === "codex" || value.engine === "claude") &&
    typeof value.projectSlug === "string" &&
    typeof value.threadKey === "string" && value.threadKey.length > 0
  );
}

/** Falls back to a single fresh root tab if the stored array is missing, malformed, or empty
 * -- the UI always needs at least one tab open. */
function readTabs(
  parsed: Record<string, unknown>,
  modelsByEngine: ProviderModelPreferences,
): OpenTab[] {
  const raw = Array.isArray(parsed.tabs) ? parsed.tabs : [];
  const tabs = raw.flatMap((value) => {
    if (isOpenTabLike(value)) return [value];
    if (
      isRecord(value) &&
      typeof value.id === "string" &&
      (value.engine === "codex" || value.engine === "claude") &&
      typeof value.projectSlug === "string"
    ) {
      return [{
        id: value.id,
        engine: value.engine,
        projectSlug: value.projectSlug,
        threadKey: makeThreadKey(
          value.engine,
          modelsByEngine[value.engine] || null,
          value.projectSlug,
        ),
      } satisfies OpenTab];
    }
    return [];
  });
  return tabs.length > 0 ? tabs : [createTab("claude", ROOT_PROJECT_VALUE)];
}

function readActiveTabId(parsed: Record<string, unknown>, tabs: OpenTab[]): string {
  const candidate = typeof parsed.activeTabId === "string" ? parsed.activeTabId : null;
  return candidate && tabs.some((tab) => tab.id === candidate) ? candidate : tabs[0].id;
}

export function parseCurrentChatPreferences(raw: string | null): ChatWidgetPreferences | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;
  if (!isRecord(parsed.modelsByEngine)) return null;
  const modelsByEngine = readModelsByEngine(parsed.modelsByEngine);
  const tabs = readTabs(parsed, modelsByEngine);
  return {
    collapsed: readCollapsed(parsed),
    modelsByEngine,
    tabs,
    activeTabId: readActiveTabId(parsed, tabs),
  };
}

/** v3 tracked a single (engine, projectSlug) pair rather than a tab list -- wrap it into the
 * user's first tab so upgrading doesn't drop their current project chat. */
export function migrateV3ChatPreferences(raw: string | null): ChatWidgetPreferences | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;
  if (!isRecord(parsed.modelsByEngine)) return null;
  const { engine, projectSlug } = readSingleEngineAndProjectSlug(parsed);
  const modelsByEngine = readModelsByEngine(parsed.modelsByEngine);
  const tab = createTab(engine, projectSlug, makeThreadKey(engine, modelsByEngine[engine] || null, projectSlug));
  return {
    collapsed: readCollapsed(parsed),
    modelsByEngine,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

/** v2 tracked a single top-level `model` string instead of modelsByEngine. */
export function migrateLegacyChatPreferences(raw: string | null): ChatWidgetPreferences | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return null;
  const { engine, projectSlug } = readSingleEngineAndProjectSlug(parsed);
  const modelsByEngine = createDefaultProviderModels();
  modelsByEngine[engine] = normalizeStoredModelId(parsed.model);
  const tab = createTab(engine, projectSlug, makeThreadKey(engine, modelsByEngine[engine] || null, projectSlug));
  return {
    collapsed: readCollapsed(parsed),
    modelsByEngine,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

export function loadChatWidgetPreferences(
  storage: PreferenceStorage,
  currentStorageKey = CHAT_PREFS_STORAGE_KEY,
): ChatWidgetPreferences {
  return (
    parseCurrentChatPreferences(storage.getItem(currentStorageKey)) ??
    migrateV3ChatPreferences(storage.getItem(V3_CHAT_PREFS_STORAGE_KEY)) ??
    migrateLegacyChatPreferences(storage.getItem(LEGACY_CHAT_PREFS_STORAGE_KEY)) ??
    defaultPreferences()
  );
}
