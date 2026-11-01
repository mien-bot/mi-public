"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { workspaceDisplayName } from "@/components/workspacePanes";
import type { CadApplication, CadLessons, CadReview, CadStatus } from "@/types/electron";

const COPY = {
  revit: {
    label: "Revit", noun: "model", product: "Revit 2026", install: "Install / repair Revit add-in",
    needs: "Mi needs Revit 2026.5. Other Revit versions are not supported yet.",
    available: "Agents can read the model, and propose straight walls, text and integer parameter edits, move, copy, guarded deletion, and type duplication. Nothing saves or syncs.",
  },
  autocad: {
    label: "AutoCAD", noun: "drawing", product: "AutoCAD 2027", install: "Install / repair AutoCAD add-in",
    needs: "Mi needs full AutoCAD 2027. AutoCAD LT and older releases are not supported.",
    available: "Agents can read drawings, and propose layers, lines, polylines, circles, arcs, text, and leaders, plus move, copy, erase, and change layer. Nothing saves, and one U reverses an edit.",
  },
} as const;
const POLL_MS = 4000;

const hasOpenDocument = (status: CadStatus) => status.sessions.some(session => session.documents.length > 0);
const connected = (status: CadStatus) => status.health === "Connected";
/** The open file that a lapsed connection used to point at, matched by name for a person to confirm. */
function reconnectTarget(status: CadStatus) {
  if (!status.binding || (connected(status) && status.reviewsInMi)) return null;
  for (const session of status.sessions) {
    const document = session.documents.find(item => item.title === status.binding!.title);
    if (document) return { session: session.session, document };
  }
  return null;
}

const addinReady = (status: CadStatus) => status.addin === "installed" || status.addin === "optional-update";
/** The one thing to do next, for the collapsed summary and the current step. */
function nextStep(status: CadStatus) {
  if (connected(status)) return 4;
  if (!addinReady(status)) return 1;
  return hasOpenDocument(status) ? 3 : 2;
}
function headline(status: CadStatus) {
  const { label, noun } = COPY[status.application];
  if (connected(status)) return `${label} connected · ${status.binding?.title ?? ""}`;
  if (status.binding) return `${label}: reconnect the ${noun}`;
  if (!status.applicationInstalled) return `${label}: ${COPY[status.application].product} not found on this computer`;
  return `${label}: not connected · next, ${["install the add-in", `open a ${noun}`, `connect the ${noun}`][nextStep(status) - 1]}`;
}

function Step({ number, title, current, done, children }: { number: number; title: string; current: boolean; done: boolean; children?: ReactNode }) {
  return <li aria-current={current ? "step" : undefined} className={`flex gap-2 rounded-md border p-2 ${current ? "border-accent bg-accent/5" : "border-border"}`}>
    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${done ? "border-accent bg-accent text-background" : current ? "border-accent" : "border-border text-muted-foreground"}`}>{done ? "✓" : number}</span>
    <div className="min-w-0 flex-1 space-y-1.5">
      <p className={current || done ? "font-medium" : "text-muted-foreground"}>{title}{done ? <span className="sr-only"> (done)</span> : null}</p>
      {children}
    </div>
  </li>;
}

/**
 * Approves a CAD edit from Mi's own window. It deliberately takes no keyboard focus and has no
 * shortcut: keystrokes belong to the shell, where the agent runs, so nothing typed can answer it.
 */
function CadReviewBar({ workspace }: { workspace: string }) {
  const [reviews, setReviews] = useState<CadReview[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    const api = window.electronAPI?.cad;
    if (!api) return;
    const add = (review: CadReview) => {
      if (review.workspace !== workspace) return;
      setNow(Date.now());
      setReviews(current => current.some(item => item.id === review.id) ? current : [...current, review]);
      void api.reviewShown(review.id);
    };
    const stopReview = api.onReview(add);
    const stopClosed = api.onReviewClosed(id => { setReviews(current => current.filter(item => item.id !== id)); setAnswering(false); });
    void api.reviews().then(list => list.forEach(add)).catch(() => {});
    return () => { stopReview(); stopClosed(); };
  }, [workspace]);
  const review = reviews[0];
  useEffect(() => {
    if (!review) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [review]);
  if (!review) return null;
  const { label } = COPY[review.application];
  const seconds = Math.max(0, Math.ceil((review.expiresAt - now) / 1000));
  const answer = (approved: boolean) => { setAnswering(true); void window.electronAPI!.cad.answerReview(review.id, approved).catch(() => setAnswering(false)); };
  return <section role="alertdialog" aria-label={`Review ${label} edit`} className="shrink-0 border-b-2 border-accent bg-background px-3 py-2 text-xs">
    <p className="font-medium text-foreground">Apply this edit to {review.title}?{reviews.length > 1 ? ` · ${reviews.length - 1} more waiting` : ""}</p>
    <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-sans text-foreground">{review.summary}</pre>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" disabled={answering} onClick={() => answer(true)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:opacity-90 disabled:opacity-50">Apply edit</button>
      <button type="button" disabled={answering} onClick={() => answer(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50">Decline</button>
      <span className="text-muted-foreground">Declines itself in {seconds}s. The file is not saved.</span>
    </div>
  </section>;
}

/** Names the project and exact files its MCP pairing reaches, so one window cannot pass for another project's. */
export function CadPairingBanner({ workspace, session, onAgent }: { workspace: string; session: string; onAgent?: (agent: boolean) => void }) {
  const [paired, setPaired] = useState<CadStatus[]>([]);
  const [agent, setAgent] = useState(false);
  const [notice, setNotice] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  async function reconnect(result: CadStatus, target: NonNullable<ReturnType<typeof reconnectTarget>>) {
    const { label, noun } = COPY[result.application];
    setReconnecting(true); setNotice(`Switch to ${label} and choose Yes to reconnect this ${noun}.`);
    try {
      const next = await window.electronAPI!.cad.bind(workspace, result.application, target.session, target.document.id);
      setPaired(current => current.map(item => item.application === next.application ? next : item));
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setReconnecting(false); }
  }
  useEffect(() => {
    const api = window.electronAPI?.cad;
    if (!api) return;
    let live = true;
    async function refresh() {
      try {
        const results = await Promise.all((["revit", "autocad"] as const).map(application => api!.status(workspace, application)));
        const isAgent = await api!.isAgentSession(workspace, session);
        if (live) { setPaired(results.filter(result => result.binding)); setAgent(isAgent); onAgent?.(isAgent); }
      } catch { /* The setup panel reports connection errors. */ }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [workspace, session, onAgent]);
  return <>
    <CadReviewBar workspace={workspace} />
    {paired.length > 0 && <div role="status" aria-label="MCP connection" className="shrink-0 border-b border-accent/40 bg-accent/10 px-3 py-1.5 text-xs">
      <p className="font-medium capitalize text-foreground">{agent ? "CAD agent" : "MCP paired"} · {workspaceDisplayName(workspace)}</p>
      {paired.map(result => {
        const { label } = COPY[result.application];
        const target = reconnectTarget(result);
        const state = !connected(result) ? "Reconnect required" : result.reviewsInMi ? "Connected" : `Connected · edits are reviewed in ${label} until you reconnect`;
        return <div key={result.application} className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-muted-foreground">{label}: {result.binding!.title} · {state}</p>
          {target && <button type="button" disabled={reconnecting} onClick={() => void reconnect(result, target)} className="rounded-md border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50">Reconnect</button>}
        </div>;
      })}
      {notice && <p role="status" className="text-foreground">{notice}</p>}
    </div>}
  </>;
}

/** What CAD agents have learned. Agents only propose; a lesson reaches them after a person accepts it here. */
function CadLessonsPanel({ button }: { button: string }) {
  const [lessons, setLessons] = useState<CadLessons | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void window.electronAPI?.cad.lessons().then(setLessons).catch(() => {}); }, []);
  const api = window.electronAPI?.cad;
  if (!api || !lessons) return null;
  async function change(action: () => Promise<CadLessons>) {
    setError("");
    try { setLessons(await action()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <details className="rounded-md border border-border p-3">
    <summary className="cursor-pointer">Improve the MCP{lessons.pending.length ? ` · ${lessons.pending.length} waiting for review` : ""}</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">Lessons you accept are given to every new CAD agent. Agents can propose lessons, but only you can accept them.</p>
      {lessons.pending.map(lesson => <div key={lesson.id} className="rounded-md border border-accent/40 p-2">
        <p className="break-words">{lesson.text}</p>
        <div className="mt-1 flex gap-2">
          <button type="button" className={button} onClick={() => void change(() => api.reviewLesson(lesson.id, true))}>Accept</button>
          <button type="button" className={button} onClick={() => void change(() => api.reviewLesson(lesson.id, false))}>Dismiss</button>
        </div>
      </div>)}
      {lessons.accepted.map(lesson => <div key={lesson.id} className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words">{lesson.text}</p>
        <button type="button" className={button} onClick={() => void change(() => api.removeLesson(lesson.id))}>Remove</button>
      </div>)}
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void change(() => api.addLesson(draft)).then(() => setDraft("")); }}>
        <input aria-label="New lesson" value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} placeholder="Add a drawing rule, such as a text height or layer standard" className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5" />
        <button type="submit" className={button} disabled={!draft.trim()}>Add</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

export function CadConnections({ workspace }: { workspace: string }) {
  const [open, setOpen] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const [application, setApplication] = useState<CadApplication>("revit");
  const [statuses, setStatuses] = useState<Partial<Record<CadApplication, CadStatus>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const chosen = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- native pane controls must wait for hydration
    setHydrated(true);
  }, []);
  const button = "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";
  const primary = "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50";
  // Same active treatment as the terminal session tabs, so "open" and "selected" read alike.
  const activeTab = "aria-pressed:border-accent/60 aria-pressed:bg-accent/15 aria-pressed:font-medium aria-pressed:text-foreground";
  const panelId = useId();
  const status = statuses[application] ?? null;
  const copy = COPY[application];
  const remember = (next: CadStatus) => setStatuses(current => ({ ...current, [next.application]: next }));
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function refresh(target: CadApplication = application) {
    const api = window.electronAPI?.cad;
    if (!api) { setMessage("CAD connections require the Mi desktop app on Windows."); return; }
    remember(await api.status(workspace, target));
  }
  /** Opens on whichever application this person actually has in play, rather than always Revit. */
  async function refreshBoth() {
    const api = window.electronAPI?.cad;
    if (!api) { setMessage("CAD connections require the Mi desktop app on Windows."); return; }
    const results = await Promise.all((["revit", "autocad"] as const).map(option => api.status(workspace, option)));
    results.forEach(remember);
    if (chosen.current) return;
    const best = results.find(result => result.binding) ?? results.find(result => result.applicationRunning) ?? results.find(result => result.applicationInstalled);
    if (best) setApplication(best.application);
  }
  useEffect(() => {
    if (!hydrated || !window.electronAPI?.cad) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads desktop state after hydration
    void refreshBoth().catch(() => {}); // Fills the one-line summary before the panel is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per project
  }, [hydrated, workspace]);
  // Watches for AutoCAD opening or a drawing appearing, so no step needs a manual refresh.
  useEffect(() => {
    const api = window.electronAPI?.cad;
    if (!open || busy || !api) return;
    let waiting = false;
    const timer = window.setInterval(() => {
      if (waiting || document.hidden) return;
      waiting = true;
      void api.status(workspace, application).then(remember).catch(() => {}).finally(() => { waiting = false; });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, busy, workspace, application]);

  async function startClaude() {
    const { session, existing } = await window.electronAPI!.cad.startAgent(workspace, "claude");
    setMessage(existing ? `Claude is already running in session ${session}.` : `Claude started in session ${session}.`);
    setOpen(false); // Setup is done, so the terminal gets the room back.
  }
  const step = status ? nextStep(status) : 0;
  const ready = status ? addinReady(status) : false;
  // Once the add-in is in, only the next step shows: setup shouldn't read as a chore to repeat.
  const showStep = (number: number) => allSteps || !ready || number === step || (number === 4 && Boolean(status?.binding));
  const install = status && <button className={ready ? button : primary} disabled={busy || !status.payloadAvailable || !status.applicationInstalled || status.applicationRunning}
    onClick={() => void run(async () => { setMessage((await window.electronAPI!.cad.install(application, "install")).message); await refresh(); })}>{copy.install}</button>;
  return <section className="shrink-0 border-b border-border bg-background p-2" aria-label="CAD connections" data-cad-hydrated={hydrated}>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`${button} ${activeTab.replaceAll("aria-pressed:", "aria-expanded:")}`} disabled={!hydrated} aria-expanded={open} aria-controls={panelId} onClick={() => { const next = !open; setOpen(next); if (next) void run(refreshBoth); }}>
        Set up MCP <span aria-hidden="true" className="ml-1 inline-block transition-transform">{open ? "▴" : "▾"}</span>
      </button>
      {status && <span className="text-xs text-muted-foreground">{headline(status)}</span>}
    </div>
    {!open && message && <p role="status" className="mt-2 whitespace-pre-wrap text-xs">{message}</p>}
    {open && <div id={panelId} className="mt-3 max-h-[min(20rem,32dvh)] space-y-3 overflow-y-auto text-xs">
      <div role="group" aria-label="CAD application" className="flex gap-1">
        {(["revit", "autocad"] as const).map(option => <button key={option} type="button" className={`${button} ${activeTab}`} aria-pressed={application === option} disabled={busy}
          onClick={() => { chosen.current = true; setApplication(option); setMessage(""); void run(() => refresh(option)); }}>{COPY[option].label}</button>)}
      </div>
      {status && ready && <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>{copy.label} add-in installed. You don’t need to install it again.{status.addin === "optional-update" ? " A newer build is available under More options, if you want it." : ""}</span>
        <button type="button" className="text-link underline" onClick={() => setAllSteps(current => !current)}>{allSteps ? "Show only the next step" : "Set up step by step"}</button>
      </p>}
      {status && <ol aria-label={`Connect ${copy.label}`} className="space-y-2">
        {showStep(1) && <Step number={1} title="Install the Mi add-in (one time)" current={step === 1} done={ready}>
          <p className={ready ? "text-muted-foreground" : undefined}>{copy.label} add-in: {ready ? "installed" : status.addin === "outdated" ? "this version of Mi needs a newer add-in" : "not installed"}</p>
          {step === 1 && (!status.applicationInstalled
            ? <p role="status">{copy.product} was not found on this computer. {copy.needs}</p>
            : !status.payloadAvailable
              ? <p role="status">This copy of Mi does not include the add-in. Install a full Mi release.</p>
              : <>
                {status.applicationRunning && <p role="status">Close {copy.label} first. The install button turns on when it has closed.</p>}
                {install}
              </>)}
        </Step>}
        {showStep(2) && <Step number={2} title={`Open ${copy.label} with your ${copy.noun}`} current={step === 2} done={step > 2}>
          {step === 2 && (status.applicationRunning && !status.sessions.length
            ? <p role="status">{copy.label} is open but has not loaded Mi. Close and reopen it. If {copy.label} asks about Mi, choose Always Load.</p>
            : status.sessions.length
              ? <p>{status.sessions.find(session => session.error)?.error ?? `Open or create a ${copy.noun} in ${copy.label}.`}</p>
              : <p>Waiting for {copy.label}. Mi notices when it opens.</p>)}
        </Step>}
        {showStep(3) && <Step number={3} title={`Connect the ${copy.noun} to this project`} current={step === 3} done={step > 3}>
          {status.binding && !connected(status) && <p role="status">The connection to {status.binding.title} ended. This happens when {copy.label} restarts, or the {copy.noun} closes or is renamed. Connect it again.</p>}
          {step === 3 && status.sessions.flatMap(session => session.documents.map(document => <div key={document.id} className="rounded-md border border-border p-2">
            <p className="font-medium">{document.title}{document.isReadOnly ? " · read-only" : ""}</p>
            <p className="break-all text-muted-foreground">{document.path || `Not saved yet`}</p>
            <button className={`${primary} mt-1`} disabled={busy} onClick={() => void run(async () => {
              setMessage(`Switch to ${copy.label} and choose Yes in the dialog there. This is needed once per ${copy.noun}.`);
              remember(await window.electronAPI!.cad.bind(workspace, application, session.session, document.id));
              setMessage(`${document.title} is connected. Starting Claude…`);
              // Connecting is the whole setup: the agent is what the person came for.
              try { await startClaude(); } catch (error) { setMessage(`${document.title} is connected. ${error instanceof Error ? error.message : String(error)}`); }
            })}>Connect this {copy.noun}</button>
          </div>))}
          {step === 3 && <p className="text-muted-foreground">{copy.label} asks you to confirm once for each {copy.noun}, then Claude opens here in a terminal window, ready to work.</p>}
        </Step>}
        {showStep(4) && <Step number={4} title="Start an agent" current={step === 4} done={false}>
          {status.binding && !connected(status) && <p role="status">The {copy.noun} isn’t connected right now, so an agent started here can’t reach it. Reconnect first.</p>}
          {status.binding && <>
            <p>{status.reviewsInMi ? `Claude opens in its own window with only Mi's CAD tools. Each edit appears at the top of that window for you to apply or decline.` : `Claude opens in its own window with only Mi's CAD tools. Mi restarted since this ${copy.noun} was connected, so edits are reviewed in ${copy.label}. Disconnect and connect again to review them in Mi.`}</p>
            <button className={connected(status) ? primary : button} disabled={busy} onClick={() => void run(startClaude)}>Start Claude</button>
          </>}
        </Step>}
      </ol>}
      {busy && <p role="status">Working…</p>}
      {message && <p role="status" className="whitespace-pre-wrap">{message}</p>}
      {status && <>
        <details data-cad-more className="rounded-md border border-border p-3">
          <summary className="cursor-pointer">More options</summary>
          <div className="mt-2 space-y-3">
            <p className="text-muted-foreground">{copy.available} {copy.needs}</p>
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={busy} onClick={() => void run(refresh)}>Refresh connections</button>
              {status.addin !== "missing" && step !== 1 && install}
              <button className={button} disabled={busy} onClick={() => void run(async () => { setMessage((await window.electronAPI!.cad.install(application, "uninstall")).message); await refresh(); })}>Remove add-in</button>
              {status.binding && <button className={button} disabled={busy} onClick={() => void run(async () => {
                const result = await window.electronAPI!.cad.disconnect(workspace, application); await refresh(); setMessage(result.message);
              })}>Disconnect project</button>}
            </div>
            <div className="space-y-2">
              <p>To use another agent, or keep your other MCP servers, copy a command and paste it into this project&apos;s terminal. Restart any agent that was already running.</p>
              {(["codex", "claude"] as const).map(engine => {
                const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${status.launcher}" -Engine ${engine}`;
                return <div key={engine} className="flex flex-wrap items-start gap-2">
                  <button className={button} onClick={() => void run(async () => { await navigator.clipboard.writeText(command); setMessage(`${engine} launch command copied.`); })}>Copy {engine}</button>
                  <details className="min-w-0 flex-1"><summary className="cursor-pointer py-1.5 text-muted-foreground">Show command</summary><code className="block break-all">{command}</code></details>
                </div>;
              })}
            </div>
          </div>
        </details>
        <CadLessonsPanel button={button} />
      </>}
    </div>}
  </section>;
}
