"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MI_FEATURE_GROUPS } from "@/components/FeatureGuide";

/**
 * An animated, step-by-step walkthrough of MI_FEATURE_GROUPS (see FeatureGuide.tsx) --
 * shared by the first-run onboarding wizard and Settings > Product tour, so there's one
 * implementation of "what Mi can do" instead of two.
 */
export function FeatureTour() {
  const [index, setIndex] = useState(0);
  const total = MI_FEATURE_GROUPS.length;
  const feature = MI_FEATURE_GROUPS[index];
  const isLast = index === total - 1;

  const next = useCallback(() => setIndex((current) => Math.min(current + 1, total - 1)), [total]);
  const back = useCallback(() => setIndex((current) => Math.max(current - 1, 0)), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, back]);

  return (
    <div className="animate-ink-bloom mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-8">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-accent">
        Product tour · {index + 1} of {total}
      </span>

      <div key={feature.number} className="animate-fade-in-up mt-6">
        <span className="font-mono text-xs tracking-[0.18em] text-accent">{feature.number}</span>
        <h2 className="mt-2 font-display text-2xl font-light">{feature.title}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.description}</p>
        <ul className="mt-5 space-y-2.5 text-sm">
          {feature.capabilities.map((capability) => (
            <li key={capability} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{capability}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full border border-border px-2 py-1 text-[0.65rem] text-muted-foreground">
            {feature.surface}
          </span>
          <Link href={feature.href} className="inline-flex items-center gap-2 text-sm font-medium text-link">
            {feature.action}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour progress">
          {MI_FEATURE_GROUPS.map((group, groupIndex) => (
            <button
              key={group.number}
              type="button"
              role="tab"
              onClick={() => setIndex(groupIndex)}
              aria-label={`Go to step ${groupIndex + 1}: ${group.title}`}
              aria-selected={groupIndex === index}
              className={`h-1.5 rounded-full transition-all ${
                groupIndex === index ? "w-6 bg-accent" : "w-1.5 bg-border hover:bg-accent/50"
              }`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-accent disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={isLast ? () => setIndex(0) : next}
            className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground transition-opacity hover:opacity-90"
          >
            {isLast ? "Replay" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
