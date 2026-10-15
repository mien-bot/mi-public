"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One workspace surface as a split control: the wide half opens it in place, the narrow
 * half pops it out into its own pinned card window. Talk to Mi and Terminal are peers and
 * render with the same control, so neither reads as a sub-mode of the other.
 */
export function WorkspacePaneButton({
  label,
  hint,
  icon,
  href,
  onOpen,
  onPopOut,
  active = false,
  poppedOut = false,
  canPopOut = true,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  /** Given for a surface that has its own page; otherwise onOpen handles the primary half. */
  href?: string;
  onOpen?: () => void;
  onPopOut: () => void;
  active?: boolean;
  poppedOut?: boolean;
  /** False where pinned windows do not exist (a browser tab). The half stays visible and
   * says why rather than opening a card that cannot work. */
  canPopOut?: boolean;
}) {
  const shellClass = `tactile-control inline-flex items-stretch overflow-hidden rounded-lg border ${
    active ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent"
  }`;
  const primaryClass = "flex items-center gap-2 px-3 py-2 text-left text-sm";
  const primaryContent = (
    <>
      <span className="shrink-0 text-accent" aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium leading-tight">{label}</span>
        <span className="block truncate text-[10px] leading-tight text-muted-foreground">
          {poppedOut ? "In a pinned window" : hint}
        </span>
      </span>
    </>
  );

  return (
    <div className={shellClass}>
      {href ? (
        <Link href={href} className={primaryClass} aria-current={active ? "page" : undefined}>
          {primaryContent}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={primaryClass}>
          {primaryContent}
        </button>
      )}
      <button
        type="button"
        onClick={onPopOut}
        disabled={!canPopOut}
        title={
          canPopOut
            ? poppedOut ? `Focus the ${label} window` : `Open ${label} in a pinned window`
            : "Pinned windows are only available in the Mi desktop app"
        }
        aria-label={
          canPopOut
            ? poppedOut ? `Focus the ${label} window` : `Open ${label} in a pinned window`
            : `Open ${label} in a pinned window (desktop app only)`
        }
        className={`flex w-9 shrink-0 items-center justify-center border-l transition-colors ${
          active ? "border-accent/40" : "border-border"
        } ${
          canPopOut
            ? `${poppedOut ? "text-accent" : "text-muted-foreground hover:text-foreground"} hover:bg-muted/50`
            : "cursor-not-allowed text-muted-foreground/40"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path d="M14 4h6v6" />
          <path d="m13 11 7-7" />
        </svg>
      </button>
    </div>
  );
}
