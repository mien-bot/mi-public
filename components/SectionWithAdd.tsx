"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A record list with its entry form folded away behind one button.
 *
 * Mi's list pages used to open on an empty form with the existing records pushed below it,
 * which optimizes for the rarer visit: most of the time a person is here to read what was
 * already recorded, not to add another. The form is one click away and gets focus when it
 * opens, so nothing is slower — it just is not the first thing on screen.
 */
export function SectionWithAdd({
  title,
  description,
  addLabel,
  count,
  actions,
  children,
  form,
  id,
}: {
  title: string;
  description?: string;
  addLabel: string;
  /** Shown beside the title; omit when the list itself makes the number obvious. */
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** A node, or a function given a `close` callback so a successful save can fold it away. */
  form?: React.ReactNode | ((close: () => void) => React.ReactNode);
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusable = formRef.current?.querySelector<HTMLElement>("input, textarea, select");
    focusable?.focus({ preventScroll: true });
  }, [open]);

  return (
    <section id={id} className="scroll-mt-6 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">
            {title}
            {typeof count === "number" && count > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>
            )}
          </h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {form && (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background"
            >
              {open ? "Cancel" : addLabel}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">{children}</div>

      {open && form && (
        <div ref={formRef} className="mt-4 border-t border-border pt-4">
          {typeof form === "function" ? form(() => setOpen(false)) : form}
        </div>
      )}
    </section>
  );
}
