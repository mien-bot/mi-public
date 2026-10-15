"use client";
import { reportMiActivity, finishMiActivity, requestMiActivityStop } from "@/lib/miniMi/activity";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { MiniMiHelper } from "@/components/MiniMiHelper";
import { ChatThread } from "@/components/ChatThread";
import { ProjectPdfFinder } from "@/components/ProjectPdfFinder";
import type { ExportableChat } from "@/components/ChatExportMenu";
import { ChatActions } from "@/components/ChatActions";
import { ChatProjectTabs, type ChatProjectTabItem } from "@/components/ChatProjectTabs";
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_ORDER,
  createDefaultProviderModels,
  updateProviderModel,
} from "@/components/agentModels";
import {
  CHAT_PREFS_STORAGE_KEY,
  loadChatWidgetPreferences,
  type ChatWidgetPreferences,
} from "@/components/chatPreferences";
import {
  CHAT_HISTORY_STORAGE_KEY,
  loadChatHistory,
  mergeChatHistories,
  serializeChatHistory,
} from "@/components/chatHistory";
import {
  MAX_OPEN_TABS,
  ROOT_PROJECT_VALUE,
  closeTab as closeTabHelper,
  createTab,
  emptyThread,
  makeThreadKey,
  openTab as openTabHelper,
  type AgentEngine,
  type ChatMessage,
  type OpenTab,
  type ThreadKey,
  type ThreadState,
} from "@/components/chatTypes";
import { resolveProjectChatLaunch } from "@/components/projectChatLaunch";
import { StudioScheduleCalendar } from "@/components/StudioScheduleCalendar";
import { ProjectInterviewPanel } from "@/components/ProjectInterviewPanel";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  PROJECT_CHAT_OPEN_EVENT,
  PROJECT_LIST_CHANGED_EVENT,
  getProjectChatPanelContext,
} from "@/components/projectChatUi";
import { parseProjectCopilotReply } from "@/lib/projectCopilot";
import type { ProjectAiPanelTab, ProjectChatOpenDetail } from "@/components/projectChatUi";

const WorkspaceTerminal = dynamic(() => import("./WorkspaceTerminal").then(module => module.WorkspaceTerminal), { ssr: false });

/** Unrecognized or absent tab values keep the normal chat entry point. */
function resolveProjectAiTab(tab: string | null | undefined): ProjectAiPanelTab {
  return tab === "interview" || tab === "terminal" ? tab : "chat";
}

export interface ChatWidgetProject {
  /** Local projects/<slug>/ folder, or null if this Notion project hasn't been scaffolded yet. */
  slug: string | null;
  notionPageId: string;
  name: string;
  status?: string | null;
  client?: string | null;
}

interface Attachment {
  id: string;
  name: string;
  dataUrl: string;
}

const MAX_ATTACHMENTS = 5;

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB — keeps the IPC payload (base64 data URLs) reasonable

/**
 * Persistent chat panel — see components/WorkspaceTerminal.tsx for the peer
 * raw-terminal surface this doesn't replace. Deliberately does
 * NOT live inside RouteTransition (app/layout.tsx) so its in-memory thread
 * state survives navigation between pages. Renders full-page (covering the
 * home route) when the user is on "/", and as the older floating bubble
 * everywhere else — same component/state, just different layout, so
 * switching routes never loses an in-progress thread.
 *
 * Supports multiple simultaneously open project tabs (see ChatProjectTabs):
 * `threads` already keyed every conversation by (engine, model, projectSlug)
 * before tabs existed, and IPC streaming already routes by requestId rather
 * than "whichever thread is on screen" (see requestThreadMap below) -- tabs
 * are a UI layer over that already-concurrent state, not a new backend.
 */
export function ChatWidget() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isHome = pathname === "/";
  const isCompactChat = pathname === "/chat" && searchParams.get("compactChat") === "1";
  const chatHiddenOnRoute =
    pathname === "/onboarding"
    || pathname === "/personal"
    || pathname.startsWith("/personal/")
    || pathname === "/leads"
    || pathname === "/permit-qaqc"
    // The pop-out terminal card fills its own small window; a floating chat bubble on top
    // of it would cover the shell it was opened for.
    || pathname === "/terminal/window";
  const chatWindowId = searchParams.get("chatWindow");
  const preferencesStorageKey = chatWindowId
    ? `${CHAT_PREFS_STORAGE_KEY}:${chatWindowId}`
    : CHAT_PREFS_STORAGE_KEY;

  const [mounted, setMounted] = useState(false);
  const [projects, setProjects] = useState<ChatWidgetProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [compactCollapsed, setCompactCollapsed] = useState(false);
  const [compactPinned, setCompactPinned] = useState(true);
  const [projectAiTab, setProjectAiTab] = useState<ProjectAiPanelTab>("chat");
  const [modelsByEngine, setModelsByEngine] = useState(createDefaultProviderModels);
  const [modelSelectionValid, setModelSelectionValid] = useState(true);
  // Open project/engine tabs. Always has at least one entry -- closeTab falls back to a fresh
  // root tab rather than ever leaving zero open.
  const [initialTab] = useState<OpenTab>(() => createTab("claude", ROOT_PROJECT_VALUE));
  const [tabs, setTabs] = useState<OpenTab[]>(() => [initialTab]);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTab.id);
  const [projectLaunchError, setProjectLaunchError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<ThreadKey, ThreadState>>({});
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [scaffolding, setScaffolding] = useState(false);
  // notionPageId -> newly-scaffolded local slug, session-only. The project
  // picker snapshot won't reflect a scaffold until it is fetched again, so
  // this cache keeps the current renderer session consistent meanwhile.
  const [scaffoldedSlugs, setScaffoldedSlugs] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const initializedFromPrefs = useRef(false);
  const appliedLaunchQuery = useRef<string | null>(null);
  const archiveLoaded = useRef(false);

  // requestId -> the thread it belongs to, so a chunk/result arriving after
  // the user has switched tabs still lands in the right thread instead of
  // the currently-displayed one.
  const requestThreadMap = useRef<Record<string, ThreadKey>>({});
  // CLI output can arrive as many small line events. Buffer briefly so one response does not
  // force a full chat-tree render and local-history debounce reset for every tiny chunk.
  const chunkBuffers = useRef<Record<string, string>>({});
  const chunkTimers = useRef<Record<string, number>>({});

  const discardBufferedChunks = useCallback((requestId: string) => {
    const timer = chunkTimers.current[requestId];
    if (timer !== undefined) window.clearTimeout(timer);
    delete chunkTimers.current[requestId];
    delete chunkBuffers.current[requestId];
  }, []);

  useEffect(() => {
    if (chatHiddenOnRoute || projectsLoaded) return;
    let cancelled = false;
    void fetch("/api/chat/projects", { cache: "no-store" })
      .then((response) => response.ok
        ? response.json()
        : Promise.reject(new Error("Project picker unavailable.")))
      .then((payload: { projects?: ChatWidgetProject[] }) => {
        if (!cancelled) setProjects(Array.isArray(payload.projects) ? payload.projects : []);
      })
      .catch(() => {
        // A root chat with no project picker remains useful when local project data is unavailable.
      })
      .finally(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chatHiddenOnRoute, projectsLoaded]);

  // That fetch runs once for the lifetime of this widget, which outlives every route change.
  // Clearing the loaded flag re-runs it, so a project created after it first resolved becomes
  // launchable immediately instead of only after the window is reopened.
  useEffect(() => {
    const onProjectListChanged = () => {
      setProjectsLoaded(false);
      // "not available locally" was decided against the list being replaced, and this banner
      // is sticky state rather than derived -- left alone it would keep accusing a project
      // that just became available. A slug that is still missing is reported again on send.
      setProjectLaunchError(null);
    };
    window.addEventListener(PROJECT_LIST_CHANGED_EVENT, onProjectListChanged);
    return () => window.removeEventListener(PROJECT_LIST_CHANGED_EVENT, onProjectListChanged);
  }, []);

  // Resolve local and just-scaffolded project slugs through one launch contract.
  const displayProjects = useMemo(
    () =>
      projects.map((p) => {
        const slug = p.slug ?? scaffoldedSlugs[p.notionPageId] ?? null;
        return { ...p, slug, optionValue: slug ?? `notion:${p.notionPageId}` };
      }),
    [projects, scaffoldedSlugs],
  );
  const availableProjectSlugs = useMemo(
    () => displayProjects.flatMap((project) => project.slug ? [project.slug] : []),
    [displayProjects],
  );
  // Root-chat (no single project in scope) schedule-item proposals need a project to
  // target -- this is that picker's option list, sorted for a stable, scannable dropdown.
  // Also reused by ChatProjectTabs' "+ New chat" picker.
  const projectPickerOptions = useMemo(
    () =>
      displayProjects
        .filter((project): project is typeof project & { slug: string } => Boolean(project.slug))
        .map((project) => ({ slug: project.slug, name: project.name, notionLinked: Boolean(project.notionPageId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [displayProjects],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const engine = activeTab.engine;
  const model = threads[activeTab.threadKey]?.model ?? modelsByEngine[engine];

  const activeProjectChat = useMemo(
    () => resolveProjectChatLaunch({
      requestedSlug: activeTab.projectSlug,
      availableSlugs: availableProjectSlugs,
      engine,
      model: model || null,
    }),
    [availableProjectSlugs, engine, model, activeTab.projectSlug],
  );
  const threadKey = activeTab.threadKey;
  const activeThread = threads[threadKey] ?? emptyThread({
    engine,
    model,
    projectSlug: activeTab.projectSlug,
  });
  const selectedProject = displayProjects.find(
    (project) => project.slug === activeProjectChat.projectSlug,
  );
  const selectedProjectSlug = activeProjectChat.projectSlug === ROOT_PROJECT_VALUE
    ? null
    : activeProjectChat.projectSlug;

  const updateThread = useCallback((key: ThreadKey, updater: (thread: ThreadState) => ThreadState) => {
    setThreads((prev) => ({
      ...prev,
      [key]: updater(prev[key] ?? emptyThread({
        engine,
        model,
        projectSlug: activeTab.projectSlug,
      })),
    }));
  }, [activeTab.projectSlug, engine, model]);

  useEffect(() => {
    if (!projectsLoaded || initializedFromPrefs.current) return;
    initializedFromPrefs.current = true;
    setMounted(true);
    const prefs = loadChatWidgetPreferences(window.localStorage, preferencesStorageKey);
    setCollapsed(isCompactChat || searchParams.has("project") ? false : prefs.collapsed);
    setModelsByEngine(prefs.modelsByEngine);
    const restoredThreads = loadChatHistory(window.localStorage);

    // Normalize each restored tab's project slug against what's actually available locally --
    // a project removed since the last session shouldn't leave a dangling tab pointed at it.
    const requestedFreshWindow = searchParams.get("newChat") === "1";
    const sourceTabs = requestedFreshWindow
      ? [createTab(searchParams.get("engine") === "codex" ? "codex" : "claude", ROOT_PROJECT_VALUE)]
      : prefs.tabs;
    const restoredTabs = sourceTabs.map((tab) => {
      const launch = resolveProjectChatLaunch({
        requestedSlug: tab.projectSlug,
        availableSlugs: availableProjectSlugs,
        engine: tab.engine,
        model: prefs.modelsByEngine[tab.engine] || null,
      });
      return launch.projectSlug === tab.projectSlug
        ? tab
        : { ...tab, projectSlug: launch.projectSlug, threadKey: crypto.randomUUID() };
    });
    const restoredActiveId = restoredTabs.some((t) => t.id === prefs.activeTabId)
      ? prefs.activeTabId
      : restoredTabs[0].id;

    const launchEngineParam = searchParams.get("engine");
    const requestedSlug = searchParams.has("project") ? searchParams.get("project") : undefined;

    let finalTabs = restoredTabs;
    let finalActiveId = restoredActiveId;
    let launchError: string | null = null;
    if (requestedSlug !== undefined) {
      const tabEngine: AgentEngine = launchEngineParam === "claude" || launchEngineParam === "codex"
        ? launchEngineParam
        : restoredTabs.find((t) => t.id === restoredActiveId)?.engine ?? "claude";
      const launch = resolveProjectChatLaunch({
        requestedSlug,
        availableSlugs: availableProjectSlugs,
        engine: tabEngine,
        model: prefs.modelsByEngine[tabEngine] || null,
      });
      const opened = openTabHelper(restoredTabs, restoredActiveId, { engine: tabEngine, projectSlug: launch.projectSlug });
      finalTabs = opened.tabs;
      finalActiveId = opened.activeTabId;
      launchError = launch.error;
    }

    for (const tab of finalTabs) {
      restoredThreads[tab.threadKey] ??= emptyThread({
        engine: tab.engine,
        model: prefs.modelsByEngine[tab.engine] || null,
        projectSlug: tab.projectSlug,
      });
    }
    setThreads(restoredThreads);
    setTabs(finalTabs);
    setActiveTabId(finalActiveId);
    setProjectLaunchError(launchError);

    setProjectAiTab(resolveProjectAiTab(searchParams.get("projectAi")));
    appliedLaunchQuery.current = searchParams.toString();
  }, [availableProjectSlugs, isCompactChat, preferencesStorageKey, projectsLoaded, searchParams]);

  useEffect(() => {
    if (!mounted || archiveLoaded.current || (!isHome && !isCompactChat && collapsed)) return;
    archiveLoaded.current = true;
    void fetch("/api/chat/history?scope=main", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Chat archive unavailable.")))
      .then((payload: { conversations?: ExportableChat[] }) => {
        const archived = Object.fromEntries((payload.conversations ?? []).map((conversation) => [
          conversation.id,
          {
            messages: conversation.messages.map((message) => ({
              ...message,
              id: message.id ?? crypto.randomUUID(),
              createdAt: Number(message.createdAt),
              pending: false,
            })),
            sessionId: conversation.sessionId ?? null,
            activeRequestId: null,
            title: conversation.title,
            engine: conversation.engine === "codex" ? "codex" : "claude",
            model: conversation.model,
            projectSlug: conversation.projectSlug ?? ROOT_PROJECT_VALUE,
            createdAt: Number(conversation.createdAt),
            updatedAt: Number(conversation.updatedAt),
          } satisfies ThreadState,
        ]));
        setThreads((current) => mergeChatHistories(current, archived));
      })
      .catch(() => {
        // localStorage remains a complete working fallback when the local server archive is unavailable.
      });
  }, [collapsed, isCompactChat, isHome, mounted]);

  const retargetActiveTab = useCallback((nextProjectSlug: string) => {
    const nextThreadKey = crypto.randomUUID();
    setTabs((current) => current.map((t) => (
      t.id === activeTabId ? { ...t, projectSlug: nextProjectSlug, threadKey: nextThreadKey } : t
    )));
    setThreads((current) => ({
      ...current,
      [nextThreadKey]: emptyThread({ engine, model, projectSlug: nextProjectSlug }),
    }));
  }, [activeTabId, engine, model]);

  /** Opens (or activates) a tab for the given project, used by both the URL-driven launch
   * effect below and the PROJECT_CHAT_OPEN_EVENT listener (project pages' "Discuss this
   * project's schedule with the agent" button, etc.) -- and by the tab strip's own
   * "+ New chat" picker. */
  const openProjectTab = useCallback((
    slug: string | undefined,
    tabEngine: AgentEngine,
    tabKind: ProjectAiPanelTab = "chat",
    forceNew = false,
  ) => {
    const launch = resolveProjectChatLaunch({
      requestedSlug: slug,
      availableSlugs: availableProjectSlugs,
      engine: tabEngine,
      model: modelsByEngine[tabEngine] || null,
    });
    const opened = openTabHelper(
      tabs,
      activeTabId,
      { engine: tabEngine, projectSlug: launch.projectSlug },
      { forceNew },
    );
    const openedTab = opened.tabs.find((tab) => tab.id === opened.activeTabId);
    if (openedTab) {
      setThreads((current) => ({
        ...current,
        [openedTab.threadKey]: current[openedTab.threadKey] ?? emptyThread({
          engine: tabEngine,
          model: modelsByEngine[tabEngine] || null,
          projectSlug: launch.projectSlug,
        }),
      }));
    }
    setTabs(opened.tabs);
    setActiveTabId(opened.activeTabId);
    setProjectLaunchError(launch.error);
    setProjectAiTab(tabKind);
    setCollapsed(false);
  }, [tabs, activeTabId, availableProjectSlugs, modelsByEngine]);

  // Search parameters are reactive in the App Router. This keeps a direct
  // load and a client-side project workspace launch on the same contract.
  useEffect(() => {
    if (!initializedFromPrefs.current || !searchParams.has("project")) return;
    if (appliedLaunchQuery.current === searchParams.toString()) return;
    appliedLaunchQuery.current = searchParams.toString();
    const nextTabKind = resolveProjectAiTab(searchParams.get("projectAi"));
    openProjectTab(searchParams.get("project") ?? undefined, engine, nextTabKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openProjectTab already depends on engine/availableProjectSlugs/modelsByEngine/tabs/activeTabId; this effect should only actually re-run on a real searchParams change
  }, [searchParams, openProjectTab]);

  // Project workspace actions announce their exact target to this persistent
  // layout widget, opening (or focusing) the matching tab without leaving the project.
  useEffect(() => {
    function onOpenProjectChat(event: Event) {
      const detail = (event as CustomEvent<Partial<ProjectChatOpenDetail>>).detail;
      if (detail?.fresh && (tabs.length >= MAX_OPEN_TABS || !detail.slug || !availableProjectSlugs.includes(detail.slug))) {
        const error = tabs.length >= MAX_OPEN_TABS ? "Close a chat tab before continuing this handoff in a new session." : "This project's chat is not ready. Wait for the project list to load and try again.";
        setProjectLaunchError(error);
        setCollapsed(false);
        if (typeof detail.onResult === "function") detail.onResult(error);
        return;
      }
      openProjectTab(detail?.slug, engine, resolveProjectAiTab(detail?.tab), detail?.fresh === true);
      if (typeof detail?.prompt === "string") setInput(detail.prompt.slice(0, 30000));
      if (typeof detail?.onResult === "function") detail.onResult(null);
    }
    window.addEventListener(PROJECT_CHAT_OPEN_EVENT, onOpenProjectChat);
    return () => window.removeEventListener(PROJECT_CHAT_OPEN_EVENT, onOpenProjectChat);
  }, [openProjectTab, engine, tabs.length, availableProjectSlugs]);

  useEffect(() => {
    if (!mounted) return;
    const prefs: ChatWidgetPreferences = { collapsed, modelsByEngine, tabs, activeTabId };
    try {
      window.localStorage.setItem(preferencesStorageKey, JSON.stringify(prefs));
    } catch {
      // Private browsing and managed devices may disable local storage.
    }
  }, [mounted, collapsed, modelsByEngine, tabs, activeTabId, preferencesStorageKey]);

  useEffect(() => {
    if (!mounted || (!isHome && collapsed)) return;
    const timer = window.setTimeout(() => {
      const latest = loadChatHistory(window.localStorage);
      const merged = mergeChatHistories(latest, threads);
      try {
        window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, serializeChatHistory(merged));
      } catch {
        // The server archive below remains the durable fallback when local
        // storage is unavailable or a device enforces a smaller quota.
      }
      const conversations = Object.entries(merged)
        .filter(([, thread]) => thread.messages.length > 0)
        .map(([id, thread]) => ({
          id,
          title: thread.title,
          engine: thread.engine,
          model: thread.model,
          projectSlug: thread.projectSlug,
          sessionId: thread.sessionId,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messages: thread.messages.map(({ id: messageId, role, text, createdAt }) => ({
            id: messageId, role, text, createdAt,
          })),
        }));
      if (conversations.length > 0) {
        void fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "main", conversations }),
        }).catch(() => {});
      }
    }, Object.values(threads).some(thread => thread.messages.some(message => message.pending)) ? 1500 : 250);
    return () => window.clearTimeout(timer);
  }, [collapsed, isHome, mounted, threads]);

  useEffect(() => {
    if (!mounted) return;
    function syncHistory(event: StorageEvent) {
      if (event.key !== CHAT_HISTORY_STORAGE_KEY || !event.newValue) return;
      const incoming = loadChatHistory({ getItem: () => event.newValue });
      setThreads((current) => mergeChatHistories(current, incoming));
    }
    window.addEventListener("storage", syncHistory);
    return () => window.removeEventListener("storage", syncHistory);
  }, [mounted]);

  // Registered once at mount — never after a send — so there's no window
  // where a chunk could arrive before something is listening for it (see
  // the same race called out in electron/main.js's agent:send handler).
  useEffect(() => {
    if (!mounted || !window.electronAPI) return;
    const off = window.electronAPI.agent.onChunk(({ requestId, chunk }) => {
      chunkBuffers.current[requestId] = (chunkBuffers.current[requestId] ?? "") + chunk;
      if (chunkTimers.current[requestId] !== undefined) return;
      chunkTimers.current[requestId] = window.setTimeout(() => {
        delete chunkTimers.current[requestId];
        const buffered = chunkBuffers.current[requestId] ?? "";
        delete chunkBuffers.current[requestId];
        const key = requestThreadMap.current[requestId];
        if (!key || !buffered) return;
        updateThread(key, (thread) => ({
          ...thread,
          messages: thread.messages.map((m) =>
            m.id === requestId ? { ...m, text: m.text + buffered } : m
          ),
        }));
      }, 50);
    });
    return () => {
      off();
      for (const timer of Object.values(chunkTimers.current)) window.clearTimeout(timer);
      chunkTimers.current = {};
      chunkBuffers.current = {};
    };
  }, [mounted, updateThread]);

  const setEngine = useCallback((next: AgentEngine) => {
    const nextThreadKey = crypto.randomUUID();
    setTabs((current) => current.map((t) => (
      t.id === activeTabId ? { ...t, engine: next, threadKey: nextThreadKey } : t
    )));
    setThreads((current) => ({
      ...current,
      [nextThreadKey]: emptyThread({
        engine: next,
        model: modelsByEngine[next] || null,
        projectSlug: activeTab.projectSlug,
      }),
    }));
  }, [activeTab.projectSlug, activeTabId, modelsByEngine]);

  const setModel = useCallback(
    (next: string) => {
      setModelsByEngine((previous) => updateProviderModel(previous, engine, next));
      const nextThreadKey = crypto.randomUUID();
      setTabs((current) => current.map((tab) => (
        tab.id === activeTabId ? { ...tab, threadKey: nextThreadKey } : tab
      )));
      setThreads((current) => ({
        ...current,
        [nextThreadKey]: emptyThread({
          engine,
          model: next,
          projectSlug: activeTab.projectSlug,
        }),
      }));
    },
    [activeTab.projectSlug, activeTabId, engine],
  );

  const handleProjectChange = useCallback(
    async (optionValue: string) => {
      if (optionValue === ROOT_PROJECT_VALUE) {
        const launch = resolveProjectChatLaunch({
          requestedSlug: ROOT_PROJECT_VALUE,
          availableSlugs: availableProjectSlugs,
          engine,
          model: modelsByEngine[engine] || null,
        });
        retargetActiveTab(launch.projectSlug);
        setProjectLaunchError(launch.error);
        return;
      }
      const entry = displayProjects.find((p) => p.optionValue === optionValue);
      if (!entry) {
        const launch = resolveProjectChatLaunch({
          requestedSlug: optionValue,
          availableSlugs: availableProjectSlugs,
          engine,
          model: modelsByEngine[engine] || null,
        });
        retargetActiveTab(launch.projectSlug);
        setProjectLaunchError(launch.error);
        return;
      }
      if (entry.slug) {
        const launch = resolveProjectChatLaunch({
          requestedSlug: entry.slug,
          availableSlugs: availableProjectSlugs,
          engine,
          model: modelsByEngine[engine] || null,
        });
        retargetActiveTab(launch.projectSlug);
        setProjectLaunchError(launch.error);
        return;
      }

      setScaffolding(true);
      try {
        const res = await fetch("/api/projects/scaffold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notionPageId: entry.notionPageId, name: entry.name }),
        });
        if (!res.ok) throw new Error(`Scaffold failed (${res.status})`);
        const data = (await res.json()) as { slug?: unknown };
        const scaffoldedSlug = typeof data.slug === "string" ? data.slug : null;
        const launch = resolveProjectChatLaunch({
          requestedSlug: scaffoldedSlug,
          availableSlugs: scaffoldedSlug
            ? [...availableProjectSlugs, scaffoldedSlug]
            : availableProjectSlugs,
          engine,
          model: modelsByEngine[engine] || null,
        });
        if (launch.error) throw new Error(launch.error);
        setScaffoldedSlugs((prev) => ({ ...prev, [entry.notionPageId]: launch.projectSlug }));
        retargetActiveTab(launch.projectSlug);
        setProjectLaunchError(null);
      } catch (err) {
        console.error("Failed to scaffold project from Notion selection:", err);
        retargetActiveTab(ROOT_PROJECT_VALUE);
        setProjectLaunchError(
          "The project could not be prepared for local chat. Root chat is active.",
        );
      } finally {
        setScaffolding(false);
      }
    },
    [availableProjectSlugs, displayProjects, engine, modelsByEngine, retargetActiveTab],
  );

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id);
    setProjectLaunchError(null);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      const requestId = threads[tab.threadKey]?.activeRequestId;
      if (requestId) window.electronAPI?.agent.cancel(requestId);
    }
    const closed = closeTabHelper(tabs, activeTabId, id);
    setTabs(closed.tabs);
    setActiveTabId(closed.activeTabId);
    setProjectLaunchError(null);
  }, [tabs, activeTabId, threads]);

  const tabItems: ChatProjectTabItem[] = useMemo(
    () =>
      tabs.map((tab) => {
        const label = tab.projectSlug === ROOT_PROJECT_VALUE
          ? "No project"
          : displayProjects.find((p) => p.slug === tab.projectSlug)?.name ?? tab.projectSlug;
        return {
          id: tab.id,
          label,
          active: tab.id === activeTabId,
          pending: Boolean(threads[tab.threadKey]?.activeRequestId),
        };
      }),
    [tabs, activeTabId, displayProjects, threads],
  );

  const conversationHistory = useMemo(
    () => Object.entries(threads)
      .filter(([, thread]) => thread.messages.length > 0)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
    [threads],
  );

  const startFreshConversation = useCallback(() => {
    const nextThreadKey = crypto.randomUUID();
    setTabs((current) => current.map((tab) => (
      tab.id === activeTabId ? { ...tab, threadKey: nextThreadKey } : tab
    )));
    setThreads((current) => ({
      ...current,
      [nextThreadKey]: emptyThread({
        engine,
        model,
        projectSlug: activeTab.projectSlug,
      }),
    }));
    setProjectAiTab("chat");
    setInput("");
    setAttachments([]);
  }, [activeTab.projectSlug, activeTabId, engine, model]);

  const reviveConversation = useCallback((key: string, thread: ThreadState) => {
    setTabs((current) => current.map((tab) => (
      tab.id === activeTabId
        ? {
            ...tab,
            engine: thread.engine,
            projectSlug: thread.projectSlug,
            threadKey: key,
          }
        : tab
    )));
    setModelsByEngine((current) => updateProviderModel(current, thread.engine, thread.model));
    setProjectAiTab("chat");
    setProjectLaunchError(null);
  }, [activeTabId]);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        console.warn(`Skipping "${file.name}" — over the 10MB attachment limit.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : null;
        if (!dataUrl) return;
        setAttachments((prev) =>
          prev.length >= MAX_ATTACHMENTS
            ? prev
            : [...prev, { id: crypto.randomUUID(), name: file.name, dataUrl }],
        );
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const send = useCallback(() => {
    const api = window.electronAPI;
    const prompt = input.trim();
    if (!api || !modelSelectionValid || (!prompt && attachments.length === 0)) return;
    if (activeProjectChat.error) {
      setProjectLaunchError(activeProjectChat.error);
      return;
    }
    setInput("");
    const sentAttachments = attachments;
    setAttachments([]);

    const key = activeTab.threadKey;
    const cwd = activeProjectChat.cwd;
    const requestId = crypto.randomUUID();
    const sessionIdAtSend = threads[key]?.sessionId ?? null;
    const displayText =
      sentAttachments.length > 0
        ? `${prompt}${prompt ? "\n\n" : ""}📎 ${sentAttachments.map((a) => a.name).join(", ")}`
        : prompt;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: displayText,
      createdAt: Date.now(),
    };
    const pendingMessage: ChatMessage = {
      id: requestId,
      role: "assistant",
      text: "",
      pending: true,
      createdAt: Date.now(),
    };

    requestThreadMap.current[requestId] = key;
    updateThread(key, (thread) => ({
      ...thread,
      title: thread.messages.length === 0 && prompt
        ? prompt.replace(/\s+/g, " ").slice(0, 60)
        : thread.title,
      engine,
      model,
      projectSlug: activeTab.projectSlug,
      updatedAt: Date.now(),
      messages: [...thread.messages, userMessage, pendingMessage],
      activeRequestId: requestId,
    }));

    reportMiActivity({ id: requestId, scope: activeTab.projectSlug === ROOT_PROJECT_VALUE ? "studio" : `projects/${activeTab.projectSlug}`,
      label: activeTab.projectSlug === ROOT_PROJECT_VALUE ? "Studio chat" : `Project · ${activeTab.projectSlug}`.slice(0,100),
      href: activeTab.projectSlug === ROOT_PROJECT_VALUE ? "/" : `/projects/${activeTab.projectSlug}?project=${activeTab.projectSlug}`, state: "running" });
    api.agent
      .send({
        requestId,
        engine,
        cwd,
        prompt,
        sessionId: sessionIdAtSend,
        model: model || null,
        images: sentAttachments.map((a) => ({ name: a.name, dataUrl: a.dataUrl })),
      })
      .then((result) => {
        discardBufferedChunks(requestId);
        delete requestThreadMap.current[requestId];
        // Parsed regardless of whether a project is in scope: root/holistic chat can now
        // also emit a schedule-item proposal (with an explicit project name in it, per
        // holisticPlanningInstructions) -- ProjectCopilotProposalList's project picker
        // handles confirming it into the right project.
        const parsedReply = !result.isError
          ? parseProjectCopilotReply(result.fullOutput)
          : { text: result.fullOutput, proposals: [], proposalError: null };
        finishMiActivity(requestId, result.isError || parsedReply.proposalError ? "attention" : parsedReply.proposals.length ? "review" : "finished");
        updateThread(key, (thread) => ({
          ...thread,
          sessionId: result.sessionId ?? thread.sessionId,
          updatedAt: Date.now(),
          activeRequestId: thread.activeRequestId === requestId ? null : thread.activeRequestId,
          messages: thread.messages.map((m) =>
            m.id === requestId
              ? {
                  ...m,
                  role: result.isError ? "error" : "assistant",
                  text: parsedReply.text || m.text,
                  proposals: parsedReply.proposals,
                  proposalError: parsedReply.proposalError,
                  pending: false,
                }
              : m
          ),
        }));
      })
      .catch((err: unknown) => {
        finishMiActivity(requestId, "attention");
        discardBufferedChunks(requestId);
        delete requestThreadMap.current[requestId];
        const rawMessage = err instanceof Error ? err.message : String(err);
        const isWorkspaceGate = /agent workspace/i.test(rawMessage);
        const workspaceProjectSlug =
          isWorkspaceGate && activeProjectChat.projectSlug !== ROOT_PROJECT_VALUE
            ? activeProjectChat.projectSlug
            : null;
        const message = workspaceProjectSlug
          ? `This project's agent workspace hasn't been confirmed yet, so Mi won't launch an agent in it. Go to this project's Files & Contracts page and click "Repair/Refresh Agent Workspace" to set it up, then try again.`
          : isWorkspaceGate
            ? `${rawMessage} Pick this project from "Project context" above, then open its Files & Contracts page to repair the workspace.`
            : rawMessage;
        updateThread(key, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          activeRequestId: thread.activeRequestId === requestId ? null : thread.activeRequestId,
          messages: thread.messages.map((m) =>
            m.id === requestId
              ? { ...m, role: "error", text: message, pending: false, workspaceRepairSlug: workspaceProjectSlug }
              : m
          ),
        }));
      });
  }, [
    input,
    attachments,
    activeProjectChat,
    activeTab,
    engine,
    model,
    modelSelectionValid,
    threads,
    updateThread,
    discardBufferedChunks,
  ]);

  const cancel = useCallback(() => {
    const api = window.electronAPI;
    const requestId = activeThread.activeRequestId;
    if (!api || !requestId) return;
    requestMiActivityStop(requestId);
    api.agent.cancel(requestId);
  }, [activeThread.activeRequestId]);

  if (!mounted) return null;
  if (chatHiddenOnRoute) return pathname === "/onboarding" || pathname.endsWith("/window") ? null : <MiniMiHelper key={pathname} pending={Object.values(threads).some(t => t.activeRequestId !== null)} />;

  const api = window.electronAPI;
  const controlClass =
    "w-full rounded-md border border-border bg-card px-2 py-1 text-xs outline-none transition-colors focus:border-accent disabled:opacity-50";
  const controlGroupClass = "min-w-36 flex-1";
  const controlLabelClass = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

  const selectedProjectNotionLinked = Boolean(selectedProject?.notionPageId);
  const exportableConversations: ExportableChat[] = conversationHistory.map(([key, thread]) => ({
    id: key,
    title: thread.title,
    engine: thread.engine,
    model: thread.model,
    projectSlug: thread.projectSlug === ROOT_PROJECT_VALUE ? undefined : thread.projectSlug,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages: thread.messages.map(({ role, text, createdAt }) => ({ role, text, createdAt })),
  }));
  const projectPanelContext = getProjectChatPanelContext({
    pathname,
    projectSlug: selectedProjectSlug,
    projectName: selectedProject?.name ?? null,
  });
  const projectContextHeader = projectPanelContext.projectHref ? (
    <div className="min-w-0 pr-10">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {projectPanelContext.embeddedInProject ? "Project workspace chat" : "Project chat"}
      </p>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={projectPanelContext.projectName ?? undefined}>
          {projectPanelContext.projectName}
        </p>
        <Link
          href={projectPanelContext.projectHref}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Back to project
        </Link>
      </div>
    </div>
  ) : null;
  const tabStrip = (
    <ChatProjectTabs
      tabs={tabItems}
      options={projectPickerOptions}
      onSelect={selectTab}
      onClose={handleCloseTab}
      onOpen={(slug) => openProjectTab(slug, engine, projectAiTab === "terminal" ? "terminal" : "chat", true)}
      canOpenMore={tabs.length < MAX_OPEN_TABS}
    />
  );
  const historySidebar = (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
      <div className="border-b border-border p-3">
        <ChatActions
          path="/"
          conversations={exportableConversations}
          activeConversationId={threadKey}
          onNewChat={startFreshConversation}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Chat history">
        <p className="px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          History · {conversationHistory.length}
        </p>
        {conversationHistory.map(([key, thread]) => {
          const projectName = thread.projectSlug === ROOT_PROJECT_VALUE
            ? "Firm-wide"
            : displayProjects.find((project) => project.slug === thread.projectSlug)?.name
              ?? thread.projectSlug;
          return (
            <button
              key={key}
              type="button"
              onClick={() => reviveConversation(key, thread)}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left transition-colors ${
                key === threadKey
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              }`}
            >
              <span className="block truncate text-xs font-medium">{thread.title}</span>
              <span className="mt-0.5 block truncate text-[10px]">
                {projectName} · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(thread.updatedAt)}
              </span>
            </button>
          );
        })}
        {conversationHistory.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">Past chats will appear here.</p>
        )}
      </div>
    </aside>
  );
  const controls = (
    <div className="flex flex-1 flex-wrap gap-2">
      <label className={controlGroupClass}>
        <span className={controlLabelClass}>Agent</span>
        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value as AgentEngine)}
          className={controlClass}
        >
          {AGENT_PROVIDER_ORDER.map((providerEngine) => (
            <option key={providerEngine} value={providerEngine}>
              {AGENT_PROVIDERS[providerEngine].agentLabel}
            </option>
          ))}
        </select>
      </label>
      <AgentModelPicker
        key={engine}
        engine={engine}
        model={model}
        onModelChange={setModel}
        onValidityChange={setModelSelectionValid}
        controlClassName={controlClass}
        groupClassName={controlGroupClass}
        labelClassName={controlLabelClass}
      />
      <label className={controlGroupClass}>
        <span className={controlLabelClass}>Project context</span>
        <select
          value={activeProjectChat.projectSlug}
          onChange={(e) => handleProjectChange(e.target.value)}
          disabled={scaffolding}
          className={controlClass}
        >
          <option value={ROOT_PROJECT_VALUE}>No project</option>
          {displayProjects.map((p) => (
            <option key={p.notionPageId || p.optionValue} value={p.optionValue}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const launchError = projectLaunchError ?? activeProjectChat.error;
  const launchErrorAlert = launchError ? (
    <div
      role="alert"
      className="border-b border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
    >
      {launchError}
    </div>
  ) : null;

  const showInterview = projectAiTab === "interview" && Boolean(selectedProjectSlug);
  const showTerminal = projectAiTab === "terminal" && Boolean(selectedProjectSlug);
  const showChat = !showTerminal && !showInterview;
  // Each host can scroll when its header and controls exceed the available window height.
  // Keep the terminal usable instead of fitting it into the few pixels left by the header.
  const body = showTerminal && selectedProjectSlug ? (
    <div className="min-h-[24rem] flex-1 shrink-0 overflow-hidden" aria-label="Project terminal">
      <WorkspaceTerminal key={selectedProjectSlug} workspace={`projects/${selectedProjectSlug}`} />
    </div>
  ) : showInterview && selectedProjectSlug ? (
    <ProjectInterviewPanel
      key={makeThreadKey(engine, model, selectedProjectSlug, "interview")}
      projectSlug={selectedProjectSlug}
      engine={engine}
      model={model}
      notionLinked={selectedProjectNotionLinked}
    />
  ) : !api ? (
    <div className="flex min-h-32 flex-1 shrink-0 items-center justify-center p-4 text-center text-sm text-muted-foreground">
      Chat is only available in the desktop app (<code>npm run electron:dev</code>) — a plain
      browser tab has no local CLI to run.
    </div>
  ) : (
    <ChatThread
      messages={activeThread.messages}
      projectSlug={selectedProjectSlug}
      notionLinked={selectedProjectNotionLinked}
      projectOptions={projectPickerOptions}
    />
  );

  const projectAiTabs = selectedProjectSlug ? (
    <div className="mt-3 space-y-2">
    {showChat && <ProjectPdfFinder key={selectedProjectSlug} slug={selectedProjectSlug} onChoose={reference => setInput(current => `${current}${current ? "\n" : ""}Read this project PDF: ${reference}`)} />}
    <div className="flex gap-1 rounded-md border border-border bg-background p-1" role="tablist" aria-label="Talk to Mi project tools">
      {(["chat", "terminal", "interview"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={projectAiTab === tab}
          onClick={() => setProjectAiTab(tab)}
          className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            projectAiTab === tab ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab === "chat" ? "Chat" : tab === "terminal" ? "Terminal" : "Guided setup"}
        </button>
      ))}
    </div>
    </div>
  ) : null;

  const inputForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragOver={(e) => {
        if (!api) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!api) return;
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
      }}
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="group relative h-14 w-14 overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob/data URL preview, not a served asset */}
              <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
                className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-background/80 text-[10px] text-foreground opacity-0 transition-opacity group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!api}
          aria-label="Attach image"
          title="Attach image"
          className="flex items-center justify-center rounded-md border border-border px-2.5 text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M21.44 11.05 12.5 20a4.5 4.5 0 0 1-6.36-6.36l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.19 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49" />
          </svg>
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            if (!api) return;
            const files = Array.from(e.clipboardData.items)
              .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length > 0) addFiles(files);
          }}
          placeholder="Message... (drag, paste, or attach an image)"
          rows={1}
          disabled={!api}
          className="min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
        />
        {activeThread.activeRequestId ? (
          <button
            type="button"
            onClick={cancel}
            aria-label="Stop generating"
            title="Stop generating"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-current" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={
              !api || !modelSelectionValid || (!input.trim() && attachments.length === 0)
            }
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground transition-opacity disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </form>
  );

  async function compactWindowAction(
    action: "hide" | "minimize" | "toggle-pin" | "collapse",
    nextCollapsed?: boolean,
  ) {
    if (action === "collapse" && typeof nextCollapsed === "boolean") {
      setCompactCollapsed(nextCollapsed);
    }
    if (!api?.windows.compactChatAction) {
      if (action === "hide") window.close();
      return;
    }
    try {
      const state = await api.windows.compactChatAction(action, nextCollapsed);
      setCompactPinned(state.pinned);
    } catch (error) {
      setProjectLaunchError(error instanceof Error ? error.message : String(error));
    }
  }

  if (isCompactChat) {
    const contextLabel = selectedProject?.name ?? "Firm-wide";
    const compactHeader = (
      <div className="mi-window-drag flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-2 backdrop-blur">
        <ProfileAvatar className="h-7 w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">Mi Chat</p>
          <p className="truncate text-[10px] text-muted-foreground" title={contextLabel}>{contextLabel}</p>
        </div>
        <div className="mi-window-no-drag flex items-center gap-1">
          {!compactCollapsed && (
            <button
              type="button"
              onClick={() => {
                if (api?.windows.openCompactChat) void api.windows.openCompactChat(undefined, "personal");
                else window.location.href = "/personal/window";
              }}
              title="Switch to private Personal chat"
              className="tactile-control rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Personal
            </button>
          )}
          {!compactCollapsed && (
            <button type="button" onClick={startFreshConversation} title="New chat" aria-label="New chat" className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">+</button>
          )}
          <button
            type="button"
            onClick={() => void compactWindowAction("toggle-pin")}
            title={compactPinned ? "Unpin from top" : "Keep on top"}
            aria-label={compactPinned ? "Unpin compact chat" : "Pin compact chat on top"}
            aria-pressed={compactPinned}
            className={`tactile-control flex h-7 w-7 items-center justify-center rounded text-xs hover:bg-muted ${compactPinned ? "text-accent" : "text-muted-foreground"}`}
          >
            ◇
          </button>
          <button
            type="button"
            onClick={() => void compactWindowAction("collapse", !compactCollapsed)}
            title={compactCollapsed ? "Expand chat" : "Collapse to chat bar"}
            aria-label={compactCollapsed ? "Expand compact chat" : "Collapse compact chat to bar"}
            className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {compactCollapsed ? "□" : "▁"}
          </button>
          {!compactCollapsed && api && (
            <button type="button" onClick={() => void compactWindowAction("minimize")} title="Minimize" aria-label="Minimize compact chat" className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">−</button>
          )}
          <button type="button" onClick={() => void compactWindowAction("hide")} title="Hide" aria-label="Hide compact chat" className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
        </div>
      </div>
    );

    if (compactCollapsed) {
      return (
        <div className="fixed inset-0 flex flex-col overflow-y-auto bg-card text-foreground">
          {compactHeader}
          <form
            onSubmit={(event) => { event.preventDefault(); send(); }}
            className="mi-window-no-drag flex min-h-0 flex-1 items-center gap-2 px-2 py-2"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Message ${contextLabel}`}
              disabled={!api}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
            />
            {activeThread.activeRequestId ? (
              <button type="button" onClick={cancel} className="tactile-control rounded-md border border-border px-3 py-2 text-xs">Stop</button>
            ) : (
              <button type="submit" disabled={!api || !modelSelectionValid || !input.trim()} className="tactile-control rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground disabled:opacity-50">Send</button>
            )}
          </form>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 flex flex-col overflow-y-auto bg-card text-foreground">
        {compactHeader}
        <div className="shrink-0 px-3 pb-2">{tabStrip}{projectAiTabs}</div>
        {showChat && <details className="progressive-disclosure mi-window-no-drag shrink-0 border-b border-border bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Context & model · {contextLabel}
          </summary>
          <div className="mt-2">{controls}</div>
        </details>}
        {launchErrorAlert}
        <div className="min-h-48 flex flex-1 shrink-0 flex-col">{body}</div>
        {showChat && inputForm}
      </div>
    );
  }

  if (isHome) {
    return (
      <div id="mi-studio-chat" className="relative w-full bg-background">
        <MiniMiHelper key={pathname} pending={Object.values(threads).some(t => t.activeRequestId !== null)} onChat={() => {
          document.getElementById("mi-studio-chat")?.scrollIntoView({ behavior: "instant", block: "start" });
          document.querySelector<HTMLTextAreaElement>("#mi-studio-chat textarea")?.focus();
        }} />
        {/* max-w-5xl, matching components/Nav.tsx's header and app/layout.tsx's page container.
            At 6xl the home page sat a size step wider than the nav above it, so the left edges
            visibly disagreed. */}
        <div className="mx-auto flex h-[min(70vh,46rem)] w-full max-w-5xl overflow-hidden border-x border-border">
          {historySidebar}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="shrink-0 border-b border-border pb-4">
            <div className="mb-3 md:hidden">
              <ChatActions
                path="/"
                conversations={exportableConversations}
                activeConversationId={threadKey}
                onNewChat={startFreshConversation}
                layout="inline"
              />
            </div>
            {projectContextHeader}
            {tabStrip}
            {projectAiTabs}
            {showChat && (
              <div className={projectContextHeader || projectAiTabs ? "mt-3 flex items-center gap-2" : "flex items-center gap-2"}>
                {controls}
              </div>
            )}
          </div>
          {launchErrorAlert}
          {body}
          {showChat && inputForm}
          </div>
        </div>
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 sm:px-6">
          <StudioScheduleCalendar />
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <MiniMiHelper key={pathname} pending={Object.values(threads).some(t => t.activeRequestId !== null)} onChat={() => {
        const projectSlug = /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(pathname)?.[1];
        if (projectSlug && projectSlug !== "analysis") openProjectTab(projectSlug, engine, "chat");
        else setCollapsed(false);
      }} />
    );
  }

  return (
    <div className="mi-chat-window fixed z-50 flex h-[min(40rem,calc(100dvh-6rem))] overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-sm)] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[52rem] sm:max-w-[calc(100vw-3rem)]">
      {historySidebar}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="relative shrink-0 border-b border-border p-3 pr-11">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse project chat"
          title="Collapse project chat"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          ✕
        </button>
        {projectContextHeader}
        {tabStrip}
        {projectAiTabs}
        {showChat && <div className={projectContextHeader || projectAiTabs ? "mt-3" : ""}>{controls}</div>}
      </div>
      {launchErrorAlert}
      {body}
      {showChat && inputForm}
      </div>
    </div>
  );
}
