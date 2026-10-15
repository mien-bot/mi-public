"use client";

import { useState } from "react";

export function CopyPortfolioBriefing({ briefing }: { briefing: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(briefing);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Copy briefing
      </button>
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {state === "copied"
          ? "Briefing copied as plain text."
          : state === "failed"
            ? "Copy was unavailable. Select the briefing text instead."
            : ""}
      </span>
    </div>
  );
}
