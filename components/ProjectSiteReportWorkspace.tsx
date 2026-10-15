"use client";

import { useEffect, useState } from "react";
import type {
  ProjectRecordReference,
  ProjectSiteReport,
  ProjectDecision,
  ScheduleDraftItem,
  SiteReportItem,
  SiteReportItemKind,
} from "@/lib/schema";
import type { ProjectSiteReportDocument } from "@/lib/content/projectSiteReports";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";

interface ItemDraft {
  key: string;
  kind: SiteReportItemKind;
  location: string;
  text: string;
  attributedTo: string;
  evidencePath: string;
  photoPaths: string;
  owner: string;
  dueDate: string;
}

type Handoff =
  | {
      kind: "decision";
      decision: ProjectDecision;
      label: string;
    }
  | {
      kind: "schedule";
      item: ScheduleDraftItem;
      label: string;
    };

const ITEM_LABELS: Record<SiteReportItemKind, string> = {
  "direct-observation": "Direct observation",
  "reported-information": "Reported information",
  interpretation: "Interpretation",
  issue: "Issue requiring review",
  "follow-up": "Proposed follow-up",
  limitation: "Observation limitation",
};

const ITEM_PREFIXES: Record<SiteReportItemKind, string> = {
  "direct-observation": "O",
  "reported-information": "R",
  interpretation: "I",
  issue: "ISS",
  "follow-up": "F",
  limitation: "L",
};

function newItem(kind: SiteReportItemKind = "direct-observation"): ItemDraft {
  return {
    key: crypto.randomUUID(),
    kind,
    location: "",
    text: "",
    attributedTo: "",
    evidencePath: "",
    photoPaths: "",
    owner: "",
    dueDate: "",
  };
}

function splitLines(value: string): string[] {
  return value.split(/[\n,]/).map((line) => line.trim()).filter(Boolean);
}

function fileReference(
  path: string,
  label = path.split("/").at(-1) ?? path,
): ProjectRecordReference {
  return {
    kind: "project-file",
    label,
    path,
    url: null,
    item_id: null,
    source_date: null,
    notes: "",
  };
}

function mirrorMessage(mirror: { mirrored?: boolean; reason?: string; error?: string } | undefined) {
  if (mirror?.mirrored) return " The project's Dropbox Mi mirror was refreshed.";
  if (mirror?.reason === "not-linked") return " Dropbox was not changed because this project is not linked.";
  if (mirror?.error) return ` The local report was saved, but the Dropbox mirror failed: ${mirror.error}`;
  return "";
}

export function ProjectSiteReportWorkspace({
  slug,
  initialDocuments,
}: {
  slug: string;
  initialDocuments: ProjectSiteReportDocument[];
}) {
  const [mounted, setMounted] = useState(false);
  const [documents, setDocuments] = useState(initialDocuments);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [scope, setScope] = useState("");
  const [participants, setParticipants] = useState("");
  const [weather, setWeather] = useState("");
  const [access, setAccess] = useState("");
  const [lighting, setLighting] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [activeWork, setActiveWork] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [rawNotes, setRawNotes] = useState("");
  const [confirmation, setConfirmation] = useState<ProjectSiteReport | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [reviewers, setReviewers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- desktop capability and ids exist only after hydration
    setMounted(true);
    setId(`site-report-${crypto.randomUUID().replaceAll("-", "")}`);
    setVisitDate(new Date().toISOString().slice(0, 10));
    setItems([newItem()]);
  }, []);
  const desktop = mounted && Boolean(window.electronAPI);

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function buildItems(): SiteReportItem[] {
    const kindCounts: Partial<Record<SiteReportItemKind, number>> = {};
    return items.map((item) => {
      const next = (kindCounts[item.kind] ?? 0) + 1;
      kindCounts[item.kind] = next;
      const evidence = item.evidencePath.trim();
      return {
        id: `${ITEM_PREFIXES[item.kind]}${next}`,
        kind: item.kind,
        location: item.location,
        text: item.text,
        attributed_to: item.attributedTo.trim() || null,
        source_refs: evidence ? [fileReference(evidence)] : [],
        photo_refs: splitLines(item.photoPaths).map((photoPath) => fileReference(photoPath)),
        owner: item.kind === "follow-up" ? item.owner.trim() || null : null,
        due_date: item.kind === "follow-up" ? item.dueDate || null : null,
      };
    });
  }

  function buildReport(): ProjectSiteReport {
    const now = new Date().toISOString();
    return {
      version: 1,
      id,
      title,
      status: "draft",
      origin: "manual",
      visit_date: visitDate,
      created_at: now,
      updated_at: null,
      confirmed_by: null,
      purpose,
      scope,
      participants: splitLines(participants).map((name) => ({ name, role: "" })),
      conditions: { weather, access, lighting, occupancy, active_work: activeWork },
      sources: [],
      items: buildItems(),
      raw_notes: rawNotes,
      professional_review_required: true,
    };
  }

  async function previewCreate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/site-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, report: buildReport() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfirmation(data.preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Site report preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreate() {
    if (!confirmation) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/site-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, report: confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDocuments((current) => [data.document, ...current]);
      setConfirmation(null);
      setId(`site-report-${crypto.randomUUID().replaceAll("-", "")}`);
      setTitle("");
      setPurpose("");
      setScope("");
      setParticipants("");
      setWeather("");
      setAccess("");
      setLighting("");
      setOccupancy("");
      setActiveWork("");
      setItems([newItem()]);
      setRawNotes("");
      setMessage(`Draft site report saved locally.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Site report save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function markReviewed(document: ProjectSiteReportDocument) {
    const reviewer = (reviewers[document.report.id] ?? "").trim();
    if (!reviewer) {
      setMessage("Enter the human reviewer's name before marking this report reviewed.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/site-reports/${encodeURIComponent(document.report.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            expectedHash: document.hash,
            report: {
              ...document.report,
              status: "reviewed",
              confirmed_by: reviewer,
            },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(
        data.error === "conflict"
          ? "This report changed elsewhere. Reload the page before trying again."
          : data.error,
      );
      const updated = data.document as ProjectSiteReportDocument;
      setDocuments((current) =>
        current.map((item) => item.report.id === updated.report.id ? updated : item),
      );
      setMessage(`Report marked reviewed.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Site report review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function previewDecisionHandoff(
    document: ProjectSiteReportDocument,
    item: SiteReportItem,
  ) {
    const decision: ProjectDecision = {
      version: 1,
      id: `decision-${crypto.randomUUID().replaceAll("-", "")}`,
      title: item.text.slice(0, 240),
      status: "proposed",
      decision_date: document.report.visit_date,
      recorded_at: new Date().toISOString(),
      confirmed_by: null,
      deciders: [],
      context: `${ITEM_LABELS[item.kind]} from ${document.report.title}${item.location ? ` at ${item.location}` : ""}.`,
      options: [],
      outcome: "",
      rationale: "",
      consequences: [],
      affected_deliverables: [],
      sources: [{
        kind: "site-report",
        label: document.report.title,
        path: document.relativePath,
        url: null,
        item_id: item.id,
        source_date: document.report.visit_date,
        notes: "",
      }],
      supersedes: null,
      superseded_by: null,
    };
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setHandoff({
        kind: "decision",
        decision: data.preview,
        label: `${document.report.title} · ${item.id}`,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision handoff preview failed.");
    } finally {
      setBusy(false);
    }
  }

  function previewScheduleHandoff(document: ProjectSiteReportDocument, item: SiteReportItem) {
    if (!item.due_date) {
      setMessage("Add a proposed due date to this follow-up before creating a timeline item.");
      return;
    }
    setHandoff({
      kind: "schedule",
      label: `${document.report.title} · ${item.id}`,
      item: {
        client_request_id: `${document.report.id}-${item.id}`,
        name: `${item.text} [${document.report.id} ${item.id}]`.slice(0, 200),
        date: item.due_date,
        type: "Deadline",
        start_time: null,
        end_time: null,
      },
    });
  }

  async function applyHandoff() {
    if (!handoff) return;
    setBusy(true);
    try {
      if (handoff.kind === "decision") {
        const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true, decision: handoff.decision }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setMessage(`Decision proposal created with an exact link back to ${handoff.label}.${mirrorMessage(data.mirror)}`);
      } else {
        const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "save-local",
            confirmed: true,
            item: handoff.item,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setMessage(`Follow-up added to the Mi timeline as ${data.id}. Notion was not changed.`);
      }
      setHandoff(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The handoff could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Removes a site report. Throws on failure so the shared delete control renders the
   * reason inline rather than dropping it.
   */
  async function removeReport(document: ProjectSiteReportDocument) {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(slug)}/site-reports/${encodeURIComponent(document.report.id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedHash: document.hash }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data.error === "conflict"
          ? "This report changed elsewhere. Reload the page before deleting it."
          : data.error ?? "The site report could not be deleted.",
      );
    }
    setDocuments((current) => current.filter((item) => item.report.id !== document.report.id));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-status-warning-foreground/40 bg-status-warning/30 p-4 text-sm">
        Site reports record limited observations and attributed information. They do not establish
        concealed conditions or determine code, structural, MEP, accessibility, environmental,
        contractual, or life-safety compliance. Professional review remains required.
      </div>
      {!desktop && mounted && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          This view is read-only on iPhone and in a browser. Use the Mi Mac app to draft or review
          site reports. Referenced photos stay in project or confirmed Dropbox storage; Mi records
          only their relative paths.
        </div>
      )}

      {desktop && (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-medium">New site report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Separate what you saw, what someone reported, your interpretation, open issues,
            proposed follow-ups, and limits on the visit.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Report title"><input className="control" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Visit date"><input className="control" type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} /></Field>
            <Field label="Purpose"><textarea className="control" rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
            <Field label="Observed scope"><textarea className="control" rows={3} value={scope} onChange={(event) => setScope(event.target.value)} /></Field>
            <Field label="Participants (one per line)"><textarea className="control" rows={3} value={participants} onChange={(event) => setParticipants(event.target.value)} /></Field>
            <Field label="Access"><textarea className="control" rows={3} value={access} onChange={(event) => setAccess(event.target.value)} /></Field>
            <Field label="Weather"><input className="control" value={weather} onChange={(event) => setWeather(event.target.value)} /></Field>
            <Field label="Lighting"><input className="control" value={lighting} onChange={(event) => setLighting(event.target.value)} /></Field>
            <Field label="Occupancy"><input className="control" value={occupancy} onChange={(event) => setOccupancy(event.target.value)} /></Field>
            <Field label="Active work"><input className="control" value={activeWork} onChange={(event) => setActiveWork(event.target.value)} /></Field>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-medium">Report items</h3><p className="text-xs text-muted-foreground">Each category gets its own stable numbered item in the saved report.</p></div>
              <button type="button" onClick={() => setItems((current) => [...current, newItem()])} className="rounded-md border border-border px-3 py-2 text-xs">Add item</button>
            </div>
            <div className="mt-3 space-y-3">
              {items.map((item, index) => (
                <div key={item.key} className="rounded-md border border-border p-4">
                  <div className="grid gap-3 md:grid-cols-[15rem_1fr_auto]">
                    <select className="control" value={item.kind} onChange={(event) => updateItem(item.key, {
                      kind: event.target.value as SiteReportItemKind,
                      attributedTo: "",
                      owner: "",
                      dueDate: "",
                    })}>
                      {(Object.keys(ITEM_LABELS) as SiteReportItemKind[]).map((kind) => <option key={kind} value={kind}>{ITEM_LABELS[kind]}</option>)}
                    </select>
                    <input className="control" placeholder="Location" value={item.location} onChange={(event) => updateItem(item.key, { location: event.target.value })} />
                    <button type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))} className="text-xs text-muted-foreground disabled:opacity-40">Remove</button>
                  </div>
                  <textarea className="control mt-3" rows={3} placeholder={`${ITEM_LABELS[item.kind]} ${index + 1}`} value={item.text} onChange={(event) => updateItem(item.key, { text: event.target.value })} />
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {item.kind === "reported-information" && <input className="control" placeholder="Attributed to (required)" value={item.attributedTo} onChange={(event) => updateItem(item.key, { attributedTo: event.target.value })} />}
                    <input className="control" placeholder={item.kind === "interpretation" ? "Evidence path (required)" : "Evidence path (optional)"} value={item.evidencePath} onChange={(event) => updateItem(item.key, { evidencePath: event.target.value })} />
                    <textarea className="control" rows={2} placeholder="Project-relative photo paths (one per line)" value={item.photoPaths} onChange={(event) => updateItem(item.key, { photoPaths: event.target.value })} />
                    {item.kind === "follow-up" && <>
                      <input className="control" placeholder="Proposed owner" value={item.owner} onChange={(event) => updateItem(item.key, { owner: event.target.value })} />
                      <input className="control" type="date" aria-label="Proposed due date" value={item.dueDate} onChange={(event) => updateItem(item.key, { dueDate: event.target.value })} />
                    </>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Field label="Raw field notes"><textarea className="control mt-4" rows={6} value={rawNotes} onChange={(event) => setRawNotes(event.target.value)} /></Field>
          <button type="button" disabled={busy} onClick={() => void previewCreate()} className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">{busy ? "Checking…" : "Review draft before saving"}</button>
        </section>
      )}

      {message && <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{message}</p>}

      <section>
        <h2 className="font-medium">Saved site reports</h2>
        <p className="text-sm text-muted-foreground">{documents.length} tracked report(s)</p>
        <div className="mt-3 space-y-3">
          {documents.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No site reports yet.</p>}
          {documents.map((document) => (
            <article id={document.report.id} key={document.report.id} className="scroll-mt-24 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{document.report.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{document.report.visit_date} · {document.report.items.length} item(s) · {document.report.origin}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs">{document.report.status}</span>
                  <DeleteRecordButton
                    prompt="Delete this site report?"
                    onDelete={() => removeReport(document)}
                  />
                </div>
              </div>
              <p className="mt-3 text-sm">{document.report.purpose || document.report.scope || "No purpose recorded."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(ITEM_LABELS) as SiteReportItemKind[]).map((kind) => {
                  const count = document.report.items.filter((item) => item.kind === kind).length;
                  return count > 0 ? <span key={kind} className="rounded bg-muted px-2 py-1 text-xs">{count} {ITEM_LABELS[kind].toLowerCase()}</span> : null;
                })}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">Read report items</summary>
                <div className="mt-3 space-y-3">
                  {document.report.items.map((item) => (
                    <div key={item.id} className="border-l-2 border-border pl-3 text-sm">
                      <p className="font-medium">{item.id} · {ITEM_LABELS[item.kind]}{item.location ? ` · ${item.location}` : ""}</p>
                      <p className="mt-1">{item.text}</p>
                      {item.attributed_to && <p className="mt-1 text-xs text-muted-foreground">Attributed to {item.attributed_to}</p>}
                      {item.photo_refs.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Photos: {item.photo_refs.map((photo) => photo.path).join(", ")}</p>}
                      {desktop && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.kind !== "follow-up" && item.kind !== "limitation" && (
                            <button type="button" disabled={busy} onClick={() => void previewDecisionHandoff(document, item)} className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40">
                              Propose as decision
                            </button>
                          )}
                          {item.kind === "follow-up" && (
                            <button type="button" disabled={busy || !item.due_date} onClick={() => previewScheduleHandoff(document, item)} className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40" title={item.due_date ? undefined : "A proposed due date is required"}>
                              Add to Mi timeline
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
              {desktop && document.report.status === "draft" && (
                <div className="mt-4 flex flex-wrap gap-2 rounded-md bg-muted p-3">
                  <input className="control max-w-sm" placeholder="Human reviewer's name" value={reviewers[document.report.id] ?? ""} onChange={(event) => setReviewers((current) => ({ ...current, [document.report.id]: event.target.value }))} />
                  <button type="button" disabled={busy} onClick={() => void markReviewed(document)} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">Confirm professional review</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {confirmation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Confirm draft site report</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save “{confirmation.title}” with {confirmation.items.length} categorized item(s)
              under projects/{slug}/site-reports/. This remains a draft until a named human
              reviewer confirms it. No photo is copied and no Notion page is changed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmation(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void confirmCreate()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40">{busy ? "Saving…" : "Confirm and save draft"}</button>
            </div>
          </div>
        </div>
      )}
      {handoff && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">
              {handoff.kind === "decision" ? "Confirm decision proposal" : "Confirm Mi timeline item"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {handoff.kind === "decision"
                ? `Create “${handoff.decision.title}” as an open proposal linked to ${handoff.label}. It will not be marked decided.`
                : `Create “${handoff.item.name}” as a Mi-only deadline on ${handoff.item.date}, sourced from ${handoff.label}. Notion will not change.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setHandoff(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void applyHandoff()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40">{busy ? "Saving…" : "Confirm and save"}</button>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`.control{width:100%;border:1px solid var(--border);border-radius:.375rem;background:var(--card);padding:.5rem .75rem;font-size:.875rem}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}</label>;
}
