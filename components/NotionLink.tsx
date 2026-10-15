"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * Every Notion link in Mi goes through here. In the desktop app the click is handed to
 * `notion:open`, which tries the `notion://` deep link so the installed Notion app takes over;
 * the plain href stays as the real fallback for the browser build, middle-click, and the case
 * where the main process cannot hand the deep link off.
 */
export function NotionLink({ href, children, className = "hover:underline", title }: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  function open(event: MouseEvent<HTMLAnchorElement>) {
    const api = window.electronAPI?.notion;
    if (!api) return;
    // Let the browser handle any click the user meant to route itself (new tab, new window).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    api.open(href).catch(() => window.open(href, "_blank", "noreferrer"));
  }
  return <a href={href} target="_blank" rel="noreferrer" onClick={open} className={className} title={title}>{children}</a>;
}
