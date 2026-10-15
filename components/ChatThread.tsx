"use client";

import { memo, useEffect, useRef } from "react";
import { ChatMessageBubble } from "@/components/ChatMessage";
import type { ChatMessage } from "@/components/chatTypes";
import type { CurrentProjectValues, ProjectPickerOption } from "@/components/ProjectCopilotProposalList";

export const ChatThread = memo(function ChatThread({ messages, projectSlug, notionLinked, projectOptions, currentValues }: {
  messages: ChatMessage[];
  projectSlug: string | null;
  notionLinked: boolean;
  projectOptions?: ProjectPickerOption[];
  /** Stored project values, so a patch proposal shows before → after. Omitted in root chat. */
  currentValues?: CurrentProjectValues;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <div className="max-w-md space-y-3">
          <p className="font-medium text-foreground">
            {projectSlug ? "Ask for a Project Power View" : "Ask for a Firm Power View"}
          </p>
          <p>
            {projectSlug
              ? "Mi can summarize status, schedule pressure, missing details, open QA/QC, files, and the safest next actions."
              : "Mi can orient you across active projects, scheduling, leads, Permit QA/QC, and personal follow-ups."}
          </p>
          <p className="text-xs">
            Attach supporting files when useful. Assistant replies can be read aloud. Durable facts
            are saved only through reviewed memory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {messages.map((m) => (
        <ChatMessageBubble
          key={m.id}
          message={m}
          projectSlug={projectSlug}
          notionLinked={notionLinked}
          projectOptions={projectOptions}
          currentValues={currentValues}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
});
