"use client";

import { ChatExportMenu, type ExportableChat } from "./ChatExportMenu";
import { NewChatWindowButton, type ChatWindowPath } from "./NewChatWindowButton";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ProjectHandoffComposer } from "./ProjectHandoffComposer";

export function ChatActions({
  path,
  conversations,
  activeConversationId,
  onNewChat,
  disabled = false,
  layout = "sidebar",
}: {
  path: ChatWindowPath;
  conversations: ExportableChat[];
  activeConversationId?: string | null;
  onNewChat: () => void;
  disabled?: boolean;
  layout?: "sidebar" | "inline";
}) {
  const sidebar = layout === "sidebar";
  const [sharing, setSharing] = useState(false);
  const active = conversations.find(chat => chat.id === activeConversationId);
  const shareable = path === "/" && active?.projectSlug && /^[a-z0-9][a-z0-9-]*$/.test(active.projectSlug) && active.projectSlug !== "root";
  return (
    <div className={sidebar ? "grid grid-cols-2 gap-2" : "flex flex-wrap items-center gap-2"}>
      <button
        type="button"
        onClick={onNewChat}
        disabled={disabled}
        className={`${sidebar ? "col-span-2 w-full text-left" : ""} rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:border-accent disabled:opacity-50`}
      >
        + New chat
      </button>
      <NewChatWindowButton
        path={path}
        className="rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:border-accent"
      />
      <ChatExportMenu
        conversations={conversations}
        activeConversationId={activeConversationId}
      />
      {shareable && <button onClick={() => setSharing(true)} className="rounded-md border border-border px-3 py-2 text-left text-xs">Share handoff</button>}
      {sharing && shareable && active && createPortal(<dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={() => setSharing(false)} aria-label="Review project handoff" className="fixed inset-0 m-auto max-h-[90dvh] w-[min(95vw,44rem)] overflow-y-auto rounded-xl border border-border bg-background p-4 text-foreground backdrop:bg-black/50"><button onClick={() => setSharing(false)} className="mb-3 rounded border border-border px-3 py-2 text-sm">Close handoff</button><ProjectHandoffComposer key={active.id} slug={active.projectSlug!} initialTitle={active.title} initialSummary={active.messages.filter(m => m.role === "assistant").at(-1)?.text ?? ""} provider={active.engine} /></dialog>, document.body)}
    </div>
  );
}
