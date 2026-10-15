"use client";

import { useState } from "react";
import { FirmScopeChat } from "@/components/FirmScopeChat";
import { TerminalPanel } from "@/components/TerminalPanel";

export function LeadTalkWorkspace({
  slug,
  name,
  notionLinked,
  startFresh,
}: {
  slug: string;
  name: string;
  notionLinked: boolean;
  startFresh: boolean;
}) {
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  return (
    <div>
      <div className="mb-3 inline-flex rounded-md border border-border bg-card p-1" role="tablist" aria-label="Talk to Mi mode">
        {(["chat", "terminal"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            onClick={() => setMode(option)}
            className={`rounded px-3 py-1.5 text-sm capitalize ${mode === option ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          >
            {option}
          </button>
        ))}
      </div>
      <div className={mode === "chat" ? "block" : "hidden"}>
        <FirmScopeChat
          scope="leads"
          startFresh={startFresh}
          leadContext={{ slug, name, notionLinked }}
        />
      </div>
      <div className={mode === "terminal" ? "block" : "hidden"}>
        <TerminalPanel cwd={`leads/${slug}`} compact active={mode === "terminal"} />
      </div>
    </div>
  );
}
