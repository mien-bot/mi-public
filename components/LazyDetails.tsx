"use client";

import { useState, type ReactNode } from "react";

/** A disclosure whose contents do not mount, or fetch anything, until it is first opened. */
export function LazyDetails({ summary, className, children }: { summary: ReactNode; className?: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return <details className={className} onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary className="cursor-pointer font-medium">{summary}</summary>
    {opened && <div className="mt-4">{children}</div>}
  </details>;
}
