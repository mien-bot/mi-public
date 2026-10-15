"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MiMark } from "@/components/MiMark";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

type LeadNavItem = readonly [label: string, suffix: string, icon: AppIconName | null];

export const LEAD_DAILY_ITEMS = [
  ["Overview", "", "overview"],
  ["Talk to Mi", "/chat", null],
  ["Meetings", "/meetings", "meeting"],
  ["Contracts", "/contracts", "contract"],
  ["Terminal", "/terminal", "studio"],
] as const satisfies ReadonlyArray<LeadNavItem>;

export const LEAD_MORE_ITEMS = [
  ["Analysis", "/analysis", "analysis"],
  ["Owner-supplied", "/owner-supplied", "submissions"],
  ["Dropbox files", "/dropbox", "files"],
] as const satisfies ReadonlyArray<LeadNavItem>;

export function leadWorkspaceActiveSuffix(pathname: string, slug: string): string {
  const base = `/leads/${slug}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return "";
  const route = pathname.slice(base.length + 1).split("/")[0];
  return route ? `/${route}` : "";
}

function LeadNavLink({ slug, item, active }: { slug: string; item: LeadNavItem; active: string }) {
  const [label, suffix, icon] = item;
  const selected = active === suffix;
  return (
    <Link
      href={`/leads/${slug}${suffix}`}
      aria-current={selected ? "page" : undefined}
      className={`tactile-control rounded-md border px-3 py-2 text-sm transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-border hover:border-accent"
      }`}
    >
      <span className="flex items-center gap-2">
        {suffix === "/chat" && <MiMark gradient className="h-4 w-4" />}
        {icon && <AppIcon name={icon} className="h-4 w-4 text-accent" />}
        {label}
      </span>
    </Link>
  );
}

export function LeadWorkspaceNav({ slug }: { slug: string }) {
  const active = leadWorkspaceActiveSuffix(usePathname(), slug);
  const moreActive = LEAD_MORE_ITEMS.some(([, suffix]) => suffix === active);

  return (
    <nav aria-label="Lead workspace" className="surface-depth rounded-xl border border-border bg-card p-3">
      <div className="border-b border-border pb-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Lead workspace</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Conversation, terminal, and active deal work first; files and specialist tools stay under More.</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {LEAD_DAILY_ITEMS.map((item) => (
          <LeadNavLink key={item[0]} slug={slug} item={item} active={active} />
        ))}
      </div>
      <details className="progressive-disclosure mt-3 text-sm" open={moreActive || undefined}>
        <summary className="tactile-control cursor-pointer rounded-md px-2 py-2 font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground">
          More lead tools
        </summary>
        <div className="mt-2 grid gap-2 rounded-lg border border-border bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEAD_MORE_ITEMS.map((item) => (
            <LeadNavLink key={item[0]} slug={slug} item={item} active={active} />
          ))}
        </div>
      </details>
    </nav>
  );
}
