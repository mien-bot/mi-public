"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { workspaceDisplayName } from "@/components/workspacePanes";
import type { CadApplication, CadEngine, CadLessons, CadReview, CadStatus } from "@/types/electron";

const COPY = {
  revit: {
    label: "Revit", noun: "model", product: "Revit 2026", install: "Install / repair Revit add-in",
    needs: "Mi needs Revit 2026.5. Other Revit versions are not supported yet.",
    available: "Agents can read the model, and propose straight walls, text and integer parameter edits, move, copy, guarded deletion, and type duplication. Nothing saves or syncs.",
  },
  autocad: {
    label: "AutoCAD", noun: "drawing", product: "AutoCAD 2024 or 2027", install: "Install / repair AutoCAD add-in",
    needs: "Mi needs full AutoCAD 2024 or 2027. AutoCAD LT, vertical toolsets such as AutoCAD Architecture, and other releases are not supported.",
    available: "Agents can read drawings and tables, and propose layers, lines, polylines, circles, arcs, text, leaders, tables, charts, hatches, dimensions, and block inserts; edit text, table cells, and attributes; and move, copy, rotate, scale, mirror, recolor, erase, or change layer. Nothing saves, and one U reverses an edit.",
  },
} as const;
const POLL_MS = 4000;

const hasOpenDocument = (status: CadStatus) => status.sessions.some(session => session.documents.length > 0);
// Busy is a live connection whose application is waiting on a dialog or command, not a lost one.
const connected = (status: CadStatus) => status.health === "Connected" || status.health === "Busy";
const busyText = (status: CadStatus) => `${COPY[status.application].label} is waiting on a dialog or command`;

const ENGINE_LABEL: Record<CadEngine, string> = { claude: "Claude", codex: "Codex" };
const ENGINE_KEY = "mi:cad-engine";
/**
 * The agent Start launches: the last one this person chose, among those installed. Codex is offered
 * only when Mi finds it. The choice is a per-viewer convenience, so storage failures are ignored.
 */
function useCadEngine() {
  const [engine, setEngine] = useState<CadEngine>("claude");
  const [available, setAvailable] = useState<CadEngine[]>(["claude"]);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(ENGINE_KEY); } catch { /* Claude stays the default. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice exists only after hydration
    if (saved === "codex" || saved === "claude") setEngine(saved);
    let live = true;
    void window.electronAPI?.agent?.availability().then(found => {
      if (!live) return;
      const engines = (["claude", "codex"] as const).filter(name => found[name]?.available);
      setAvailable(engines.length ? engines : ["claude"]);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const choose = (next: CadEngine) => {
    setEngine(next);
    try { window.localStorage.setItem(ENGINE_KEY, next); } catch { /* Kept for this view. */ }
  };
  return { engine: available.includes(engine) ? engine : available[0], available, choose };
}

function EnginePicker({ engine, available, choose, disabled }: { engine: CadEngine; available: CadEngine[]; choose: (next: CadEngine) => void; disabled?: boolean }) {
  if (available.length < 2) return null;
  return <span role="group" aria-label="Agent" className="inline-flex overflow-hidden rounded-md border border-border">
    {available.map(name => <button key={name} type="button" aria-pressed={engine === name} disabled={disabled} onClick={() => choose(name)}
      className="px-2 py-1 text-xs aria-pressed:bg-accent/15 aria-pressed:font-medium aria-pressed:text-foreground text-muted-foreground hover:bg-muted disabled:opacity-50">{ENGINE_LABEL[name]}</button>)}
  </span>;
}
/** The open file that a lapsed connection used to point at, matched by name for a person to confirm. */
function reconnectTarget(status: CadStatus) {
  if (!status.binding || (connected(status) && status.reviewsInMi)) return null;
  for (const session of status.sessions) {
    const document = session.documents.find(item => item.title === status.binding!.title);
    if (document) return { session: session.session, document };
  }
  return null;
}

/** Open files this project could switch to, the one active in the application first. */
function switchTargets(status: CadStatus) {
  const targets = status.sessions.flatMap(session => session.documents
    .filter(document => !(status.binding?.session === session.session && status.binding.document === document.id))
    .map(document => ({ session: session.session, year: session.year ?? null, document })));
  return targets.sort((a, b) => Number(Boolean(b.document.isActive)) - Number(Boolean(a.document.isActive)));
}

const addinReady = (status: CadStatus) => status.addin === "installed" || status.addin === "optional-update";
/** The one thing to do next, for the collapsed summary and the current step. */
function nextStep(status: CadStatus) {
  if (connected(status)) return 4;
  if (!addinReady(status)) return 1;
  return hasOpenDocument(status) ? 3 : 2;
}
/** "AutoCAD 2024" when the release is known, so two open releases are never confused. */
const releaseLabel = (status: CadStatus, year?: string | null) => year ? `${COPY[status.application].label} ${year}` : COPY[status.application].label;
function headline(status: CadStatus) {
  const { label, noun } = COPY[status.application];
  if (status.health === "Busy") return `${releaseLabel(status, status.binding?.year)} connected · ${status.binding?.title ?? ""} · ${busyText(status)}`;
  if (connected(status)) return `${releaseLabel(status, status.binding?.year)} connected · ${status.binding?.title ?? ""}`;
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
  // An agent asking to read more drawings, or to open one, rather than to change one.
  const connect = review.kind === "connect";
  const opening = review.kind === "open";
  const asker = review.session ? `Session ${review.session} · ` : "";
  const question = opening ? `Open ${review.title} in ${label} for the agent?` : connect ? `Let the agent read ${review.title}?` : `Apply this edit to ${review.title}?`;
  return <section role="alertdialog" aria-label={opening ? `Open ${label} drawing` : connect ? `Connect ${label} drawings` : `Review ${label} edit`} className="shrink-0 border-b-2 border-accent bg-background px-3 py-2 text-xs">
    <p className="font-medium text-foreground">{asker}{question}{reviews.length > 1 ? ` · ${reviews.length - 1} more waiting` : ""}</p>
    <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-sans text-foreground">{review.summary}</pre>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" disabled={answering} onClick={() => answer(true)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-background hover:opacity-90 disabled:opacity-50">{opening ? "Open and connect" : connect ? "Connect" : "Apply edit"}</button>
      <button type="button" disabled={answering} onClick={() => answer(false)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50">Decline</button>
      <span className="text-muted-foreground">Declines itself in {seconds}s.{connect || opening ? "" : " The file is not saved."}</span>
    </div>
  </section>;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Starts the agent for a drawing, or shows the one already working in it. With onStarted (the
 * project terminal), it runs in a free session there; otherwise it gets a window of its own.
 */
async function launchAgent(workspace: string, engine: CadEngine, item: { document?: string; title?: string }, onStarted?: (session: string) => void) {
  const { session, existing, place } = await window.electronAPI!.cad.startAgent(workspace, engine, item.document, onStarted ? "terminal" : "window");
  if (place === "terminal") onStarted?.(session);
  const name = ENGINE_LABEL[engine];
  const where = place === "terminal" ? `Session ${session} below` : `its window (session ${session})`;
  if (existing) return `An agent is already working${item.title ? ` in ${item.title}` : ""}, in ${where}.`;
  return `${name} started${item.title ? ` for ${item.title}` : ""} in ${where}.`;
}

/**
 * Every file this project can reach. An AutoCAD project keeps several drawings connected: an agent
 * reads any of them by name and works in its current one by default. Open files can be connected
 * here, which makes them current. Revit holds one model per project, so connecting replaces it.
 * In a CAD agent window (agentSession), connecting or choosing a drawing changes that window only,
 * so several agents can each work in their own drawing. Elsewhere, each drawing can start an agent
 * of its own, and several open drawings can be connected in one step.
 */
function CadDrawingList({ workspace, status, button, onStatus, onNotice, agentSession, launch }: { workspace: string; status: CadStatus; button: string; onStatus: (next: CadStatus) => void; onNotice: (text: string) => void; agentSession?: string;
  /** Starts or shows the agent for one drawing and returns what to tell the person; without it, no Start button shows. */
  launch?: (item: { document: string; title: string }) => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const { label, noun } = COPY[status.application];
  const api = window.electronAPI?.cad;
  if (!api) return null;
  const binding = status.binding;
  const attached = binding?.drawings ?? [];
  const isAttached = (session: string, id: string) => attached.some(item => item.session === session && item.document === id);
  const openFiles = switchTargets(status).filter(target => !isAttached(target.session, target.document.id));
  // An add-in from before multi-drawing support replaces the project's drawing in its session.
  const single = status.application === "autocad" && status.sessions.some(session => session.documents.length > 0 && !(session.features ?? []).includes("multi-drawing"));
  const many = status.application === "autocad" && !single;
  async function act(start: string, action: () => Promise<CadStatus>, done: (next: CadStatus) => string) {
    setBusy(true); onNotice(start);
    try { const next = await action(); onStatus(next); onNotice(done(next)); }
    catch (error) { onNotice(errorText(error)); }
    finally { setBusy(false); }
  }
  const windowOnly = Boolean(agentSession) && many;
  const connect = (target: { session: string; document: { id: string; title: string } }) => act(`Switch to ${label} and choose Yes to connect ${target.document.title}.`,
    () => api.bind(workspace, status.application, target.session, target.document.id, agentSession),
    next => windowOnly
      ? `${target.document.title} is connected and current in this window. Other agent windows keep their own ${noun}s. Tell the agent to continue.`
      : many && (next.binding?.drawings?.length ?? 0) > 1
        ? `${target.document.title} is connected.${launch ? " Press Start agent next to it for an agent of its own, or" : ""} Ask a running agent to read it by name.`
        : `${target.document.title} is connected. Tell the agent to continue; it uses this ${noun} from now on.`);
  /** Several drawings in one step: AutoCAD asks once per window, and Mi reports each drawing's outcome. */
  const connectAll = (targets: { session: string; document: { id: string; title: string } }[], verb: string) => {
    let outcome = "";
    return act(`Switch to ${label} and choose Yes if it asks. It asks once for each ${label} window.`, async () => {
      const { results, status: next } = await api.attach(workspace, targets.map(target => ({ session: target.session, document: target.document.id })), agentSession);
      const done = results.filter(item => item.connected).map(item => item.drawing);
      const failed = results.filter(item => !item.connected).map(item => `${item.drawing}: ${item.error ?? "not connected"}`);
      outcome = [done.length ? `${verb}: ${done.join(", ")}.` : "", ...failed].filter(Boolean).join("\n");
      return next;
    }, () => outcome);
  };
  const startAgent = (item: { document: string; title: string }) => {
    let started = "";
    return act("", async () => { started = await launch!(item); return api.status(workspace, status.application); }, () => started);
  };
  const year = (value?: string | null) => value ? `${releaseLabel(status, value)} · ` : "";
  // Closed drawings whose file is open again under a new identity, matched by name for the person to confirm.
  const reopenedFiles = attached.flatMap(item => {
    const match = !item.open ? openFiles.find(target => target.document.title === item.title) : undefined;
    return match ? [match] : [];
  });
  return <div role="group" aria-label={`${label} ${noun}s`} className="space-y-1">
    {attached.length > 1 && <>
      <p className="text-muted-foreground">{agentSession
        ? "Connected to this project. This window edits its current drawing unless the agent names another; other agent windows keep their own."
        : "Connected to this project. Each can have its own agent, and any agent can read the others by name."}</p>
      {attached.map(item => {
        const current = item.document === binding?.document;
        const reopened = !item.open ? openFiles.find(target => target.document.title === item.title) : undefined;
        return <div key={`${item.session}:${item.document}`} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-foreground">{year(item.year)}{item.title}{current ? " · current" : ""}{item.open ? "" : " · closed"}</span>
          {!current && item.open && <button type="button" className={button} disabled={busy} aria-label={`Make ${item.title} current`}
            onClick={() => void act("", () => api.select(workspace, status.application, item.document, agentSession),
              () => agentSession ? `${item.title} is now current in this window. Other agent windows keep their own drawings.` : `${item.title} is now the project's default drawing. Agents already running keep theirs.`)}>Make current</button>}
          {!agentSession && launch && item.open && <button type="button" className={button} disabled={busy} aria-label={`Start an agent for ${item.title}`} onClick={() => void startAgent(item)}>Start agent</button>}
          {reopened && <button type="button" className={button} disabled={busy} aria-label={`Reconnect ${item.title}`} onClick={() => void connect(reopened)}>Reconnect</button>}
          <button type="button" className={button} disabled={busy} aria-label={`Disconnect ${item.title}`}
            onClick={() => void act("", () => api.forget(workspace, status.application, item.document, agentSession), next => `${item.title} is disconnected.${next.binding ? "" : ` No ${noun} is connected to this project now.`}`)}>Disconnect</button>
        </div>;
      })}
    </>}
    {many && reopenedFiles.length > 1 && <button type="button" className={button} disabled={busy} onClick={() => void connectAll(reopenedFiles, "Reconnected")}>Reconnect all {reopenedFiles.length}</button>}
    {openFiles.length > 0 && <p className="text-muted-foreground">{windowOnly ? `Open in ${label}. Connecting one makes it current in this window only.` : many ? `Open in ${label}. Connecting one keeps the others connected.` : `Open in ${label}. Connecting one replaces the current ${noun}.`}</p>}
    {openFiles.map(target => <div key={`${target.session}:${target.document.id}`} className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={busy} aria-label={`Connect ${target.document.title}`} onClick={() => void connect(target)}>Connect</button>
      <span className="min-w-0 truncate text-foreground">{year(target.year)}{target.document.title}{target.document.isActive ? " · active" : ""}{target.document.isReadOnly ? " · read-only" : ""}</span>
    </div>)}
    {many && binding && openFiles.length > 1 && <button type="button" className={button} disabled={busy} onClick={() => void connectAll(openFiles, "Connected")}>Connect all {openFiles.length} open</button>}
    {!openFiles.length && <p className="text-muted-foreground">No other {noun} is open in {label}. Open it there and it appears here within a few seconds.</p>}
    {single && <p className="text-muted-foreground">This {label} add-in connects one drawing per project at a time. To keep several connected, close {label} and install the update under Set up MCP → More options.</p>}
  </div>;
}

/** Names the project and exact files its MCP pairing reaches, so one window cannot pass for another project's. */
export function CadPairingBanner({ workspace, session, onAgent, onAgentStarted }: { workspace: string; session: string; onAgent?: (agent: boolean) => void;
  /** Given by the project terminal: agents then start in one of its sessions, which it shows. */
  onAgentStarted?: (session: string) => void }) {
  const cadEngine = useCadEngine();
  const [paired, setPaired] = useState<CadStatus[]>([]);
  const [agent, setAgent] = useState(false);
  const [notice, setNotice] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [choosing, setChoosing] = useState<CadApplication | null>(null);
  const update = (next: CadStatus) => setPaired(current => next.binding ? current.map(item => item.application === next.application ? next : item) : current.filter(item => item.application !== next.application));
  async function reconnect(result: CadStatus, target: { session: string; document: { id: string; title: string } }) {
    const { label, noun } = COPY[result.application];
    setReconnecting(true);
    setNotice(`Switch to ${label} and choose Yes to reconnect this ${noun}.`);
    try { update(await window.electronAPI!.cad.bind(workspace, result.application, target.session, target.document.id, session)); setNotice(""); }
    catch (error) { setNotice(errorText(error)); }
    finally { setReconnecting(false); }
  }
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const api = window.electronAPI?.cad;
    if (!api) return;
    let live = true;
    async function refresh() {
      try {
        // Mi reports this window's own drawing only while it runs a CAD agent.
        const results = await Promise.all((["revit", "autocad"] as const).map(application => api!.status(workspace, application, session)));
        const isAgent = await api!.isAgentSession(workspace, session);
        if (live) { setPaired(results.filter(result => result.binding)); setAgent(isAgent); onAgent?.(isAgent); }
      } catch { /* The setup panel reports connection errors. */ }
    }
    refreshRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    // An agent that connects drawings or switches its own shows here at once, not on the next poll.
    const stopChanged = api.onChanged?.(change => { if (change.workspace === workspace) void refresh(); });
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); stopChanged?.(); };
  }, [workspace, session, onAgent]);
  // While the list is open, a file opened in the application shows up within seconds.
  useEffect(() => {
    if (!choosing) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refreshRef.current(); }, 4000);
    return () => window.clearInterval(timer);
  }, [choosing]);
  return <>
    <CadReviewBar workspace={workspace} />
    {paired.length > 0 && <div role="status" aria-label="MCP connection" className="shrink-0 border-b border-accent/40 bg-accent/10 px-3 py-1.5 text-xs">
      <p className="font-medium capitalize text-foreground">{agent ? "CAD agent" : "MCP paired"} · {workspaceDisplayName(workspace)}</p>
      {paired.map(result => {
        const { label, noun } = COPY[result.application];
        const target = reconnectTarget(result);
        const state = !connected(result) ? "Reconnect required" : result.health === "Busy" ? `Connected · ${busyText(result)}` : result.reviewsInMi ? "Connected" : `Connected · edits are reviewed in ${label} until you reconnect`;
        const more = (result.binding!.drawings?.length ?? 1) - 1;
        const small = "rounded-md border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50";
        return <div key={result.application}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-muted-foreground">{label}: {result.binding!.title} · {state}{more > 0 ? ` · ${more} more ${noun}${more === 1 ? "" : "s"} connected` : ""}</p>
            {target && <button type="button" disabled={reconnecting} onClick={() => void reconnect(result, target)} className={small}>Reconnect</button>}
            <button type="button" disabled={reconnecting} aria-expanded={choosing === result.application} className={small}
              onClick={() => { const next = choosing === result.application ? null : result.application; setChoosing(next); setNotice(""); if (next) void refreshRef.current(); }}>
              Switch {noun}
            </button>
          </div>
          {choosing === result.application && <div className="mt-1 space-y-1">
            {!agent && <EnginePicker {...cadEngine} />}
            <CadDrawingList workspace={workspace} status={result} button={small} onStatus={update} onNotice={setNotice} agentSession={agent ? session : undefined}
              launch={item => launchAgent(workspace, cadEngine.engine, item, onAgentStarted)} />
          </div>}
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

export function CadConnections({ workspace, onAgentStarted }: { workspace: string;
  /** Given by the project terminal: agents then start in one of its sessions, which it shows, instead of a new window. */
  onAgentStarted?: (session: string) => void }) {
  const cadEngine = useCadEngine();
  // Open drawings picked for connecting in step 3, keyed session:document. null means the default pick.
  const [picked, setPicked] = useState<Set<string> | null>(null);
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

  async function startAgent() {
    setMessage(await launchAgent(workspace, cadEngine.engine, {}, onAgentStarted));
    setOpen(false); // Setup is done, so the terminal gets the room back.
  }
  const engineName = ENGINE_LABEL[cadEngine.engine];
  const step = status ? nextStep(status) : 0;
  // Several drawings connect in one step when every AutoCAD with files open can keep several per project.
  const openDocuments = status ? status.sessions.flatMap(session => session.documents.map(document => ({ session, document, key: `${session.session}:${document.id}` }))) : [];
  const multiple = status?.application === "autocad" && openDocuments.length > 1 && status.sessions.every(session => !session.documents.length || (session.features ?? []).includes("multi-drawing"));
  const defaultPick = new Set(openDocuments.filter(item => item.document.isActive).map(item => item.key).slice(0, 1));
  const chosenKeys = new Set([...(picked ?? defaultPick)].filter(key => openDocuments.some(item => item.key === key)));
  async function connectChosen() {
    const targets = openDocuments.filter(item => chosenKeys.has(item.key)).map(item => ({ session: item.session.session, document: item.document.id }));
    setMessage(`Switch to ${copy.label} and choose Yes in the dialog there. It asks once for each ${copy.label} window.`);
    const { results, status: next } = await window.electronAPI!.cad.attach(workspace, targets);
    remember(next); setPicked(null);
    const done = results.filter(item => item.connected).map(item => item.drawing);
    const failed = results.filter(item => !item.connected).map(item => `${item.drawing}: ${item.error ?? "not connected"}`);
    if (!done.length) { setMessage(failed.join("\n") || "Nothing was connected."); return; }
    setMessage([`Connected: ${done.join(", ")}. Starting ${engineName}…`, ...failed].join("\n"));
    try { await startAgent(); } catch (error) { setMessage([`Connected: ${done.join(", ")}.`, ...failed, errorText(error)].join("\n")); }
  }
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
            ? <p role="status">{copy.product} was not found on this computer.{status.releases?.unsupported.length ? ` Found ${status.releases.unsupported.join(", ")}, which Mi cannot connect to.` : ""} {copy.needs}</p>
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
          {step === 3 && multiple && <>
            <fieldset className="space-y-1">
              <legend className="sr-only">Drawings to connect</legend>
              {openDocuments.map(({ session, document, key }) => <label key={key} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 hover:bg-muted/40">
                <input type="checkbox" className="mt-0.5" checked={chosenKeys.has(key)} disabled={busy}
                  onChange={event => { const next = new Set(chosenKeys); if (event.target.checked) next.add(key); else next.delete(key); setPicked(next); }} />
                <span className="min-w-0">
                  <span className="block font-medium">{session.year ? `${releaseLabel(status, session.year)} · ` : ""}{document.title}{document.isActive ? " · active" : ""}{document.isReadOnly ? " · read-only" : ""}</span>
                  <span className="block break-all text-muted-foreground">{document.path || "Not saved yet"}</span>
                </span>
              </label>)}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <button className={primary} disabled={busy || chosenKeys.size === 0} onClick={() => void run(connectChosen)}>
                Connect {chosenKeys.size === 1 ? `this ${copy.noun}` : `${chosenKeys.size} ${copy.noun}s`}
              </button>
              <EnginePicker {...cadEngine} disabled={busy} />
              <button type="button" className="text-link underline" disabled={busy} onClick={() => setPicked(new Set(openDocuments.map(item => item.key)))}>Select all</button>
            </div>
          </>}
          {step === 3 && !multiple && status.sessions.flatMap(session => session.documents.map(document => <div key={document.id} className="rounded-md border border-border p-2">
            <p className="font-medium">{session.year ? `${releaseLabel(status, session.year)} · ` : ""}{document.title}{document.isReadOnly ? " · read-only" : ""}</p>
            <p className="break-all text-muted-foreground">{document.path || `Not saved yet`}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button className={primary} disabled={busy} onClick={() => void run(async () => {
                setMessage(`Switch to ${copy.label} and choose Yes in the dialog there. This is needed once per ${copy.noun}.`);
                remember(await window.electronAPI!.cad.bind(workspace, application, session.session, document.id));
                setMessage(`${document.title} is connected. Starting ${engineName}…`);
                // Connecting is the whole setup: the agent is what the person came for.
                try { await startAgent(); } catch (error) { setMessage(`${document.title} is connected. ${errorText(error)}`); }
              })}>Connect this {copy.noun}</button>
              <EnginePicker {...cadEngine} disabled={busy} />
            </div>
          </div>))}
          {step === 3 && <p className="text-muted-foreground">{multiple
            ? `Pick every ${copy.noun} the work needs. ${copy.label} asks you to confirm once for each ${copy.label} window, then ${engineName} starts ${onAgentStarted ? "in this terminal" : "in its own window"}, ready to work.`
            : `${copy.label} asks you to confirm once for each ${copy.noun}, then ${engineName} starts ${onAgentStarted ? "in this terminal" : "in its own window"}, ready to work.`}</p>}
        </Step>}
        {showStep(4) && <Step number={4} title="Start an agent" current={step === 4} done={false}>
          {status.binding && !connected(status) && <p role="status">The {copy.noun} isn’t connected right now, so an agent started here can’t reach it. Reconnect first.</p>}
          {status.binding && <>
            <p>{`${engineName} opens ${onAgentStarted ? "in a free session of this terminal" : "in its own window"} with only Mi's CAD tools. `}{status.reviewsInMi ? `Each edit appears at the top of the terminal for you to apply or decline.` : `Mi restarted since this ${copy.noun} was connected, so edits are reviewed in ${copy.label}. Disconnect and connect again to review them in Mi.`}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button className={connected(status) ? primary : button} disabled={busy} onClick={() => void run(startAgent)}>Start {engineName}</button>
              <EnginePicker {...cadEngine} disabled={busy} />
            </div>
            <div className="pt-1"><CadDrawingList workspace={workspace} status={status} button={button} onStatus={remember} onNotice={setMessage}
              launch={item => launchAgent(workspace, cadEngine.engine, item, onAgentStarted)} /></div>
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
