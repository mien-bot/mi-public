"use client";

import { useState } from "react";

/**
 * Opens a confirmed Notion page in the Notion app, falling back to the browser. The target is
 * always an already-confirmed `notion_page_id` from project metadata -- never a guessed or
 * model-supplied URL -- and the main process validates it again before opening
 * (electron/desktopMain.js's "notion:open" handler).
 *
 * Renders nothing outside the desktop app, where there is no shell to open with.
 */
export function OpenInNotionButton({
  notionPageId,
  label = "Open in Notion",
}: {
  notionPageId: string | null | undefined;
  label?: string;
}) {
  const [message, setMessage] = useState("");

  if (!notionPageId) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setMessage("");
          const api = window.electronAPI?.notion;
          if (!api) {
            setMessage("Opening Notion needs the Mi desktop app.");
            return;
          }
          api.open(notionPageId).catch(() => setMessage("Mi could not open that page in Notion."));
        }}
        className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent"
      >
        {label} ↗
      </button>
      {message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}
    </span>
  );
}
