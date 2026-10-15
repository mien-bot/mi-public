"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MiMark } from "@/components/MiMark";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { CompactChatButton } from "@/components/CompactChatButton";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { ReviewInboxIndicator } from "@/components/ReviewInboxIndicator";
import { isPaneWindowRoute } from "@/components/workspacePanes";

const primaryLinks = [
  { href: "/terminal", label: "Studio", icon: "studio" },
  { href: "/personal", label: "Personal", icon: "personal" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/leads", label: "Leads", icon: "leads" },
  { href: "/permit-qaqc", label: "Permit QAQC", icon: "qaqc" },
] satisfies Array<{ href: string; label: string; icon: AppIconName }>;

const moreLinks = [
  { href: "/getting-started", label: "Start Here", icon: "info" },
  { href: "/contract-writer", label: "Contract Writer", icon: "contract" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/codes", label: "Codes Library", icon: "codes" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/lessons-learned", label: "Lessons Learned", icon: "inspiration" },
] satisfies Array<{ href: string; label: string; icon: AppIconName }>;

export function Nav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const mobileButton = useRef<HTMLButtonElement>(null);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = moreLinks.some((link) => isActive(link.href));

  // Pop-out card windows draw their own titlebar; app chrome inside one of them would sit on
  // top of the card (this header is z-60, the cards are z-50) and steal its height.
  if (isPaneWindowRoute(pathname)) return null;

  return (
    <header className="mi-app-header relative z-[60] border-b border-border bg-background/95 backdrop-blur"
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        if (moreOpen) { setMoreOpen(false); moreButton.current?.focus(); }
        else if (mobileOpen) { setMobileOpen(false); mobileButton.current?.focus(); }
      }}>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        {/* Points at Studio, not "/", so the logo and the Studio tab land in the same place --
            the Explorer + terminal workspace rather than the full-page chat. */}
        <Link href="/terminal" onClick={() => setMobileOpen(false)} aria-label="Mi Studio home" className="flex shrink-0 items-center gap-2">
          <span className="font-display text-2xl font-light tracking-wider">STUDIO</span>
          <span className="text-muted-foreground">/</span>
          <MiMark className="h-10 w-10 animate-ink-bloom text-muted-foreground" />
        </Link>
        <div className="mi-primary-nav hidden items-center gap-3 xl:flex">
          <nav aria-label="Main navigation" className="flex items-center gap-4 text-sm">
            {primaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`nav-link flex items-center gap-1.5 whitespace-nowrap ${
                  isActive(link.href)
                    ? "nav-link-active font-medium text-accent"
                    : "text-muted-foreground transition-colors hover:text-foreground"
                }`}
              >
                <AppIcon name={link.icon} className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
            {/* Sits in the primary row, not under More: a queue nobody can see is the exact
                problem the review inbox exists to solve. */}
            <ReviewInboxIndicator active={isActive("/review")} />
            <div className="relative">
              <button
                ref={moreButton}
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                className={`flex items-center gap-1 whitespace-nowrap transition-colors ${
                  moreActive ? "font-medium text-accent" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                More
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {moreOpen && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => setMoreOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="animate-fade-in-up absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-1 rounded-md border border-border bg-card p-2 shadow-[var(--shadow-sm)]">
                    {moreLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        aria-current={isActive(link.href) ? "page" : undefined}
                        onClick={() => setMoreOpen(false)}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                          isActive(link.href)
                            ? "font-medium text-accent"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <AppIcon name={link.icon} className="h-4 w-4" />
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </nav>
          <div className="flex items-center gap-2">
            <CompactChatButton className="tactile-control flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2.5 py-2 text-xs text-muted-foreground hover:border-accent hover:text-foreground" />
            <Link
              href="/settings"
              aria-current={isActive("/settings") ? "page" : undefined}
              className={`flex items-center gap-1.5 ${
                isActive("/settings")
                  ? "text-sm font-medium text-accent"
                  : "text-sm text-muted-foreground transition-colors hover:text-foreground"
              }`}
            >
              <AppIcon name="settings" className="h-4 w-4" />
              <span className="sr-only">Settings</span>
              <ProfileAvatar className="h-9 w-9" />
            </Link>
          </div>
        </div>
        <button
          ref={mobileButton}
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mi-mobile-navigation"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-foreground xl:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
            className="h-5 w-5"
          >
            {mobileOpen ? <path d="M5 5l14 14M19 5 5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {mobileOpen && (
        <nav id="mi-mobile-navigation" className="animate-fade-in-up border-t border-border px-4 py-3 xl:hidden" aria-label="Mobile navigation">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-1">
            {[
              ...primaryLinks,
              { href: "/review", label: "Review Inbox", icon: "inbox" as const },
              ...moreLinks,
              { href: "/settings", label: "Settings & profile", icon: "settings" as const },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-3 text-sm transition-colors ${
                  isActive(link.href)
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <AppIcon name={link.icon} className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
            <CompactChatButton className="tactile-control col-span-2 flex items-center justify-center gap-2 rounded-md border border-border px-3 py-3 text-sm text-muted-foreground" label="Open Talk to Mi window" />
          </div>
        </nav>
      )}
    </header>
  );
}
