"use client";

import { MiMark } from "./MiMark";
import { openChatPane } from "./workspacePanes";

export function compactChatHref(projectSlug?: string | null): string {
  const params = new URLSearchParams({ compactChat: "1" });
  if (projectSlug) params.set("project", projectSlug);
  return `/chat?${params.toString()}`;
}

/**
 * Opens Talk to Mi as its own pinned card window -- the same pop-out the project workspace
 * offers, reachable from anywhere in the app.
 */
export function CompactChatButton({
  projectSlug,
  className = "",
  label = "Talk to Mi",
}: {
  projectSlug?: string | null;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openChatPane(projectSlug)}
      className={className}
      title="Open Talk to Mi in a pinned window"
    >
      <MiMark className="h-4 w-4" />
      {label}
    </button>
  );
}
