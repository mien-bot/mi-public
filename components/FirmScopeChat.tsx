"use client";
import { reportMiActivity, finishMiActivity, requestMiActivityStop } from "@/lib/miniMi/activity";

import { useEffect, useRef, useState } from "react";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import type { ExportableChat } from "@/components/ChatExportMenu";
import { ChatActions } from "@/components/ChatActions";
import type { ChatWindowPath } from "@/components/NewChatWindowButton";
import { MiMark } from "@/components/MiMark";
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_ORDER,
  createDefaultProviderModels,
  updateProviderModel,
} from "@/components/agentModels";
import type { AgentEngine, AgentScope } from "@/types/electron";
import { LeadCopilotProposalList } from "@/components/LeadCopilotProposalList";
import { parseLeadCopilotReply, type LeadCopilotProposal } from "@/lib/leadCopilot";
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENTS,
  chatAttachmentError,
  chatAttachmentKind,
  isContractAttachment,
} from "@/components/chatAttachments";

type FirmChatScope = Extract<AgentScope, "leads" | "permit-qaqc">;

interface FirmChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  pending?: boolean;
  createdAt: number;
  proposals?: LeadCopilotProposal[];
  proposalError?: string | null;
  attachmentCount?: number;
}

interface FirmConversation {
  id: string;
  title: string;
  engine: AgentEngine;
  model: string;
  sessionId: string | null;
  messages: FirmChatMessage[];
  createdAt: number;
  updatedAt: number;
  entitySlug?: string;
}

interface FirmChatAttachment {
  id: string;
  name: string;
  dataUrl: string;
  kind: "image" | "document";
}

const scopeContent: Record<FirmChatScope, {
  title: string;
  description: string;
  empty: string;
  placeholder: string;
}> = {
  leads: {
    title: "Talk with Mi about Leads",
    description: "Use your local CLI to review the pipeline, plan follow-ups, and spot missing confirmed details.",
    empty: "Ask which leads need attention, what information is missing, or how to prepare the next follow-up.",
    placeholder: "Ask about leads...",
  },
  "permit-qaqc": {
    title: "Talk with Mi about Permit QAQC",
    description: "Use your local CLI to triage review work, missing inputs, findings, and response priorities.",
    empty: "Ask what needs review next, which engagement is blocked, or how to organize a response.",
    placeholder: "Ask about Permit QAQC...",
  },
};

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : "The local CLI stopped unexpectedly.";
}

function mergeConversations(
  current: FirmConversation[],
  incoming: FirmConversation[],
): FirmConversation[] {
  const byId = new Map<string, FirmConversation>();
  for (const conversation of [...current, ...incoming]) {
    const existing = byId.get(conversation.id);
    if (!existing || conversation.updatedAt >= existing.updatedAt) byId.set(conversation.id, conversation);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
}

export function FirmScopeChat({ scope, startFresh = false, leadContext }: {
  scope: FirmChatScope;
  startFresh?: boolean;
  leadContext?: { slug: string; name: string; notionLinked: boolean };
}) {
  const content = scopeContent[scope];
  const [engine, setEngine] = useState<AgentEngine>("codex");
  const [modelsByEngine, setModelsByEngine] = useState(createDefaultProviderModels);
  const [modelValid, setModelValid] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FirmChatMessage[]>([]);
  const [conversations, setConversations] = useState<FirmConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FirmChatAttachment[]>([]);
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const model = modelsByEngine[engine];
  const controlClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:opacity-50";
  const storageKey = `mi:firmScopeChat:${scope}:${leadContext?.slug ?? "all"}:v2`;
  const title = leadContext ? `Talk with Mi about ${leadContext.name}` : content.title;
  const chatPath: ChatWindowPath = leadContext ? `/leads/${leadContext.slug}/chat` : `/${scope}`;

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(parsed)) return;
      const restored = parsed.filter((value): value is FirmConversation => (
        typeof value === "object" && value !== null &&
        typeof (value as FirmConversation).id === "string" &&
        Array.isArray((value as FirmConversation).messages)
      )).filter((conversation) => !leadContext || conversation.entitySlug === leadContext.slug)
        .map((conversation) => ({
        ...conversation,
        createdAt: typeof conversation.createdAt === "number"
          ? conversation.createdAt
          : conversation.messages[0]?.createdAt ?? conversation.updatedAt,
      })).slice(0, 30);
      setConversations(restored);
      if (restored[0] && !startFresh) {
        setActiveConversationId(restored[0].id);
        setEngine(restored[0].engine);
        setModelsByEngine((current) => updateProviderModel(current, restored[0].engine, restored[0].model));
        setSessionId(restored[0].sessionId);
        setMessages(restored[0].messages.map((message) => ({ ...message, pending: false })));
      }
    } catch {
      // Malformed local history is ignored; a fresh chat remains available.
    }
    void fetch(`/api/chat/history?scope=${scope}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Chat archive unavailable.")))
      .then((payload: { conversations?: FirmConversation[] }) => {
        const matching = (payload.conversations ?? []).filter((conversation) => (
          leadContext ? conversation.entitySlug === leadContext.slug : !conversation.entitySlug
        ));
        setConversations((current) => mergeConversations(current, matching));
      })
      .catch(() => {});
  }, [leadContext, scope, startFresh, storageKey]);

  useEffect(() => {
    if (messages.length === 0) return;
    const firstPrompt = messages.find((message) => message.role === "user")?.text ?? "New chat";
    const entry: FirmConversation = {
      id: activeConversationId,
      title: firstPrompt.replace(/\s+/g, " ").slice(0, 60),
      engine,
      model,
      sessionId,
      messages: messages.slice(-100).map((message) => ({ ...message, pending: false })),
      createdAt: messages[0]?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      entitySlug: leadContext?.slug,
    };
    const timer = window.setTimeout(() => {
      setConversations((current) => {
        const next = mergeConversations(current, [entry]);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        void fetch("/api/chat/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, conversations: next }),
        }).catch(() => {});
        return next;
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeConversationId, engine, leadContext?.slug, messages, model, scope, sessionId, storageKey]);

  useEffect(() => {
    function syncHistory(event: StorageEvent) {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as FirmConversation[];
        if (Array.isArray(parsed)) setConversations((current) => mergeConversations(current, parsed));
      } catch {
        // Ignore a malformed update from another renderer.
      }
    }
    window.addEventListener("storage", syncHistory);
    return () => window.removeEventListener("storage", syncHistory);
  }, [storageKey]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.agent.onChunk(({ requestId, chunk }) => {
      if (requestId !== activeRequestRef.current || !chunk) return;
      setMessages((current) => current.map((message) => (
        message.id === requestId
          ? { ...message, text: message.text + chunk }
          : message
      )));
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function changeEngine(nextEngine: AgentEngine) {
    setEngine(nextEngine);
    setSessionId(null);
  }

  function changeModel(nextModel: string) {
    setModelsByEngine((current) => updateProviderModel(current, engine, nextModel));
    setSessionId(null);
  }

  async function sendMessage() {
    const typedPrompt = input.trim();
    if ((!typedPrompt && attachments.length === 0) || activeRequestRef.current || !modelValid) return;
    const api = window.electronAPI;
    if (!api) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "error",
          text: "This conversation requires the Mi desktop app and a configured local Codex or Claude CLI.",
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    const sentAttachments = attachments;
    const reviewingContract = sentAttachments.some((attachment) => isContractAttachment(attachment.name));
    const prompt = typedPrompt || (reviewingContract
      ? "Review the attached contract. Identify material business, scope, fee, schedule, liability, termination, insurance, ownership, and coordination issues. Cite the exact filename and clause, heading, page, or phrase for every finding. Separate confirmed text from interpretation and list questions that require human or legal review."
      : "Inspect the attached files and summarize the relevant evidence. Cite each filename and say explicitly if any file cannot be read.");
    const requestId = crypto.randomUUID();
    setInput("");
    setAttachments([]);
    setAttachmentMessage("");
    activeRequestRef.current = requestId;
    setActiveRequestId(requestId);
    reportMiActivity({ id: requestId, scope: leadContext ? `leads/${leadContext.slug}` : scope,
      label: leadContext ? `Lead · ${leadContext.name}`.slice(0,100) : scope === "leads" ? "Lead workspace" : "Permit review", href: chatPath, state: "running" });
    const displayPrompt = `${typedPrompt || (reviewingContract ? "Review attached contract" : "Review attached files")}`
      + (sentAttachments.length ? `\n\n📎 ${sentAttachments.map((attachment) => attachment.name).join(", ")}` : "");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: displayPrompt, createdAt: Date.now() },
      {
        id: requestId,
        role: "assistant",
        text: "",
        pending: true,
        createdAt: Date.now(),
        attachmentCount: sentAttachments.length,
      },
    ]);

    try {
      const result = await api.agent.send({
        requestId,
        engine,
        model: model || null,
        cwd: ".",
        prompt,
        sessionId,
        scope,
        entitySlug: leadContext?.slug,
        entityName: leadContext?.name,
        attachments: sentAttachments.map(({ name, dataUrl }) => ({ name, dataUrl })),
      });
      const parsedReply = leadContext && !result.isError
        ? parseLeadCopilotReply(result.fullOutput)
        : null;
      finishMiActivity(requestId, result.isError || parsedReply?.proposalError ? "attention" : parsedReply?.proposals.length ? "review" : "finished");
      setSessionId(result.sessionId);
      setMessages((current) => current.map((message) => {
        if (message.id !== requestId) return message;
        return {
          ...message,
          role: result.isError ? "error" : "assistant",
          text: parsedReply?.text || result.fullOutput || message.text || (
            result.isError ? "The local CLI exited without an error message." : "Mi did not return any text."
          ),
          pending: false,
          proposals: parsedReply?.proposals,
          proposalError: parsedReply?.proposalError,
        };
      }));
    } catch (error) {
      finishMiActivity(requestId, "attention");
      setMessages((current) => current.map((message) => (
        message.id === requestId
          ? { ...message, role: "error", text: errorText(error), pending: false }
          : message
      )));
    } finally {
      if (activeRequestRef.current === requestId) activeRequestRef.current = null;
      setActiveRequestId((current) => current === requestId ? null : current);
    }
  }

  function cancel() {
    if (!activeRequestRef.current) return;
    requestMiActivityStop(activeRequestRef.current);
    window.electronAPI?.agent.cancel(activeRequestRef.current);
  }

  function startNewConversation() {
    if (activeRequestId) return;
    setActiveConversationId(crypto.randomUUID());
    setSessionId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setAttachmentMessage("");
  }

  function selectConversation(conversation: FirmConversation) {
    if (activeRequestId) return;
    setActiveConversationId(conversation.id);
    setEngine(conversation.engine);
    setModelsByEngine((current) => updateProviderModel(current, conversation.engine, conversation.model));
    setSessionId(conversation.sessionId);
    setMessages(conversation.messages);
    setAttachments([]);
    setAttachmentMessage("");
  }

  function addFiles(files: FileList | File[]): void {
    const incoming = Array.from(files);
    if (attachments.length + incoming.length > MAX_CHAT_ATTACHMENTS) {
      setAttachmentMessage(`Attach no more than ${MAX_CHAT_ATTACHMENTS} files at once.`);
      return;
    }
    setAttachmentMessage("");
    for (const file of incoming) {
      const validation = chatAttachmentError(file);
      const kind = chatAttachmentKind(file.name, file.type);
      if (validation || !kind) {
        setAttachmentMessage(validation ?? `"${file.name}" is not supported.`);
        continue;
      }
      const reader = new FileReader();
      reader.onerror = () => setAttachmentMessage(`Mi could not read "${file.name}" from the file picker.`);
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        setAttachments((current) => current.length >= MAX_CHAT_ATTACHMENTS
          ? current
          : [...current, {
              id: crypto.randomUUID(),
              name: file.name,
              dataUrl: reader.result as string,
              kind,
            }]);
      };
      reader.readAsDataURL(file);
    }
  }

  return (
    <section className="flex h-[min(42rem,calc(100vh-7rem))] min-h-[30rem] overflow-hidden rounded-xl border border-border bg-card">
      <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-muted/40 sm:flex">
        <div className="border-b border-border p-3">
          <ChatActions
            path={chatPath}
            conversations={conversations satisfies ExportableChat[]}
            activeConversationId={activeConversationId}
            onNewChat={startNewConversation}
            disabled={Boolean(activeRequestId)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={`${title} history`}>
          <p className="px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            History · {conversations.length}
          </p>
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => selectConversation(conversation)}
              disabled={Boolean(activeRequestId)}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-xs ${
                conversation.id === activeConversationId
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              }`}
            >
              <span className="block truncate font-medium">{conversation.title}</span>
              <span className="mt-0.5 block text-[10px]">
                {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(conversation.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-border p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-light">{title}</h2>
          <div className="sm:hidden">
            <ChatActions
              path={chatPath}
              conversations={conversations satisfies ExportableChat[]}
              activeConversationId={activeConversationId}
              onNewChat={startNewConversation}
              disabled={Boolean(activeRequestId)}
              layout="inline"
            />
          </div>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          {leadContext
            ? `This conversation is contained in the ${leadContext.name} lead workspace. Ask Mi to summarize meeting or site-visit notes, prepare follow-ups, or draft lead updates.`
            : content.description} The agent is read-only; every proposed record or Notion change requires your explicit review and confirmation.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Agent
            <select
              value={engine}
              onChange={(event) => changeEngine(event.target.value as AgentEngine)}
              disabled={Boolean(activeRequestId)}
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
            onModelChange={changeModel}
            onValidityChange={setModelValid}
            disabled={Boolean(activeRequestId)}
            controlClassName={controlClass}
            groupClassName="text-xs text-muted-foreground"
            labelClassName="block"
          />
        </div>
      </div>

      <div aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="rounded-lg bg-muted p-4 text-sm leading-6 text-muted-foreground">
            {content.empty}
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%]" : "max-w-[88%]"}>
            <div
              className={`whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6 ${
                message.role === "user"
                  ? "bg-accent text-accent-foreground"
                  : message.role === "error"
                    ? "border border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "bg-muted text-foreground"
              }`}
            >
              {message.text || (message.pending ? (
                <span className="inline-flex items-center gap-2" aria-label="Mi is thinking">
                  <MiMark gradient className="h-4 w-4 shrink-0 animate-mark-loading" />
                  <span>
                    {message.attachmentCount
                      ? `Mi is reviewing ${message.attachmentCount} attachment${message.attachmentCount === 1 ? "" : "s"}`
                      : "Mi is thinking"}
                  </span>
                  <span className="inline-flex gap-1" aria-hidden="true">
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                    <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                  </span>
                </span>
              ) : "")}
            </div>
            {leadContext && message.proposals && message.proposals.length > 0 && (
              <LeadCopilotProposalList
                leadSlug={leadContext.slug}
                notionLinked={leadContext.notionLinked}
                proposals={message.proposals}
              />
            )}
            {message.proposalError && <p className="mt-2 text-xs text-status-danger-foreground">{message.proposalError}</p>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDraggingFiles(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingFiles(false);
          if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
        }}
        className={`border-t p-4 transition-all ${
          draggingFiles
            ? "border-accent bg-accent/10 shadow-[inset_0_0_0_1px_var(--accent)]"
            : "border-border"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={CHAT_ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {draggingFiles && (
          <div className="mb-3 rounded-lg border border-dashed border-accent bg-background/70 p-3 text-center text-sm font-medium text-accent">
            Drop contracts or reference files here
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Attached files">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group flex max-w-full items-center gap-2 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2 pr-1 text-xs shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                  {attachment.kind === "image" ? "IMG" : "DOC"}
                </span>
                <span className="max-w-56 truncate" title={attachment.name}>{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  aria-label={`Remove ${attachment.name}`}
                  className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentMessage && (
          <p
            className="mb-3 rounded-md border border-status-danger-foreground/30 bg-status-danger-foreground/5 px-3 py-2 text-xs text-status-danger-foreground"
            role="alert"
          >
            {attachmentMessage}
          </p>
        )}
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
          placeholder={leadContext ? "Ask about this lead, or attach a contract for review…" : content.placeholder}
          className={`${controlClass} resize-none transition-shadow`}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(activeRequestId)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-accent hover:text-foreground hover:shadow-sm disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden="true">
                <path d="M21.4 11.1 12.5 20a4.5 4.5 0 0 1-6.4-6.4l9.2-9.2a3 3 0 1 1 4.3 4.2l-9.2 9.2a1.5 1.5 0 0 1-2.1-2.1l8.5-8.5" />
              </svg>
              Attach contract
            </button>
            <p className="hidden text-[11px] text-muted-foreground md:block">
              PDF, DOCX, text, RTF, or image · 20 MB each
            </p>
          </div>
          <p className="hidden">
            Enter to send · Shift+Enter for a new line
          </p>
          {activeRequestId ? (
            <button
              type="button"
              onClick={cancel}
              aria-label="Stop generating"
              title="Stop generating"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:border-accent hover:text-foreground"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!input.trim() && attachments.length === 0) || !modelValid}
              className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
            >
              {attachments.length ? "Review" : "Send"}
            </button>
          )}
        </div>
      </form>
      </div>
    </section>
  );
}
