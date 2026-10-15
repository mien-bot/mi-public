"use client";

import { PdfBrandExport } from "./PdfBrandExport";

export interface ExportableChat {
  id: string;
  title: string;
  engine: string;
  model: string;
  projectSlug?: string;
  sessionId?: string | null;
  createdAt: number | string;
  updatedAt: number | string;
  messages: Array<{ id?: string; role: "user" | "assistant" | "error"; text: string; createdAt: number | string }>;
}

function safeName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").slice(0, 80) || "Mi chat";
}

function timestamp(value: number | string): string {
  return new Date(value).toISOString();
}

export function chatToMarkdown(chat: ExportableChat): string {
  const metadata = [
    "---",
    `title: ${JSON.stringify(chat.title)}`,
    "source: Mi",
    `agent: ${JSON.stringify(chat.engine)}`,
    `model: ${JSON.stringify(chat.model || "default")}`,
    ...(chat.projectSlug ? [`project: ${JSON.stringify(chat.projectSlug)}`] : []),
    `created: ${timestamp(chat.createdAt)}`,
    `updated: ${timestamp(chat.updatedAt)}`,
    "---",
    "",
    `# ${chat.title}`,
    "",
  ];
  return `${metadata.join("\n")}${chat.messages.map((message) => (
    `## ${message.role === "user" ? "You" : message.role === "error" ? "Mi error" : "Mi"}\n\n${message.text}\n`
  )).join("\n")}`;
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ChatExportMenu({
  conversations,
  activeConversationId,
}: {
  conversations: ExportableChat[];
  activeConversationId?: string | null;
}) {
  const active = conversations.find((conversation) => conversation.id === activeConversationId)
    ?? conversations[0];
  if (conversations.length === 0) return null;
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border bg-background px-3 py-2 text-xs hover:border-accent">
        Export
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-xl">
        <div className="border-b border-border p-2"><PdfBrandExport /></div>
        <button
          type="button"
          disabled={!active}
          onClick={() => active && download(`${safeName(active.title)}.md`, chatToMarkdown(active), "text/markdown")}
          className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
        >
          Current chat → Obsidian Markdown
        </button>
        <button
          type="button"
          onClick={() => download(
            `Mi chat history ${new Date().toISOString().slice(0, 10)}.md`,
            conversations.map(chatToMarkdown).join("\n\n---\n\n"),
            "text/markdown",
          )}
          className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
        >
          All chats → Markdown
        </button>
        <button
          type="button"
          onClick={() => download(
            `Mi chat history ${new Date().toISOString().slice(0, 10)}.json`,
            `${JSON.stringify({ exportedAt: new Date().toISOString(), conversations }, null, 2)}\n`,
            "application/json",
          )}
          className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
        >
          All chats → JSON backup
        </button>
      </div>
    </details>
  );
}
