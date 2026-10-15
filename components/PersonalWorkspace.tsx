"use client";
import { reportMiActivity, finishMiActivity } from "@/lib/miniMi/activity";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { ChatActions } from "@/components/ChatActions";
import { ChatExportMenu, type ExportableChat } from "@/components/ChatExportMenu";
import { MiMark } from "@/components/MiMark";
import { NotionLink } from "@/components/NotionLink";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { PersonalCalendar } from "@/components/PersonalCalendar";
import { PersonalCalendarConnections } from "@/components/PersonalCalendarConnections";
import { PersonalJournalSummary } from "@/components/PersonalJournalSummary";
import { PersonalDayOneTransfer } from "@/components/PersonalDayOneTransfer";
import { PersonalObsidianTransfer } from "@/components/PersonalObsidianTransfer";
import { PersonalStorageLocation } from "@/components/PersonalStorageLocation";
import {
  AdvancedListEmpty,
  AdvancedListField,
  AdvancedListSummary,
  AdvancedListToolbar,
  ListMetric,
  advancedListControlClass,
} from "@/components/AdvancedListUI";
import { AGENT_PROVIDERS, AGENT_PROVIDER_ORDER } from "@/components/agentModels";
import {
  filterAndSortPersonalRecords,
  summarizePersonalRecords,
  type PersonalRecordSort,
  type PersonalStatusFilter,
  type PersonalTimingFilter,
} from "@/components/personalRecordFilters";
import { usePersonalTimezone } from "@/components/usePersonalTimezone";
import { parsePersonalReply } from "@/lib/personal/proposals";
import type {
  PersonalDatabase,
  PersonalConversation,
  PersonalMessage,
  PersonalProposal,
  PersonalRecord,
  PersonalRecordDraft,
  PersonalRecordKind,
  PersonalRecordStatus,
  PersonalSchedule,
} from "@/lib/personal/schema";
import type { PersonalCalendarStatus } from "@/types/electron";
import type { AgentEngine } from "@/types/electron";

interface Props {
  initialDatabase: PersonalDatabase;
  initialHash: string | null;
  startFresh?: boolean;
  compact?: boolean;
}

interface QueuedPersonalMessage {
  id: string;
  prompt: string;
}

const kindLabels: Record<PersonalRecordKind, string> = {
  journal: "Journal",
  thought: "Note",
  task: "To-do",
  plan: "Calendar item",
};

type PersonalView = "todos" | "journal" | "calendar" | "notes" | "assistant";

const personalViews: Array<{ id: PersonalView; label: string; description: string; icon: AppIconName }> = [
  { id: "todos", label: "To-do", description: "Next actions", icon: "task" },
  { id: "journal", label: "Journal", description: "Private writing", icon: "journal" },
  { id: "calendar", label: "Calendar", description: "Time and sharing", icon: "calendar" },
  { id: "notes", label: "Notes", description: "Things to remember", icon: "thought" },
  { id: "assistant", label: "Mi Assistant", description: "Talk it through", icon: "personal" },
];

const kindIcons: Record<PersonalRecordKind, AppIconName> = {
  journal: "journal",
  thought: "thought",
  task: "task",
  plan: "plan",
};

const statusLabels: Record<PersonalRecordStatus, string> = {
  inbox: "Inbox",
  active: "Active",
  done: "Done",
  archived: "Archived",
};

const scheduleTypes = [
  "Deadline",
  "Midterm Deadline",
  "Kick-off",
  "Meeting",
  "Client Meeting",
  "Internal Meeting",
  "Work Session",
] as const;

const timePresets = [
  { label: "Morning · 9–10", start: "09:00", end: "10:00" },
  { label: "Midday · 12–1", start: "12:00", end: "13:00" },
  { label: "Afternoon · 1–2", start: "13:00", end: "14:00" },
  { label: "Deep work · 9–12", start: "09:00", end: "12:00" },
] as const;

function temporaryMessage(role: "user" | "assistant", text: string): PersonalMessage {
  return {
    id: `temporary-${crypto.randomUUID()}`,
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Something went wrong.";
}

function localDateTime(date: string, time: string): string | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function localTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function localDateKey(offsetDays = 0): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function scheduleError(date: string, start: string, end: string): string | null {
  if ((start || end) && !date) return "Choose a date before adding times.";
  if (end && !start) return "Choose a start time before the end time.";
  if (start && end && end <= start) return "End time must be later than start time.";
  return null;
}

function scheduleDraftError(schedule: PersonalSchedule): string | null {
  if (!schedule.name.trim()) return "Add a public schedule title.";
  if (!schedule.date) return "Choose a schedule date.";
  return scheduleError(
    schedule.date,
    localTime(schedule.startTime),
    localTime(schedule.endTime),
  );
}

function parsedTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function captureValidationError(title: string, tags: string): string | null {
  if (title.trim().length > 200) return "Keep the title under 200 characters.";
  const values = parsedTags(tags);
  if (values.length > 20) return "Use no more than 20 tags.";
  if (values.some((tag) => tag.length > 50)) return "Keep each tag under 50 characters.";
  return null;
}

function formatScheduleDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatScheduleTimeRange(schedule: PersonalSchedule): string {
  const start = schedule.startTime ? new Date(schedule.startTime) : null;
  const end = schedule.endTime ? new Date(schedule.endTime) : null;
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  if (start && !Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime())) {
    return `${time.format(start)}–${time.format(end)}`;
  }
  if (start && !Number.isNaN(start.getTime())) return `Starts ${time.format(start)}`;
  return "All day / time not set";
}

function formatRecordedTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function personalCalendarShareFor(record: PersonalRecord) {
  return record.personalCalendarShare ?? ({ status: "local" } as const);
}

function calendarShareLabel(record: PersonalRecord): string {
  const personal = personalCalendarShareFor(record);
  if (record.share.status === "needs-review" || personal.status === "needs-review") return "Calendar review required";
  if (record.share.status === "pending" || personal.status === "pending") return "Calendar result pending";
  if (record.share.status === "shared" && personal.status === "shared") return "Shared to 2 calendars";
  if (record.share.status === "shared") return "Shared to STUDIO";
  if (personal.status === "shared") return "Shared to personal calendar";
  return "Local only";
}

function CompactWindowIcon({ name }: { name: "close" | "minimize" | "pin" | "slim" }) {
  const path = name === "pin"
    ? <path d="m9 4 6 6M14 5l5 5-3 1-4 4-.5 4.5-2-2L5 21l3.5-4.5-2-2 4.5-.5 4-4z" />
    : name === "slim"
      ? <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 14h16" /></>
      : name === "minimize"
        ? <path d="M5 17h14" />
        : <path d="m6 6 12 12M18 6 6 18" />;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}

export function PersonalWorkspace({ initialDatabase, initialHash, startFresh = false, compact = false }: Props) {
  const { timezone } = usePersonalTimezone();
  const [database, setDatabase] = useState(initialDatabase);
  const [hash, setHash] = useState(initialHash);
  const [activeView, setActiveView] = useState<PersonalView>(() => compact || startFresh ? "assistant" : "todos");
  const [personalCalendarStatus, setPersonalCalendarStatus] = useState<PersonalCalendarStatus | null>(null);
  const hashRef = useRef(initialHash);
  const [recordQuery, setRecordQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PersonalStatusFilter>("all");
  const [timingFilter, setTimingFilter] = useState<PersonalTimingFilter>("all");
  const [recordSort, setRecordSort] = useState<PersonalRecordSort>("updated");
  const [kind, setKind] = useState<PersonalRecordKind>("journal");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [mood, setMood] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [planType, setPlanType] = useState<(typeof scheduleTypes)[number]>("Work Session");
  const [input, setInput] = useState("");
  const [engine, setEngine] = useState<AgentEngine>(
    () => startFresh ? "codex" : initialDatabase.conversations[0]?.engine ?? "codex",
  );
  const [model, setModel] = useState(
    () => startFresh ? "" : initialDatabase.conversations[0]?.model ?? "",
  );
  const [activeConversationId, setActiveConversationId] = useState(
    () => startFresh ? crypto.randomUUID() : initialDatabase.conversations[0]?.id ?? crypto.randomUUID(),
  );
  const [modelValid, setModelValid] = useState(true);
  const sessionIdRef = useRef<string | null>(
    startFresh ? null : initialDatabase.conversations[0]?.sessionId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const cancelledRequestIdsRef = useRef(new Set<string>());
  const [stopping, setStopping] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedPersonalMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedPersonalMessage[]>([]);
  const conversationBottomRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposals, setProposals] = useState<PersonalProposal[]>([]);
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null);
  const [shareReviewId, setShareReviewId] = useState<string | null>(null);
  const [shareDraft, setShareDraft] = useState<PersonalSchedule | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<PersonalMessage[]>([]);
  const [compactCollapsed, setCompactCollapsed] = useState(false);
  const [compactPinned, setCompactPinned] = useState(true);

  const viewSourceRecords = useMemo(() => database.records.filter((record) => {
    if (activeView === "todos") return record.kind === "task";
    if (activeView === "journal") return record.kind === "journal";
    if (activeView === "notes") return record.kind === "thought";
    if (activeView === "calendar") return record.kind === "plan" || Boolean(record.schedule);
    return false;
  }), [activeView, database.records]);
  const records = useMemo(() => filterAndSortPersonalRecords(viewSourceRecords, {
    query: recordQuery,
    status: statusFilter,
    timing: timingFilter,
    sort: recordSort,
    today: localDateKey(),
  }), [viewSourceRecords, recordQuery, statusFilter, timingFilter, recordSort]);
  const recordSummary = useMemo(
    () => summarizePersonalRecords(viewSourceRecords),
    [viewSourceRecords],
  );
  const planScheduleError = (kind === "plan" || kind === "task")
    ? scheduleError(planDate, planStart, planEnd)
    : null;
  const captureError = captureValidationError(title, tags) || planScheduleError;
  const shareScheduleError = shareDraft ? scheduleDraftError(shareDraft) : null;
  const recordFiltersActive = Boolean(
    recordQuery.trim()
    || statusFilter !== "all"
    || timingFilter !== "all"
    || recordSort !== "updated",
  );
  const displayRecords = useMemo(() => activeView === "todos"
    ? [
        ...records.filter((record) => record.status === "inbox" || record.status === "active"),
        ...records.filter((record) => record.status === "done"),
        ...records.filter((record) => record.status === "archived"),
      ]
    : records, [activeView, records]);
  const activeConversation = database.conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const exportableConversations = useMemo<ExportableChat[]>(() => database.conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages,
  })), [database.conversations]);
  const messages = useMemo(
    () => [...(activeConversation?.messages ?? []), ...optimisticMessages],
    [activeConversation?.messages, optimisticMessages],
  );
  const fastModel = engine === "codex" ? "gpt-5.6-luna" : "claude-haiku-4-5";
  const fastModelLabel = engine === "codex" ? "GPT-5.6 Luna" : "Claude Haiku 4.5";
  const controlClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50";

  useEffect(() => {
    conversationBottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeRequestId, queuedMessages.length]);

  function selectConversation(conversation: PersonalConversation) {
    if (busy) return;
    setActiveConversationId(conversation.id);
    setEngine(conversation.engine);
    setModel(conversation.model);
    sessionIdRef.current = conversation.sessionId;
    setOptimisticMessages([]);
    setProposals([]);
    setNotice(null);
  }

  function startNewConversation() {
    if (busy) return;
    setActiveConversationId(crypto.randomUUID());
    sessionIdRef.current = null;
    setOptimisticMessages([]);
    setProposals([]);
    setNotice(null);
    setInput("");
  }

  const refresh = useCallback(async () => {
    const response = await fetch("/api/personal/records", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not refresh personal data.");
    setDatabase(result.database);
    setHash(result.hash);
    hashRef.current = result.hash;
    setOptimisticMessages([]);
  }, []);

  useEffect(() => {
    function refreshFromAnotherWindow() {
      if (!busy) void refresh().catch(() => {});
    }
    window.addEventListener("focus", refreshFromAnotherWindow);
    return () => window.removeEventListener("focus", refreshFromAnotherWindow);
  }, [busy, refresh]);

  async function mutate(payload: Record<string, unknown>) {
    const response = await fetch("/api/personal/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, confirmed: true, expectedHash: hashRef.current }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await refresh();
      throw new Error(result.error || "Personal data could not be saved.");
    }
    setDatabase(result.database);
    setHash(result.hash);
    hashRef.current = result.hash;
    setOptimisticMessages([]);
    return result;
  }

  function currentDraft(): PersonalRecordDraft {
    const cleanTitle = title.trim() || body.trim().split(/\r?\n/)[0]?.slice(0, 80) || "Untitled";
    const schedule = (kind === "plan" || kind === "task") && planDate
      ? {
          name: cleanTitle,
          date: planDate,
          type: planType,
          startTime: localDateTime(planDate, planStart),
          endTime: localDateTime(planDate, planEnd),
        }
      : null;
    return {
      kind,
      title: cleanTitle,
      body: body.trim(),
      tags: parsedTags(tags),
      mood: mood.trim() || null,
      status: kind === "journal" || kind === "thought" ? "inbox" : "active",
      schedule,
    };
  }

  async function saveCapture() {
    if ((!title.trim() && !body.trim()) || captureError) return;
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "create", record: currentDraft() });
      setTitle("");
      setBody("");
      setTags("");
      setMood("");
      setPlanDate("");
      setPlanStart("");
      setPlanEnd("");
      setNotice("Saved privately in Mi.");
      reportMiActivity({ id: crypto.randomUUID(), scope: "personal", label: "Private capture", href: "/personal", state: "saved" });
    } catch (error) {
      setOptimisticMessages([]);
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function importObsidianRecords(drafts: PersonalRecordDraft[]) {
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "import-obsidian", records: drafts });
    } finally {
      setBusy(false);
    }
  }

  async function importDayOneRecords(drafts: PersonalRecordDraft[]) {
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "import-dayone", records: drafts });
    } finally {
      setBusy(false);
    }
  }

  function createPlanFromCalendar(date: string) {
    setActiveView("calendar");
    setKind("plan");
    setPlanDate(date);
    setPlanStart("");
    setPlanEnd("");
    window.setTimeout(() => document.getElementById("personal-quick-capture")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function openQuickCapture(nextKind: PersonalRecordKind) {
    setActiveView(nextKind === "task" ? "todos" : nextKind === "journal" ? "journal" : nextKind === "thought" ? "notes" : "calendar");
    setStatusFilter("all");
    setTimingFilter("all");
    setKind(nextKind);
    if (nextKind === "plan" && !planDate) setPlanDate(localDateKey());
    window.setTimeout(() => {
      document.getElementById("personal-quick-capture")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("personal-capture-notes")?.focus({ preventScroll: true });
    }, 0);
  }

  function reviewCalendarSchedule(record: PersonalRecord) {
    if (
      !record.schedule
      || (record.share.status !== "local" && personalCalendarShareFor(record).status !== "local")
    ) return;
    setRecordQuery("");
    setActiveView("calendar");
    setStatusFilter("all");
    setTimingFilter("all");
    setShareReviewId(record.id);
    setShareDraft(record.schedule);
    window.setTimeout(() => document.getElementById(`personal-record-${record.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  async function updateStatus(record: PersonalRecord, status: PersonalRecordStatus) {
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "update", id: record.id, patch: { status } });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function acceptProposal(proposal: PersonalProposal) {
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "create", record: proposal.data });
      setProposals((current) => current.filter((entry) => entry.id !== proposal.id));
      setNotice(
        proposal.data.schedule
          ? "Saved privately in Mi. Its schedule fields can now be reviewed separately before any optional STUDIO share."
          : `Saved privately as ${kindLabels[proposal.data.kind].toLowerCase()}.`,
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(record: PersonalRecord) {
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "delete", id: record.id });
      setDeleteReviewId(null);
      if (shareReviewId === record.id) {
        setShareReviewId(null);
        setShareDraft(null);
      }
      setNotice(
        record.share.status === "shared"
          ? "Deleted the local Mi record. The previously shared STUDIO Schedule item was not changed."
          : "Deleted the local Mi record.",
      );
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveConversation(
    prompt: string,
    assistantText: string,
    userMessage: PersonalMessage,
  ) {
    setOptimisticMessages([
      userMessage,
      temporaryMessage("assistant", assistantText),
    ]);
    try {
      await mutate({
        operation: "append-conversation",
        conversationId: activeConversationId,
        sessionId: sessionIdRef.current,
        engine,
        model,
        messages: [
          { role: "user", text: prompt },
          { role: "assistant", text: assistantText },
        ],
      });
    } catch (saveError) {
      setNotice(`Mi replied, but the conversation could not be saved: ${errorMessage(saveError)}`);
    }
  }

  async function runQueuedMessage(message: QueuedPersonalMessage) {
    const api = window.electronAPI;
    if (!api) return;
    activeRequestRef.current = message.id;
    setActiveRequestId(message.id);
    reportMiActivity({ id: message.id, scope: "personal", label: "Private assistant", href: "/personal", state: "running" });
    setStopping(false);
    setBusy(true);
    setNotice(null);
    const userMessage = temporaryMessage("user", message.prompt);
    setOptimisticMessages([userMessage]);
    try {
      const result = await api.agent.send({
        requestId: message.id,
        engine,
        model: model || null,
        cwd: ".",
        prompt: message.prompt,
        sessionId: sessionIdRef.current,
        scope: "personal",
      });
      const wasCancelled = cancelledRequestIdsRef.current.delete(message.id);
      if (wasCancelled) {
        finishMiActivity(message.id, "stopped");
        await saveConversation(message.prompt, "Response stopped.", userMessage);
        return;
      }
      sessionIdRef.current = result.sessionId;
      if (result.isError) throw new Error(result.fullOutput || "The personal assistant stopped unexpectedly.");
      const parsed = parsePersonalReply(result.fullOutput);
      const assistantText = parsed.reply || "I prepared a private record proposal for you to review.";
      setProposals((current) => [
        ...current.filter((proposal) =>
          !parsed.proposals.some((incoming) => incoming.id === proposal.id),
        ),
        ...parsed.proposals,
      ]);
      if (parsed.proposalError) setNotice(parsed.proposalError);
      finishMiActivity(message.id, parsed.proposalError ? "attention" : parsed.proposals.length ? "review" : "finished");
      await saveConversation(message.prompt, assistantText, userMessage);
    } catch (error) {
      const wasCancelled = cancelledRequestIdsRef.current.delete(message.id);
      if (wasCancelled) {
        finishMiActivity(message.id, "stopped");
        await saveConversation(message.prompt, "Response stopped.", userMessage);
        return;
      }
      const messageText = errorMessage(error);
      finishMiActivity(message.id, "attention");
      setOptimisticMessages([
        userMessage,
        temporaryMessage("assistant", `Mi could not respond: ${messageText}`),
      ]);
      setNotice(messageText);
    } finally {
      if (activeRequestRef.current === message.id) activeRequestRef.current = null;
      setActiveRequestId((current) => current === message.id ? null : current);
      setStopping(false);
      const [nextMessage, ...remainingMessages] = queuedMessagesRef.current;
      queuedMessagesRef.current = remainingMessages;
      setQueuedMessages(remainingMessages);
      if (nextMessage) {
        void runQueuedMessage(nextMessage);
      } else {
        setBusy(false);
      }
    }
  }

  function sendMessage() {
    const prompt = input.trim();
    if (!prompt || !modelValid || (busy && !activeRequestRef.current)) return;
    if (!window.electronAPI) {
      setNotice("Personal AI is available in the Mi desktop app. Manual capture still works here.");
      return;
    }
    const message = { id: crypto.randomUUID(), prompt };
    setInput("");
    if (activeRequestRef.current) {
      const nextQueue = [...queuedMessagesRef.current, message];
      queuedMessagesRef.current = nextQueue;
      setQueuedMessages(nextQueue);
      return;
    }
    void runQueuedMessage(message);
  }

  function stopAgentResponse() {
    const requestId = activeRequestRef.current;
    if (!requestId) return;
    cancelledRequestIdsRef.current.add(requestId);
    setStopping(true);
    window.electronAPI?.agent.cancel(requestId);
  }

  async function shareToStudio(record: PersonalRecord) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, confirmed: true, expectedHash: hash }),
      });
      const result = await response.json();
      if (result.database) {
        setDatabase(result.database);
        setHash(result.hash);
      }
      if (!response.ok) throw new Error(result.error || "The plan could not be shared.");
      setShareReviewId(null);
      setShareDraft(null);
      setNotice("Shared to the firm STUDIO Schedule. The private record stayed local.");
    } catch (error) {
      setNotice(errorMessage(error));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function clearShareReview(record: PersonalRecord) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: record.id,
          operation: "clear-review",
          resolution: "confirmed-not-created",
          confirmed: true,
          expectedHash: hash,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The share review could not be cleared.");
      setDatabase(result.database);
      setHash(result.hash);
      setNotice("Review cleared. You can review and share this plan again.");
    } catch (error) {
      setNotice(errorMessage(error));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function shareToPersonalCalendar(record: PersonalRecord) {
    const api = window.electronAPI?.personalCalendar;
    if (!api || !personalCalendarStatus?.dataSourceId) {
      setNotice("Connect and select a personal Notion calendar above first.");
      return;
    }
    setBusy(true);
    setNotice(null);
    let pendingHash: string | null = null;
    let syncKey: string | null = null;
    try {
      const preparedResponse = await fetch("/api/personal/calendar-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "prepare", id: record.id, confirmed: true, expectedHash: hash }),
      });
      const prepared = await preparedResponse.json();
      if (!preparedResponse.ok) throw new Error(prepared.error || "The personal calendar share could not be prepared.");
      setDatabase(prepared.database);
      setHash(prepared.hash);
      pendingHash = prepared.hash;
      syncKey = prepared.syncKey;
      const created = await api.create(prepared.schedule, true);
      const finishedResponse = await fetch("/api/personal/calendar-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "finish",
          id: record.id,
          syncKey,
          confirmed: true,
          expectedHash: pendingHash,
          result: { status: "shared", notionPageId: created.id, notionUrl: created.url },
        }),
      });
      const finished = await finishedResponse.json();
      if (!finishedResponse.ok) throw new Error(finished.error || "The personal calendar result could not be saved.");
      setDatabase(finished.database);
      setHash(finished.hash);
      setNotice(`Added to ${personalCalendarStatus.name || "your personal Notion calendar"}. The private record stayed local.`);
    } catch (error) {
      const message = errorMessage(error);
      if (pendingHash && syncKey) {
        try {
          const reviewResponse = await fetch("/api/personal/calendar-share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              operation: "finish",
              id: record.id,
              syncKey,
              confirmed: true,
              expectedHash: pendingHash,
              result: { status: "needs-review", message },
            }),
          });
          const review = await reviewResponse.json();
          if (review.database) {
            setDatabase(review.database);
            setHash(review.hash);
          }
        } catch {
          // The pending state is deliberately retained; retrying could duplicate an item.
        }
      }
      setNotice(`${message} Check the selected personal calendar before retrying.`);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function clearPersonalCalendarShareReview(record: PersonalRecord) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/calendar-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "clear-review",
          id: record.id,
          resolution: "confirmed-not-created",
          confirmed: true,
          expectedHash: hash,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The personal calendar review could not be cleared.");
      setDatabase(result.database);
      setHash(result.hash);
      setNotice("Personal calendar review cleared. You can share the item again.");
    } catch (error) {
      setNotice(errorMessage(error));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveShareDraft(record: PersonalRecord) {
    if (!shareDraft || scheduleDraftError(shareDraft)) return;
    setBusy(true);
    setNotice(null);
    try {
      await mutate({ operation: "update", id: record.id, patch: { schedule: shareDraft } });
      setNotice("Public schedule fields updated locally. Review them once more before sharing.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function compactWindowAction(
    action: "hide" | "minimize" | "toggle-pin" | "collapse",
    nextCollapsed?: boolean,
  ) {
    if (action === "collapse" && typeof nextCollapsed === "boolean") {
      setCompactCollapsed(nextCollapsed);
    }
    const api = window.electronAPI?.windows;
    if (!api?.compactChatAction) {
      if (action === "hide") window.close();
      return;
    }
    try {
      const state = await api.compactChatAction(action, nextCollapsed);
      setCompactPinned(state.pinned);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  return (
    <div className={compact ? "fixed inset-0 z-[80] flex flex-col overflow-hidden bg-background" : "space-y-8"}>
      {compact && (
        <div className="mi-window-drag flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-2 backdrop-blur">
          <ProfileAvatar className="h-7 w-7 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch" title="Drag to move this window">
            <svg viewBox="0 0 8 14" className="h-4 w-2 shrink-0 text-muted-foreground/60" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
              <circle cx="2" cy="7" r="1" /><circle cx="6" cy="7" r="1" />
              <circle cx="2" cy="12" r="1" /><circle cx="6" cy="12" r="1" />
            </svg>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">Mi Personal</p>
              <p className="truncate text-[10px] text-muted-foreground">Private · stored on this computer</p>
            </div>
          </div>
          <div className="mi-window-no-drag flex items-center gap-1">
            <button
              type="button"
              onClick={() => void compactWindowAction("toggle-pin")}
              title={compactPinned ? "Let other windows cover this chat" : "Keep this chat above other windows"}
              aria-label={compactPinned ? "Unpin personal chat from top" : "Pin personal chat on top"}
              aria-pressed={compactPinned}
              className={`tactile-control flex h-7 items-center gap-1 rounded px-2 text-[10px] hover:bg-muted ${compactPinned ? "text-accent" : "text-muted-foreground"}`}
            >
              <CompactWindowIcon name="pin" />
              <span>{compactPinned ? "Pinned" : "Pin"}</span>
            </button>
            <button
              type="button"
              onClick={() => void compactWindowAction("collapse", !compactCollapsed)}
              title={compactCollapsed ? "Restore the full chat window" : "Shrink to a slim chat bar"}
              aria-label={compactCollapsed ? "Restore full personal chat" : "Shrink personal chat to a slim bar"}
              className="tactile-control flex h-7 items-center gap-1 rounded px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <CompactWindowIcon name="slim" />
              <span>{compactCollapsed ? "Open" : "Slim"}</span>
            </button>
            {!compactCollapsed && (
              <button type="button" onClick={() => void compactWindowAction("minimize")} title="Minimize window" aria-label="Minimize personal chat window" className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                <CompactWindowIcon name="minimize" />
              </button>
            )}
            <button type="button" onClick={() => void compactWindowAction("hide")} title="Hide window" aria-label="Hide personal chat window" className="tactile-control flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
              <CompactWindowIcon name="close" />
            </button>
          </div>
        </div>
      )}
      {compact && compactCollapsed && (
        <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="mi-window-no-drag flex min-h-0 flex-1 items-center gap-2 px-2 py-2">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Talk privately with Mi…" disabled={busy && !activeRequestId} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
          <button type="submit" disabled={!input.trim() || !modelValid || (busy && !activeRequestId)} className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50">{activeRequestId ? "Queue" : "Send"}</button>
        </form>
      )}
      {!compact && <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="mode-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent"><AppIcon name="personal" className="h-6 w-6" /></span>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Private by default</p>
              <h1 className="mt-1 font-display text-3xl font-light tracking-wide">Personal</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              A clear home for to-dos, private journal entries, calendar items, notes, and personal help from Mi.
              Records live in this Mi installation—not the firm Dropbox or Notion.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.electronAPI?.windows.openCompactChat) {
                  void window.electronAPI.windows.openCompactChat(undefined, "personal");
                } else {
                  window.open("/personal/window", "mi-personal-chat", "popup,width=480,height=680");
                }
              }}
              className="tactile-control rounded-md border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent hover:border-accent"
            >
              Float personal chat
            </button>
            <Link
              href="/personal/analysis"
              className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-accent"
            >
              Personal analysis
            </Link>
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">Privacy boundary</p>
              <p>Local records → review → optional STUDIO schedule fields only</p>
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Personal quick actions">
          {(Object.keys(kindLabels) as PersonalRecordKind[]).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => openQuickCapture(entry)}
              className="card-hover flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left hover:border-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><AppIcon name={kindIcons[entry]} className="h-4 w-4" /></span>
              <span><strong className="block text-sm font-medium">{entry === "journal" ? "Write in journal" : entry === "task" ? "Add to-do" : `Add ${kindLabels[entry].toLowerCase()}`}</strong><span className="block text-[11px] text-muted-foreground">{entry === "journal" ? "A private reflection" : entry === "thought" ? "Catch it before it’s lost" : entry === "task" ? "Create a clear next action" : "Put time on the calendar"}</span></span>
            </button>
          ))}
        </div>
      </section>}

      {!compact && (
        <nav className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-5" aria-label="Personal workspace">
          {personalViews.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-current={activeView === view.id ? "page" : undefined}
              onClick={() => {
                setActiveView(view.id);
                setRecordQuery("");
                setStatusFilter("all");
                setTimingFilter("all");
                setRecordSort("updated");
                if (view.id === "todos") setKind("task");
                if (view.id === "journal") setKind("journal");
                if (view.id === "notes") setKind("thought");
                if (view.id === "calendar") setKind("plan");
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${activeView === view.id ? "bg-accent text-accent-foreground shadow-sm" : "hover:bg-muted"}`}
            >
              <AppIcon name={view.icon} className="h-4 w-4 shrink-0" />
              <span className="min-w-0"><strong className="block text-sm font-medium">{view.label}</strong><span className={`block truncate text-[10px] ${activeView === view.id ? "text-accent-foreground/75" : "text-muted-foreground"}`}>{view.description}</span></span>
            </button>
          ))}
        </nav>
      )}

      {notice && (
        <div role="status" className="rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      <div className={compact ? "min-h-0 flex-1" : "space-y-6"}>
        {(compact || activeView === "assistant") && <section className={`${compactCollapsed ? "hidden" : "flex"} ${compact ? "h-full border-x-0 border-b-0" : "h-[min(52rem,calc(100vh-5rem))] min-h-[38rem] rounded-xl"} w-full overflow-hidden border border-border bg-card`}>
          <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-muted/40 sm:flex">
            <div className="border-b border-border p-3">
              <ChatActions
                path="/personal"
                conversations={database.conversations}
                activeConversationId={activeConversationId}
                onNewChat={startNewConversation}
                disabled={busy}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Personal chat history">
              <p className="px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                History · {database.conversations.length}
              </p>
              {database.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => selectConversation(conversation)}
                  disabled={busy}
                  className={`mb-1 w-full rounded-md px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                    conversation.id === activeConversationId
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  }`}
                >
                  <span className="block truncate text-xs font-medium">{conversation.title}</span>
                  <span className="mt-0.5 block text-[10px]">
                    {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(conversation.updatedAt))}
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
          {compact && (
            <details className="progressive-disclosure mi-window-no-drag shrink-0 border-b border-border bg-muted/10 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Talk with Mi · {AGENT_PROVIDERS[engine].agentLabel} · {model || "Automatic"}
              </summary>
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">
                  Each chat is saved locally and can be reopened from history.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.electronAPI?.windows.openCompactChat) void window.electronAPI.windows.openCompactChat(undefined, "firm");
                      else window.location.href = "/chat?compactChat=1";
                    }}
                    className="tactile-control rounded-md border border-border bg-background px-3 py-2 text-xs hover:border-accent"
                  >
                    Projects
                  </button>
                  <button type="button" onClick={startNewConversation} disabled={busy} className="tactile-control rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:border-accent disabled:opacity-50">
                    + New chat
                  </button>
                  <ChatExportMenu conversations={exportableConversations} activeConversationId={activeConversationId} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-muted-foreground">
                    Agent
                    <select
                      value={engine}
                      onChange={(event) => {
                        setEngine(event.target.value as AgentEngine);
                        sessionIdRef.current = null;
                      }}
                      disabled={busy}
                      className={`${controlClass} mt-1`}
                    >
                      {AGENT_PROVIDER_ORDER.map((entry) => (
                        <option key={entry} value={entry}>{AGENT_PROVIDERS[entry].agentLabel}</option>
                      ))}
                    </select>
                  </label>
                  <AgentModelPicker
                    key={engine}
                    engine={engine}
                    model={model}
                    onModelChange={(value) => {
                      setModel(value);
                      sessionIdRef.current = null;
                    }}
                    onValidityChange={setModelValid}
                    disabled={busy}
                    controlClassName={controlClass}
                    groupClassName="text-xs text-muted-foreground"
                    labelClassName="block"
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                  <span>Need a quicker everyday reply? The faster model trades some depth for speed.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setModel(fastModel);
                      sessionIdRef.current = null;
                    }}
                    disabled={busy || model === fastModel}
                    className="font-medium text-accent hover:underline disabled:no-underline disabled:opacity-70"
                  >
                    {model === fastModel ? `${fastModelLabel} selected` : `Use ${fastModelLabel}`}
                  </button>
                </div>
              </div>
            </details>
          )}
          {!compact && <div className="border-b border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-light">Talk with Mi</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each chat is saved locally and can be reopened from history.
                </p>
              </div>
              <div className="sm:hidden">
                <ChatActions
                  path="/personal"
                  conversations={database.conversations}
                  activeConversationId={activeConversationId}
                  onNewChat={startNewConversation}
                  disabled={busy}
                  layout="inline"
                />
              </div>
              {!compact && (
                <ChatExportMenu conversations={exportableConversations} activeConversationId={activeConversationId} />
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                Agent
                <select
                  value={engine}
                  onChange={(event) => {
                    setEngine(event.target.value as AgentEngine);
                    sessionIdRef.current = null;
                  }}
                  disabled={busy}
                  className={`${controlClass} mt-1`}
                >
                  {AGENT_PROVIDER_ORDER.map((entry) => (
                    <option key={entry} value={entry}>{AGENT_PROVIDERS[entry].agentLabel}</option>
                  ))}
                </select>
              </label>
              <AgentModelPicker
                key={engine}
                engine={engine}
                model={model}
                onModelChange={(value) => {
                  setModel(value);
                  sessionIdRef.current = null;
                }}
                onValidityChange={setModelValid}
                disabled={busy}
                controlClassName={controlClass}
                groupClassName="text-xs text-muted-foreground"
                labelClassName="block"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              <span>Need a quicker everyday reply? The faster model trades some depth for speed.</span>
              <button
                type="button"
                onClick={() => {
                  setModel(fastModel);
                  sessionIdRef.current = null;
                }}
                disabled={busy || model === fastModel}
                className="font-medium text-accent hover:underline disabled:no-underline disabled:opacity-70"
              >
                {model === fastModel ? `${fastModelLabel} selected` : `Use ${fastModelLabel}`}
              </button>
            </div>
          </div>}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {messages.length === 0 && (
              <div className="rounded-lg bg-muted p-4 text-sm leading-6 text-muted-foreground">
                What is taking up space in your head? I can help you reflect, turn a thought into a
                task, or prepare a plan for your review.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto bg-accent text-accent-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {message.text}
              </div>
            ))}
            {compact && proposals.map((proposal) => (
              <article key={proposal.id} className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-accent">Private draft · not saved</p>
                <p className="mt-1 font-medium">{proposal.data.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.reason}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void acceptProposal(proposal)} disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50">Save privately</button>
                  <button type="button" onClick={() => setProposals((current) => current.filter((item) => item.id !== proposal.id))} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">Dismiss</button>
                </div>
              </article>
            ))}
            {activeRequestId && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <MiMark className="h-5 w-5 shrink-0 animate-mark-loading text-accent" />
                <span>{stopping ? "Stopping response…" : "Mi is thinking…"}</span>
                {queuedMessages.length > 0 && (
                  <span className="rounded-full border border-border px-2 py-0.5">
                    {queuedMessages.length} queued
                  </span>
                )}
              </div>
            )}
            <div ref={conversationBottomRef} />
          </div>
          <div className="shrink-0 border-t border-border p-4">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={3}
              placeholder="Talk to Mi…"
              disabled={busy && !activeRequestId}
              className={controlClass}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                Enter to {activeRequestId ? "queue" : "send"} · Shift+Enter for a new line
              </p>
              <div className="flex items-center gap-2">
                {activeRequestId && (
                  <button
                    type="button"
                    onClick={stopAgentResponse}
                    disabled={stopping}
                    className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground disabled:opacity-50"
                  >
                    {stopping ? "Stopping…" : "Stop"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!input.trim() || !modelValid || (busy && !activeRequestId)}
                  className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-50"
                >
                  {activeRequestId ? "Queue" : "Send"}
                </button>
              </div>
            </div>
          </div>
          </div>
        </section>}

        {!compact && <div className="space-y-6">
          {proposals.length > 0 && (
            <section className="rounded-xl border border-accent bg-card p-5">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">
                Mi suggestion · nothing saved yet
              </p>
              <h2 className="mt-1 font-display text-xl font-light">Choose what is worth keeping</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Review each draft, then save it privately or dismiss it. Plans with schedule fields
                stay local first; sharing to STUDIO is always a separate confirmation.
              </p>
              <div className="mt-4 space-y-3">
                {proposals.map((proposal) => (
                  <article key={proposal.id} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-accent">
                          {kindLabels[proposal.data.kind]}
                        </p>
                        <h3 className="mt-1 font-medium">{proposal.data.title}</h3>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{proposal.reason}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProposals((current) => current.filter((item) => item.id !== proposal.id))}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Don&apos;t save
                      </button>
                    </div>
                    {proposal.data.body && <p className="mt-3 whitespace-pre-wrap text-sm">{proposal.data.body}</p>}
                    {proposal.data.schedule && (
                      <div className="mt-3 rounded-md border border-border bg-card p-3 text-xs">
                        <p className="font-medium text-foreground">Private plan with optional schedule fields</p>
                        <p className="mt-1 text-muted-foreground">
                          {proposal.data.schedule.name} · {formatScheduleDate(proposal.data.schedule.date)}
                          {" · "}{proposal.data.schedule.type}
                        </p>
                        <p className="mt-2 text-muted-foreground">
                          Saving this does not share it. You can review the public title, date, and
                          time later before confirming a STUDIO Schedule write.
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void acceptProposal(proposal)}
                      disabled={busy}
                      className="mt-4 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50"
                    >
                      Save {kindLabels[proposal.data.kind].toLowerCase()} privately in Mi
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeView !== "assistant" && <section id="personal-quick-capture" className="scroll-mt-6 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent"><AppIcon name={kindIcons[kind]} className="h-4 w-4" /></span><div><h2 className="font-display text-xl font-light">{kind === "task" ? "Add a to-do" : kind === "journal" ? "New journal entry" : kind === "thought" ? "Add a note" : "Add a calendar item"}</h2><p className="text-xs text-muted-foreground">{kind === "task" ? "Capture a next action, then optionally give it a date." : kind === "journal" ? "Write privately. Journal entries stay out of your task and calendar views." : kind === "thought" ? "Save something you want to remember without turning it into a task." : "Reserve time locally, then choose whether to share it."}</p></div></div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Title
                <input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short, recognizable title" className={`${controlClass} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                {kind === "journal" ? "Journal entry" : kind === "task" ? "Details" : kind === "thought" ? "Note" : "Details"}
                <textarea id="personal-capture-notes" maxLength={20_000} value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder={kind === "journal" ? "What is on your mind?" : kind === "task" ? "Optional context for this to-do" : "What do you want to remember?"} className={`${controlClass} mt-1`} />
              </label>
              <div className={`grid gap-3 ${kind === "journal" ? "sm:grid-cols-2" : ""}`}>
                <label className="block text-xs font-medium text-muted-foreground">
                  Tags
                  <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Comma separated" className={`${controlClass} mt-1`} />
                </label>
                {kind === "journal" && <label className="block text-xs font-medium text-muted-foreground">
                  Mood
                  <input maxLength={80} value={mood} onChange={(event) => setMood(event.target.value)} placeholder="Optional" className={`${controlClass} mt-1`} />
                </label>}
              </div>
              {(kind === "plan" || kind === "task") && (
                <div className="space-y-4 rounded-lg border border-border bg-background p-4">
                  <div>
                    <p className="text-sm font-medium">Schedule details</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Choose a date and exact time, or use a preset. Times are recorded with your
                      computer&apos;s local offset.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Date presets">
                    {[
                      { label: "Today", offset: 0 },
                      { label: "Tomorrow", offset: 1 },
                      { label: "Next week", offset: 7 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setPlanDate(localDateKey(preset.offset))}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
                      >
                        {preset.label}
                      </button>
                    ))}
                    {(planDate || planStart || planEnd) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPlanDate("");
                          setPlanStart("");
                          setPlanEnd("");
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
                      >
                        Clear schedule
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Date
                      <input
                        type="date"
                        value={planDate}
                        onChange={(event) => setPlanDate(event.target.value)}
                        onClick={(event) => event.currentTarget.showPicker?.()}
                        className={`${controlClass} mt-1 cursor-pointer`}
                      />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      Schedule type
                      <select
                        value={planType}
                        onChange={(event) => setPlanType(event.target.value as typeof planType)}
                        className={`${controlClass} mt-1`}
                      >
                        {scheduleTypes.map((entry) => <option key={entry}>{entry}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      Start time
                      <input
                        type="time"
                        step={900}
                        value={planStart}
                        onChange={(event) => setPlanStart(event.target.value)}
                        onClick={(event) => event.currentTarget.showPicker?.()}
                        className={`${controlClass} mt-1 cursor-pointer`}
                      />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      End time
                      <input
                        type="time"
                        step={900}
                        value={planEnd}
                        onChange={(event) => setPlanEnd(event.target.value)}
                        onClick={(event) => event.currentTarget.showPicker?.()}
                        className={`${controlClass} mt-1 cursor-pointer`}
                      />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Time presets</p>
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Time presets">
                      {timePresets.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            if (!planDate) setPlanDate(localDateKey());
                            setPlanStart(preset.start);
                            setPlanEnd(preset.end);
                          }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
                        >
                          {preset.label}
                        </button>
                      ))}
                      {(planStart || planEnd) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPlanStart("");
                            setPlanEnd("");
                          }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
                        >
                          Clear time
                        </button>
                      )}
                    </div>
                  </div>
                  {planDate ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">
                      {formatScheduleDate(planDate)}
                      {planStart ? ` · ${planStart}${planEnd ? `–${planEnd}` : ""}` : " · Time not set"}
                      {` · ${planType}`}
                    </p>
                  ) : null}
                </div>
              )}
              {captureError ? (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {captureError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void saveCapture()}
                disabled={busy || (!title.trim() && !body.trim()) || Boolean(captureError)}
                className="w-full rounded-md bg-accent px-4 py-2.5 text-sm text-accent-foreground disabled:opacity-50"
              >
                {kind === "task" ? "Add to-do" : kind === "journal" ? "Save journal entry" : kind === "thought" ? "Save note" : "Save calendar item"}
              </button>
            </div>
          </section>}
        </div>}
      </div>

      {!compact && <>
      {activeView === "journal" && <>
        <PersonalJournalSummary records={database.records} timezone={timezone} />
        <details className="rounded-xl border border-border bg-card p-5">
          <summary className="cursor-pointer font-medium">Journal import and storage</summary>
          <div className="mt-5 space-y-5">
            <PersonalStorageLocation />
            <PersonalObsidianTransfer records={database.records} busy={busy} onImport={importObsidianRecords} />
            <PersonalDayOneTransfer busy={busy} onImport={importDayOneRecords} />
          </div>
        </details>
      </>}

      {activeView === "calendar" && <>
        <PersonalCalendarConnections onStatusChange={setPersonalCalendarStatus} />
        <PersonalCalendar
          records={database.records}
          onCreatePlan={createPlanFromCalendar}
          onReviewSchedule={reviewCalendarSchedule}
        />
      </>}

      {activeView !== "assistant" && <section className="space-y-5 rounded-xl border border-border bg-card p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">{activeView === "todos" ? "To-do list" : activeView === "journal" ? "Journal" : activeView === "notes" ? "Notes" : "Calendar"}</p>
          <h2 className="mt-1 font-display text-xl font-light">{activeView === "todos" ? "What needs doing" : activeView === "journal" ? "Journal entries" : activeView === "notes" ? "Things to remember" : "Scheduled items"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeView === "todos" ? "Check off next actions and keep completed work separate." : activeView === "journal" ? "Browse private writing without mixing it into tasks or calendar events." : activeView === "notes" ? "Reference notes stay distinct from actionable to-dos." : "Review local schedule details and choose destinations explicitly."}
          </p>
        </div>

        {(activeView === "todos" || activeView === "calendar") && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ListMetric label={activeView === "todos" ? "All to-dos" : "Calendar items"} value={recordSummary.total} />
          {activeView === "todos"
            ? <ListMetric label="Open" value={viewSourceRecords.filter((record) => record.status === "active" || record.status === "inbox").length} detail="Ready to work on" />
            : <ListMetric label="Active" value={recordSummary.active} detail="Records currently in progress" />}
          {activeView === "todos"
            ? <ListMetric label="Completed" value={viewSourceRecords.filter((record) => record.status === "done").length} detail="Checked off" />
            : <ListMetric label="Scheduled" value={recordSummary.scheduled} detail="Records with a calendar date" />}
          <ListMetric label="Shared" value={recordSummary.shared} detail="Items confirmed to at least one calendar" />
        </div>}

        <AdvancedListToolbar>
          <AdvancedListField label="Search" className="md:col-span-2 xl:col-span-1">
            <input
              type="search"
              value={recordQuery}
              onChange={(event) => setRecordQuery(event.target.value)}
              placeholder="Title, notes, tag, mood..."
              className={advancedListControlClass}
            />
          </AdvancedListField>
          <AdvancedListField label="Status">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PersonalStatusFilter)}
              className={advancedListControlClass}
            >
              <option value="all">All statuses</option>
              {(Object.keys(statusLabels) as PersonalRecordStatus[]).map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
          </AdvancedListField>
          {(activeView === "todos" || activeView === "calendar") && <AdvancedListField label="Schedule">
            <select
              value={timingFilter}
              onChange={(event) => setTimingFilter(event.target.value as PersonalTimingFilter)}
              className={advancedListControlClass}
            >
              <option value="all">All timing</option>
              <option value="scheduled">Has a schedule</option>
              <option value="upcoming">Upcoming</option>
              <option value="past">Past</option>
              <option value="unscheduled">No schedule</option>
            </select>
          </AdvancedListField>}
          <AdvancedListField label="Sort by">
            <select
              value={recordSort}
              onChange={(event) => setRecordSort(event.target.value as PersonalRecordSort)}
              className={advancedListControlClass}
            >
              <option value="updated">Recently updated</option>
              <option value="created">Recently created</option>
              <option value="scheduled">Schedule date</option>
              <option value="title">Title</option>
            </select>
          </AdvancedListField>
        </AdvancedListToolbar>

        <AdvancedListSummary
          shown={records.length}
          total={viewSourceRecords.length}
          noun={activeView === "todos" ? "to-do" : activeView === "journal" ? "entry" : activeView === "notes" ? "note" : "item"}
          filtersActive={recordFiltersActive}
          onClear={() => {
            setRecordQuery("");
            setStatusFilter("all");
            setTimingFilter("all");
            setRecordSort("updated");
          }}
        />

        <div className="grid gap-3">
          {displayRecords.length === 0 ? (
            <AdvancedListEmpty>
              {viewSourceRecords.length === 0
                ? `No ${activeView === "todos" ? "to-dos" : activeView === "journal" ? "journal entries" : activeView === "notes" ? "notes" : "calendar items"} yet. Use the form above to add one.`
                : "Nothing in this area matches the selected filters."}
            </AdvancedListEmpty>
          ) : null}
          {displayRecords.map((record, index) => {
            const group = activeView === "todos"
              ? record.status === "done" ? "Completed" : record.status === "archived" ? "Archived" : "Open"
              : null;
            const previous = activeView === "todos" && index > 0
              ? displayRecords[index - 1].status === "done" ? "Completed" : displayRecords[index - 1].status === "archived" ? "Archived" : "Open"
              : null;
            const personalShare = personalCalendarShareFor(record);
            return <div key={record.id}>
              {group && group !== previous && <h3 className="mb-2 mt-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">{group}</h3>}
            <article id={`personal-record-${record.id}`} className="scroll-mt-6 rounded-xl border border-border bg-background p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-accent">
                      <AppIcon name={kindIcons[record.kind]} className="h-3.5 w-3.5" />
                      {kindLabels[record.kind]}
                    </span>
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                      {calendarShareLabel(record)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-medium">{record.title}</h3>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {record.kind === "task" && (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={record.status === "done"}
                        disabled={busy || record.status === "archived"}
                        onChange={(event) => void updateStatus(record, event.target.checked ? "done" : "active")}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      Done
                    </label>
                  )}
                  <label className="text-xs text-muted-foreground">
                    Status
                    <select
                      aria-label={`Status for ${record.title}`}
                      value={record.status}
                      onChange={(event) => void updateStatus(record, event.target.value as PersonalRecordStatus)}
                      disabled={busy}
                      className="ml-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                    >
                      {(Object.keys(statusLabels) as PersonalRecordStatus[]).map((status) => (
                        <option key={status} value={status}>{statusLabels[status]}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeleteReviewId(record.id)}
                    disabled={busy || record.share.status === "pending" || record.share.status === "needs-review" || personalShare.status === "pending" || personalShare.status === "needs-review"}
                    title={
                      record.share.status === "pending" || record.share.status === "needs-review" || personalShare.status === "pending" || personalShare.status === "needs-review"
                        ? "Resolve the calendar share review before deleting this record."
                        : `Delete ${record.title}`
                    }
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-red-400/60 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {record.body ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{record.body}</p>
              ) : null}
              <dl className={`mt-4 grid gap-x-5 gap-y-2 border-t border-border pt-3 text-xs ${record.kind === "journal" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="mt-0.5">{formatRecordedTimestamp(record.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last updated</dt>
                  <dd className="mt-0.5">{formatRecordedTimestamp(record.updatedAt)}</dd>
                </div>
                {record.kind === "journal" && <div>
                  <dt className="text-muted-foreground">Mood</dt>
                  <dd className="mt-0.5">{record.mood || "Not recorded"}</dd>
                </div>}
              </dl>
              {record.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {record.tags.map((tag, index) => (
                    <span key={`${tag}-${index}`} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {deleteReviewId === record.id && (
                <div className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm">
                  <p className="font-medium text-foreground">Delete “{record.title}”?</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {record.share.status === "shared"
                      ? "This removes only the local Mi record. The existing STUDIO Schedule item will remain unchanged."
                      : "This removes the private local record from Mi. No STUDIO or Dropbox data will be changed."}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void deleteRecord(record)}
                      disabled={busy}
                      className="rounded-md bg-red-600 px-3 py-2 text-xs text-white disabled:opacity-50"
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteReviewId(null)}
                      disabled={busy}
                      className="rounded-md border border-border px-3 py-2 text-xs"
                    >
                      Keep record
                    </button>
                  </div>
                </div>
              )}
              {record.schedule && (
                <div className="mt-4 rounded-lg border border-border bg-card p-4 text-xs leading-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">{record.schedule.name}</p>
                      <p className="mt-1 text-muted-foreground">
                        {formatScheduleDate(record.schedule.date)} · {formatScheduleTimeRange(record.schedule)}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                      {record.schedule.type}
                    </span>
                  </div>
                  {(record.share.status === "local" || personalShare.status === "local") && shareReviewId !== record.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setShareReviewId(record.id);
                        setShareDraft(record.schedule);
                      }}
                      className="mt-2 text-accent hover:underline"
                    >
                      Review calendar destinations
                    </button>
                  )}
                  {shareReviewId === record.id && (record.share.status === "local" || personalShare.status === "local") && shareDraft && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="font-medium text-accent">Optional calendar sharing · separate confirmation</p>
                      <p className="mt-1 text-muted-foreground">
                        This record is already saved privately. Review exactly what would become
                        visible in a calendar; nothing is shared until you confirm a destination below.
                      </p>
                      <div className="mt-2 grid gap-2">
                        <label className="text-muted-foreground">
                          Public title
                          <input
                            maxLength={200}
                            value={shareDraft.name}
                            onChange={(event) => setShareDraft({ ...shareDraft, name: event.target.value })}
                            className={`${controlClass} mt-1`}
                          />
                        </label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="text-muted-foreground">
                            Date
                            <input
                              type="date"
                              value={shareDraft.date}
                              onClick={(event) => event.currentTarget.showPicker?.()}
                              onChange={(event) => {
                                const date = event.target.value;
                                setShareDraft({
                                  ...shareDraft,
                                  date,
                                  startTime: localDateTime(date, localTime(shareDraft.startTime)),
                                  endTime: localDateTime(date, localTime(shareDraft.endTime)),
                                });
                              }}
                              className={`${controlClass} mt-1 cursor-pointer`}
                            />
                          </label>
                          <label className="text-muted-foreground">
                            Type
                            <select
                              value={shareDraft.type}
                              onChange={(event) => setShareDraft({
                                ...shareDraft,
                                type: event.target.value as PersonalSchedule["type"],
                              })}
                              className={`${controlClass} mt-1`}
                            >
                              {scheduleTypes.map((entry) => <option key={entry}>{entry}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="text-muted-foreground">
                            Start
                            <input
                              type="time"
                              step={900}
                              value={localTime(shareDraft.startTime)}
                              onClick={(event) => event.currentTarget.showPicker?.()}
                              onChange={(event) => setShareDraft({
                                ...shareDraft,
                                startTime: localDateTime(shareDraft.date, event.target.value),
                              })}
                              className={`${controlClass} mt-1 cursor-pointer`}
                            />
                          </label>
                          <label className="text-muted-foreground">
                            End
                            <input
                              type="time"
                              step={900}
                              value={localTime(shareDraft.endTime)}
                              onClick={(event) => event.currentTarget.showPicker?.()}
                              onChange={(event) => setShareDraft({
                                ...shareDraft,
                                endTime: localDateTime(shareDraft.date, event.target.value),
                              })}
                              className={`${controlClass} mt-1 cursor-pointer`}
                            />
                          </label>
                        </div>
                      </div>
                      <p className="mt-2 text-muted-foreground">
                        Body, mood, tags, and the rest of this record stay local. STUDIO creates a firm-visible item without a project relation; your personal destination stays in the calendar selected above.
                      </p>
                      {shareScheduleError ? (
                        <p role="alert" className="mt-2 text-red-600 dark:text-red-400">
                          {shareScheduleError}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        {JSON.stringify(shareDraft) !== JSON.stringify(record.schedule) && (
                          <button
                            type="button"
                            onClick={() => void saveShareDraft(record)}
                            disabled={busy || Boolean(shareScheduleError)}
                            className="rounded border border-accent px-3 py-2 text-accent disabled:opacity-50"
                          >
                            Save reviewed fields
                          </button>
                        )}
                        {record.share.status === "local" && <button
                            type="button"
                            onClick={() => void shareToStudio(record)}
                            disabled={
                              busy
                              || Boolean(shareScheduleError)
                              || JSON.stringify(shareDraft) !== JSON.stringify(record.schedule)
                            }
                            className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50"
                          >
                            Confirm add to STUDIO
                          </button>}
                        {personalShare.status === "local" && <button
                            type="button"
                            onClick={() => void shareToPersonalCalendar(record)}
                            disabled={
                              busy
                              || !personalCalendarStatus?.dataSourceId
                              || Boolean(shareScheduleError)
                              || JSON.stringify(shareDraft) !== JSON.stringify(record.schedule)
                            }
                            title={personalCalendarStatus?.dataSourceId ? `Add to ${personalCalendarStatus.name}` : "Connect a personal calendar above first"}
                            className="rounded border border-accent px-3 py-2 text-accent disabled:opacity-50"
                          >
                            Confirm add to {personalCalendarStatus?.name || "personal calendar"}
                          </button>}
                        <button
                          type="button"
                          onClick={() => {
                            setShareReviewId(null);
                            setShareDraft(null);
                          }}
                          className="rounded border border-border px-3 py-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {record.share.status === "shared" && (
                    <NotionLink href={record.share.notionUrl} className="mt-2 inline-block text-accent hover:underline">
                      Shared to STUDIO Schedule ↗
                    </NotionLink>
                  )}
                  {record.share.status === "pending" && (
                    <div className="mt-2 text-muted-foreground">
                      <p>Share result is unresolved; automatic retry is blocked.</p>
                      <button
                        type="button"
                        onClick={() => void clearShareReview(record)}
                        disabled={busy}
                        className="mt-2 rounded border border-border px-2 py-1 text-foreground disabled:opacity-50"
                      >
                        I checked—no STUDIO item exists
                      </button>
                    </div>
                  )}
                  {record.share.status === "needs-review" && (
                    <div className="mt-2 text-status-danger-foreground">
                      <p>Check STUDIO Schedule manually before retrying: {record.share.message}</p>
                      <button
                        type="button"
                        onClick={() => void clearShareReview(record)}
                        disabled={busy}
                        className="mt-2 rounded border border-border px-2 py-1 text-foreground disabled:opacity-50"
                      >
                        I checked—no STUDIO item exists
                      </button>
                    </div>
                  )}
                  {personalShare.status === "shared" && (
                    <NotionLink href={personalShare.notionUrl} className="mt-2 block text-accent hover:underline">
                      Shared to personal Notion calendar ↗
                    </NotionLink>
                  )}
                  {personalShare.status === "pending" && (
                    <div className="mt-2 text-muted-foreground">
                      <p>Personal calendar result is unresolved; automatic retry is blocked.</p>
                      <button type="button" onClick={() => void clearPersonalCalendarShareReview(record)} disabled={busy} className="mt-2 rounded border border-border px-2 py-1 text-foreground disabled:opacity-50">
                        I checked—no personal calendar item exists
                      </button>
                    </div>
                  )}
                  {personalShare.status === "needs-review" && (
                    <div className="mt-2 text-status-danger-foreground">
                      <p>Check the selected personal calendar manually before retrying: {personalShare.message}</p>
                      <button type="button" onClick={() => void clearPersonalCalendarShareReview(record)} disabled={busy} className="mt-2 rounded border border-border px-2 py-1 text-foreground disabled:opacity-50">
                        I checked—no personal calendar item exists
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
            </div>;
          })}
        </div>
      </section>}
      </>}
    </div>
  );
}
