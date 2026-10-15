"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatLauncherDock } from "./ChatLauncherDock";
import { MiAvatar } from "./MiAvatar";
import { miHelperSuggestions } from "./miHelperSuggestions";
import { useMiniMiActivity, useMiniMiMotion, useMiniMiPreference } from "@/lib/theme/useMiniMi";
import type { MiniMiActivity } from "@/lib/theme/useMiniMi";
import { nextMiniMiReaction } from "./miniMiReactions";
import { MI_ACTIVITY_LABELS, useMiActivities, visibleMiActivities } from "@/lib/miniMi/activity";
import { useCompanionClock, useFocusSession } from "@/lib/miniMi/focus";
import { MiniMiFocus } from "./MiniMiFocus";
import { MiniMiSuggestions } from "./MiniMiSuggestions";
import { writeMiniMiPreference } from "@/lib/theme/preferences";

// Client interactions only: retain the rotation when route navigation remounts the helper.
let lastPlayedReaction: MiniMiActivity | null = null;

export function MiniMiHelper({ onChat, pending: legacyPending = false }: { onChat?: () => void; pending?: boolean }) {
  const pathname = usePathname();
  const preference = useMiniMiPreference();
  const { character } = preference;
  const allActivities = useMiActivities();
  const activities = visibleMiActivities(allActivities, pathname);
  const focus = useFocusSession();
  const now = useCompanionClock(Boolean(focus || preference.snoozedUntil || activities.length));
  const pending = activities.some(item => item.state === "running" && (!now || now - item.updatedAt < 1800000)) || (!pathname.startsWith("/personal") && legacyPending);
  const focusing = focus?.phase === "focus" && (!now || focus.endsAt > now);
  const available = preference.behavior !== "hidden" && !(preference.snoozedUntil > now);
  const animated = useMiniMiMotion();
  const activity = useMiniMiActivity(pending);
  const [reaction, setReaction] = useState<{ activity: MiniMiActivity; serial: number } | null>(null);
  const reactionSerial = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);
  function playReaction() {
    if (!animated) return;
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    const next = nextMiniMiReaction(lastPlayedReaction, preference.favorites);
    lastPlayedReaction = next;
    setReaction({ activity: next, serial: ++reactionSerial.current });
    reactionTimer.current = setTimeout(() => setReaction(null), 6000);
  }
  const saved = activities.find(item => item.state === "saved" && now > 0 && now - item.updatedAt < 6000);
  const displayedActivity = animated && reaction ? reaction.activity : animated && saved && preference.behavior === "playful" && preference.favorites.includes("happy") ? "happy" : focusing ? "sleeping" : activity;
  const terminalMatch = /^\/(projects|leads)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/terminal\/?$/.exec(pathname);
  const terminalWorkspace = terminalMatch ? `${terminalMatch[1]}/${terminalMatch[2]}` : null;
  const [terminalContext, setTerminalContext] = useState<{ requested: string; workspace?: string; error?: string } | null>(null);
  const contextReady = !terminalWorkspace || terminalContext?.requested === terminalWorkspace;
  const resolvedPath = terminalContext?.requested === terminalWorkspace && terminalContext.workspace ? `/${terminalContext.workspace}/terminal` : pathname;
  const guidance = miHelperSuggestions(resolvedPath);
  const codingWorkspace = /^\/(projects|leads)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(resolvedPath);
  const codingHref = codingWorkspace && !["new", "analysis"].includes(codingWorkspace[2])
    ? codingWorkspace[1] === "projects"
      ? `/projects/${codingWorkspace[2]}?project=${codingWorkspace[2]}&projectAi=terminal`
      : `/leads/${codingWorkspace[2]}/terminal`
    : null;
  if (terminalContext?.requested === terminalWorkspace && terminalContext.workspace?.startsWith("projects/")) {
    guidance.chatHref = `/${terminalContext.workspace}?project=${encodeURIComponent(terminalContext.workspace.slice("projects/".length))}`;
  }
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const positioned = position !== null;
  const [preferenceError, setPreferenceError] = useState(false);
  useEffect(() => {
    if (available) return;
    const timer = setTimeout(() => { setOpen(false); setPosition(null); }, 0);
    return () => clearTimeout(timer);
  }, [available]);

  useEffect(() => {
    if (!terminalWorkspace || !open) return;
    let disposed = false;
    const resolve = window.electronAPI?.terminal.resolveWorkspace;
    void Promise.resolve(resolve ? resolve(terminalWorkspace) : terminalWorkspace).then(workspace => {
      if (!disposed) setTerminalContext({ requested: terminalWorkspace, workspace });
    }).catch(() => {
      if (!disposed) setTerminalContext({ requested: terminalWorkspace, error: "The terminal’s project link could not be verified. Reopen the terminal before using project suggestions." });
    });
    return () => { disposed = true; };
  }, [terminalWorkspace, open]);

  useEffect(() => {
    if (open && positioned) closeButton.current?.focus();
  }, [open, positioned]);

  function dismiss(restoreFocus = false) {
    setOpen(false);
    setPosition(null);
    setTerminalContext(null);
    if (restoreFocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open || !available) return;
    function place() {
      const anchor = button.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const margin = 16;
      const above = anchor.top - margin - 12;
      const below = window.innerHeight - margin - anchor.bottom - 12;
      const useAbove = above >= box.height || above >= below;
      const maxHeight = Math.max(80, useAbove ? above : below);
      const height = Math.min(box.height, maxHeight);
      setPosition({
        left: Math.max(margin, Math.min(anchor.right - box.width, window.innerWidth - box.width - margin)),
        top: Math.max(margin, useAbove ? anchor.top - height - 12 : anchor.bottom + 12),
        maxHeight,
      });
    }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) dismiss();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
    }
    const frame = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, available]);

  function snooze() {
    try { const saved = writeMiniMiPreference(window.localStorage, { ...preference, snoozedUntil: Date.now()+3600000 }); setPreferenceError(!saved); if (saved) dismiss(); }
    catch { setPreferenceError(true); }
  }
  if (!available) return null;
  const size = preference.size === "small" ? 48 : preference.size === "large" ? 80 : 64;
  const latest = activities[0];
  const statusText = focus && now >= focus.endsAt ? "Focus timer complete. Open Mini Mi for your next step." : pending ? "Mi is preparing a response. Open activity for the workspace." : latest ? `${latest.label}: ${MI_ACTIVITY_LABELS[latest.state]}` : "";

  return <>
    <span id={`${id}-status`} role="status" className="sr-only">{statusText}</span>
    <ChatLauncherDock onDragStart={() => dismiss()}>
      <button ref={button} type="button" aria-label="Mini Mi suggestions" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => { playReaction(); if (open) dismiss(); else setOpen(true); }}
        aria-describedby={`${id}-status`} style={{ width: size, height: size + 12, boxShadow: "none" }}
        className="mi-helper-launcher group relative flex flex-col items-center justify-center border-0 bg-transparent text-accent shadow-none outline-none hover:bg-transparent focus-visible:outline-none active:bg-transparent">
        <MiAvatar key={reaction?.serial ?? 0} character={character} activity={displayedActivity} animated={animated} className="h-full w-[87.5%]" />
        <span className="pb-1 text-[9px] font-medium tracking-widest text-foreground group-focus-visible:underline group-focus-visible:decoration-2 group-focus-visible:underline-offset-4">MI</span>
        {pending && <span aria-label="Mi is responding" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />}
        {focus && now >= focus.endsAt && <span aria-hidden="true" className="absolute right-0 top-0 text-xs">✓</span>}
      </button>
    </ChatLauncherDock>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Mini Mi suggestions"
      className="mi-helper-panel fixed z-[60] w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border bg-card text-foreground shadow-[var(--shadow-sm)]"
      style={position ? { left: position.left, top: position.top, maxHeight: position.maxHeight } : { visibility: "hidden", left: 16, top: 16 }}>
      <div className="flex items-start gap-3 border-b border-border px-4 py-4">
        <MiAvatar key={reaction?.serial ?? 0} character={character} activity={reaction || pending ? displayedActivity : "idle"} animated={animated} className="h-14 w-12 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[10px] font-medium uppercase tracking-[.16em] text-accent">Mini Mi · {guidance.context}</p>
          <h2 className="mt-1 font-display text-lg">What would help next?</h2>
        </div>
        <button ref={closeButton} type="button" aria-label="Close Mi suggestions" onClick={() => dismiss(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
      </div>
      {contextReady && !terminalContext?.error && <div className="flex gap-2 border-b border-border p-3">
        {guidance.chatHref || !onChat
          ? <Link href={guidance.chatHref ?? "/"} onClick={() => dismiss()} className="flex-1 rounded-lg bg-accent px-3 py-2.5 text-center text-xs font-medium text-accent-foreground">{guidance.chatLabel ?? "Talk to Mi"}</Link>
          : <button type="button" onClick={() => { dismiss(); onChat(); }} className="flex-1 rounded-lg bg-accent px-3 py-2.5 text-xs font-medium text-accent-foreground">{pending ? "Return to Mi’s response" : "Talk to Mi"}</button>}
        {codingHref && <Link href={codingHref} onClick={() => dismiss()} className="flex-1 rounded-lg border border-border px-3 py-2.5 text-center text-xs font-medium">Open coding terminal</Link>}
      </div>}
      {activities.length > 0 && <section className="border-b border-border p-4" aria-label="Mi activity">
        <h3 className="text-xs font-medium">Activity</h3>
        <ul className="mt-2 space-y-2">{activities.slice(0,3).map(item => <li key={item.id} className="text-xs"><Link href={item.href} onClick={() => dismiss()} className="text-link">{item.label}</Link><p className="mt-1 text-muted-foreground">{item.state === "running" && now - item.updatedAt >= 1800000 ? "Status may be stale. Open the conversation to check." : MI_ACTIVITY_LABELS[item.state]}</p></li>)}</ul>
      </section>}
      {contextReady && !terminalContext?.error && <MiniMiSuggestions pathname={resolvedPath} onNavigate={() => dismiss()} />}
      {!contextReady ? <p role="status" className="p-4 text-sm text-muted-foreground">Checking the current project…</p>
        : terminalContext?.error ? <p role="alert" className="p-4 text-sm text-muted-foreground">{terminalContext.error}</p>
        : <ol className="space-y-1 p-2">
        {guidance.items.map((item, index) => <li key={item.href}>
          <Link href={item.href} onClick={event => {
            // Settings selects its panels through hashchange. App Router's same-page
            // hash navigation uses pushState, which does not emit that native event.
            if (item.href.startsWith(`${pathname}#`)) {
              event.preventDefault();
              window.location.hash = item.href.slice(pathname.length + 1);
            }
            dismiss();
          }} className="group flex gap-3 rounded-xl px-3 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent">
            <span aria-hidden="true" className="pt-0.5 font-mono text-[10px] text-accent">0{index + 1}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.detail}</span></span>
            <span aria-hidden="true" className="text-muted-foreground group-hover:text-accent">↗</span>
          </Link>
        </li>)}
      </ol>}
      <div className="border-t border-border p-4">
        <details className="mb-3"><summary className="cursor-pointer text-xs font-medium">Focus timer</summary><div className="mt-3"><MiniMiFocus /></div></details>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Suggestions for this page. You choose what happens next.</p>
        <div className="mt-3 flex justify-between gap-2 text-xs"><button type="button" onClick={snooze}>Snooze Mini Mi for 1 hour</button><Link onClick={() => dismiss()} href="/settings#appearance">Companion settings</Link></div>
        {preferenceError && <p role="alert" className="mt-2 text-xs">The snooze preference could not be saved.</p>}
      </div>
    </div>, document.body)}
  </>;
}
