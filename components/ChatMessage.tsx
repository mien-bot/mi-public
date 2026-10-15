"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ChatMessage } from "@/components/chatTypes";
import { MiMark } from "@/components/MiMark";
import {
  ProjectCopilotProposalList,
  type CurrentProjectValues,
  type ProjectPickerOption,
} from "@/components/ProjectCopilotProposalList";

export const ChatMessageBubble = memo(function ChatMessageBubble({ message, projectSlug, notionLinked, projectOptions, currentValues }: {
  message: ChatMessage;
  projectSlug: string | null;
  notionLinked: boolean;
  /** Only needed/used when projectSlug is null (root/holistic chat) -- lets a schedule-item proposal pick a target project. */
  projectOptions?: ProjectPickerOption[];
  /** Stored project values, so a patch proposal shows before → after. Omitted in root chat. */
  currentValues?: CurrentProjectValues;
}) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const showTypingDots = message.pending && !message.text;
  const [reading, setReading] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => () => {
    if (utteranceRef.current) window.speechSynthesis.cancel();
  }, []);

  function readAloud() {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.text);
    utteranceRef.current = utterance;
    utterance.onend = () => {
      utteranceRef.current = null;
      setReading(false);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setReading(false);
    };
    setReading(true);
    window.speechSynthesis.speak(utterance);
  }

  function stopReading() {
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setReading(false);
  }

  return (
    <div
      data-role={message.role}
      data-pending={message.pending ? "true" : "false"}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-accent text-accent-foreground"
            : isError
              ? "bg-status-danger text-status-danger-foreground"
              : "bg-muted text-foreground"
        }`}
      >
        {showTypingDots ? (
          <span className="inline-flex items-center gap-2 py-0.5" aria-label="Mi is thinking">
            <MiMark gradient className="h-4 w-4 shrink-0 animate-mark-loading" />
            <span className="text-muted-foreground">Mi is thinking</span>
            <span className="inline-flex items-center gap-1" aria-hidden="true">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          </span>
        ) : (
          message.text
        )}
        {!isUser && !isError && message.text && !message.pending && (
          <button
            type="button"
            onClick={reading ? stopReading : readAloud}
            aria-pressed={reading}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
              {reading ? (
                <>
                  <path d="M5 9v6h4l5 4V5L9 9H5Z" />
                  <path d="M17.5 9.5a4 4 0 0 1 0 5" />
                  <path d="M20 7a7.5 7.5 0 0 1 0 10" />
                </>
              ) : (
                <path d="M5 9v6h4l5 4V5L9 9H5Z" />
              )}
            </svg>
            {reading ? "Stop reading" : "Read aloud"}
          </button>
        )}
        {message.proposalError && (
          <p className="mt-2 rounded-md border border-status-danger/40 p-2 text-xs text-status-danger-foreground">
            {message.proposalError}
          </p>
        )}
        {message.workspaceRepairSlug && (
          <Link
            href={`/projects/${message.workspaceRepairSlug}/files`}
            className="mt-2 inline-block rounded-md border border-status-danger-foreground/40 px-2.5 py-1.5 text-xs font-medium underline underline-offset-2 hover:no-underline"
          >
            Go confirm this project&apos;s agent workspace →
          </Link>
        )}
        {message.proposals && message.proposals.length > 0 && (
          <ProjectCopilotProposalList
            projectSlug={projectSlug}
            notionLinked={notionLinked}
            proposals={message.proposals}
            projectOptions={projectOptions}
            currentValues={currentValues}
          />
        )}
      </div>
    </div>
  );
});
