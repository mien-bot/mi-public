import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

export function WorkspaceIntro({
  icon,
  eyebrow,
  title,
  description,
  actions,
}: {
  icon: AppIconName;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="workspace-intro holo-sheen overflow-hidden rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mode-icon neon-breathe flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
            <AppIcon name={icon} className="pixel-wipe h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              {eyebrow}
              {/* Only drawn at Cinematic (see .ambient-caret in app/globals.css), and
                  aria-hidden because a blinking block is decoration, not a word. */}
              <span aria-hidden="true" className="ambient-caret ml-1.5 h-3 w-1.5 translate-y-px bg-accent align-middle" />
            </p>
            <h1 className="mt-1 font-display text-3xl font-light tracking-wide">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
