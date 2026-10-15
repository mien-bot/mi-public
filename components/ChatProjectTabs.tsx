"use client";

import { ROOT_PROJECT_VALUE } from "@/components/chatTypes";

export interface ChatProjectTabItem {
  id: string;
  label: string;
  active: boolean;
  /** True when this tab's own thread has a request in flight -- lets a tab streaming in the
   * background (while a different tab is on screen) stay visibly distinguishable from an idle
   * one. */
  pending: boolean;
}

export interface ChatProjectTabOption {
  slug: string;
  name: string;
}

/**
 * Horizontal, scrollable strip of open project chat tabs. Rendered once by ChatWidget and
 * reused in both the home and floating-bubble layouts (single shared component/state, so
 * switching a tab in one place is reflected in the other).
 *
 * The "+ New chat" picker only offers already-local projects (plus "No project") -- opening a
 * not-yet-scaffolded Notion project still goes through the existing "Project context" dropdown
 * on the active tab, which already handles scaffolding; duplicating that flow here isn't worth
 * the complexity for a first cut.
 */
export function ChatProjectTabs({
  tabs,
  options,
  onSelect,
  onClose,
  onOpen,
  canOpenMore,
}: {
  tabs: ChatProjectTabItem[];
  options: ChatProjectTabOption[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpen: (projectSlug: string) => void;
  canOpenMore: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Open project chats">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.active}
          className={`group flex shrink-0 items-center gap-1 rounded-md border py-1 pl-2 pr-1 text-xs transition-colors ${
            tab.active
              ? "border-accent bg-accent/10 text-foreground"
              : "border-border text-muted-foreground hover:border-accent hover:text-foreground"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelect(tab.id)}
            className="flex max-w-32 items-center gap-1.5 truncate"
            title={tab.label}
          >
            {tab.pending && (
              <span
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                aria-label="Streaming in the background"
              />
            )}
            <span className="truncate">{tab.label}</span>
          </button>
          <button
            type="button"
            onClick={() => onClose(tab.id)}
            aria-label={`Close ${tab.label} tab`}
            title="Close tab"
            className="shrink-0 rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
      <label className="shrink-0">
        <span className="sr-only">Open a new project chat tab</span>
        <select
          value=""
          disabled={!canOpenMore}
          onChange={(e) => {
            if (e.target.value) onOpen(e.target.value);
            e.target.value = "";
          }}
          title={canOpenMore ? "Open a new chat tab" : "Close a tab to open another"}
          className="rounded-md border border-dashed border-border bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none transition-colors focus:border-accent disabled:opacity-40"
        >
          <option value="" disabled>+ New chat</option>
          <option value={ROOT_PROJECT_VALUE}>No project</option>
          {options.map((option) => (
            <option key={option.slug} value={option.slug}>{option.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
