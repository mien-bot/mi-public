"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectDecision,
  ProjectRecordReference,
} from "@/lib/schema";
import type { ProjectDecisionDocument } from "@/lib/content/projectDecisions";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";

/** The subset of a decision that Edit exposes, held as raw text while it is being typed. */
interface EditDraft {
  title: string;
  status: "proposed" | "decided";
  date: string;
  confirmedBy: string;
  context: string;
  outcome: string;
  rationale: string;
  consequences: string;
  deliverables: string;
  deciders: string;
}

export interface MeetingDecisionCandidate {
  id: string;
  text: string;
  meetingTitle: string;
  meetingDate: string;
  meetingPath: string;
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function newDecisionId(): string {
  return `decision-${crypto.randomUUID().replaceAll("-", "")}`;
}

function manualSource(): ProjectRecordReference {
  return {
    kind: "conversation",
    label: "Human-entered in Mi",
    path: null,
    url: null,
    item_id: null,
    source_date: null,
    notes: "",
  };
}

function mirrorMessage(mirror: { mirrored?: boolean; reason?: string; error?: string } | undefined) {
  if (mirror?.mirrored) return " The project's Dropbox Mi mirror was refreshed.";
  if (mirror?.reason === "not-linked") return " Dropbox was not changed because this project is not linked.";
  if (mirror?.error) return ` The local record was saved, but the Dropbox mirror failed: ${mirror.error}`;
  return "";
}

export function ProjectDecisionWorkspace({
  slug,
  initialDocuments,
  meetingCandidates,
}: {
  slug: string;
  initialDocuments: ProjectDecisionDocument[];
  meetingCandidates: MeetingDecisionCandidate[];
}) {
  const [mounted, setMounted] = useState(false);
  const [documents, setDocuments] = useState(initialDocuments);
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"proposed" | "decided">("proposed");
  const [date, setDate] = useState("");
  const [confirmedBy, setConfirmedBy] = useState("");
  const [deciders, setDeciders] = useState("");
  const [context, setContext] = useState("");
  const [options, setOptions] = useState("");
  const [outcome, setOutcome] = useState("");
  const [rationale, setRationale] = useState("");
  const [consequences, setConsequences] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [source, setSource] = useState<ProjectRecordReference>(manualSource());
  const [confirmation, setConfirmation] = useState<ProjectDecision | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [decisionOutcomes, setDecisionOutcomes] = useState<Record<string, string>>({});
  const [reviewers, setReviewers] = useState<Record<string, string>>({});
  const [replacementFor, setReplacementFor] = useState<string | null>(null);
  const [replacementTitle, setReplacementTitle] = useState("");
  const [replacementOutcome, setReplacementOutcome] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- desktop capability and ids exist only after hydration
    setMounted(true);
    setId(newDecisionId());
    setDate(new Date().toISOString().slice(0, 10));
  }, []);
  const desktop = mounted && Boolean(window.electronAPI);

  const alreadyPromoted = useMemo(() => new Set(
    documents.flatMap(({ decision }) =>
      decision.sources
        .filter((reference) => reference.kind === "meeting" && reference.item_id)
        .map((reference) => `${reference.path}:${reference.item_id}`),
    ),
  ), [documents]);

  function buildDecision(): ProjectDecision {
    return {
      version: 1,
      id,
      title,
      status,
      decision_date: date,
      recorded_at: new Date().toISOString(),
      confirmed_by: confirmedBy.trim() || null,
      deciders: splitLines(deciders.replaceAll(",", "\n")),
      context,
      options: splitLines(options).map((label) => ({ label, summary: "" })),
      outcome,
      rationale,
      consequences: splitLines(consequences),
      affected_deliverables: splitLines(deliverables),
      sources: [source],
      supersedes: null,
      superseded_by: null,
    };
  }

  /**
   * Promotes a meeting line straight into an open proposal, in one click.
   *
   * A promoted item is a *proposal*, and the schema asks a proposal for nothing but a
   * title, a date and a source — all three of which the meeting note already supplies.
   * Making someone fill in outcome, rationale, deciders and consequences before the record
   * could exist was asking them to invent answers the meeting had not produced yet; the
   * details belong in Edit, once they are actually known. "Add details" below still opens
   * the full form for anyone who does want to fill it in up front.
   */
  async function promoteCandidate(candidate: MeetingDecisionCandidate) {
    setBusy(true);
    setMessage("");
    try {
      const decision: ProjectDecision = {
        version: 1,
        id: newDecisionId(),
        title: candidate.text.slice(0, 240),
        status: "proposed",
        decision_date: candidate.meetingDate,
        recorded_at: new Date().toISOString(),
        confirmed_by: null,
        deciders: [],
        context: `Promoted from ${candidate.meetingTitle}.`,
        options: [],
        outcome: "",
        rationale: "",
        consequences: [],
        affected_deliverables: [],
        sources: [{
          kind: "meeting",
          label: candidate.meetingTitle,
          path: candidate.meetingPath,
          url: null,
          item_id: candidate.id,
          source_date: candidate.meetingDate,
          notes: "",
        }],
        supersedes: null,
        superseded_by: null,
      };
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, decision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDocuments((current) => [data.document, ...current]);
      setMessage(`Promoted as an open proposal. Use Edit to add the outcome and rationale once they are known.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Promotion failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(document: ProjectDecisionDocument) {
    const decision = document.decision;
    setEditingId(decision.id);
    setEdit({
      title: decision.title,
      status: decision.status === "superseded" ? "decided" : decision.status,
      date: decision.decision_date,
      confirmedBy: decision.confirmed_by ?? "",
      context: decision.context,
      outcome: decision.outcome,
      rationale: decision.rationale,
      consequences: decision.consequences.join("\n"),
      deliverables: decision.affected_deliverables.join("\n"),
      deciders: decision.deciders.join("\n"),
    });
  }

  async function saveEdit(document: ProjectDecisionDocument) {
    if (!edit) return;
    if (!edit.title.trim()) {
      setMessage("A decision needs a title.");
      return;
    }
    // The schema refuses a decided record without both of these, and a 400 from the API is
    // a worse way to learn that than a sentence here.
    if (edit.status === "decided" && (!edit.outcome.trim() || !edit.confirmedBy.trim())) {
      setMessage("A confirmed decision needs its outcome and the person confirming it.");
      return;
    }
    await updateDecision(document, {
      ...document.decision,
      title: edit.title.trim(),
      status: edit.status,
      decision_date: edit.date,
      confirmed_by: edit.confirmedBy.trim() || null,
      context: edit.context,
      outcome: edit.outcome,
      rationale: edit.rationale,
      consequences: splitLines(edit.consequences),
      affected_deliverables: splitLines(edit.deliverables),
      deciders: splitLines(edit.deciders.replaceAll(",", "\n")),
    });
    setEditingId(null);
    setEdit(null);
  }

  /**
   * Removes a record outright. Superseding remains the right move for a decision that was
   * really made and then changed — it keeps the history — but a mistaken promotion or a
   * duplicate is not history, and until now there was no way to take one back.
   *
   * The API copies the file into `.mi-backups/` before removing it, so this is recoverable
   * from disk rather than final.
   */
  async function deleteDecision(document: ProjectDecisionDocument) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/decisions/${encodeURIComponent(document.decision.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true, expectedHash: document.hash }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(
        data.error === "conflict"
          ? "This record changed elsewhere. Reload the page before deleting it."
          : data.error,
      );
      setDocuments((current) =>
        current.filter((item) => item.decision.id !== document.decision.id),
      );
      setMessage(`Decision deleted. A recoverable copy was kept in the project's .mi-backups folder.${mirrorMessage(data.mirror)}`);
    } finally {
      setBusy(false);
    }
  }

  function selectMeetingCandidate(candidate: MeetingDecisionCandidate) {
    setId(newDecisionId());
    setTitle(candidate.text.slice(0, 240));
    setStatus("proposed");
    setDate(candidate.meetingDate);
    setContext(`Promoted from ${candidate.meetingTitle}.`);
    setOutcome("");
    setSource({
      kind: "meeting",
      label: candidate.meetingTitle,
      path: candidate.meetingPath,
      url: null,
      item_id: candidate.id,
      source_date: candidate.meetingDate,
      notes: "",
    });
    document.getElementById("new-decision")?.scrollIntoView({ behavior: "smooth" });
  }

  async function previewCreate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: false, decision: buildDecision() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfirmation(data.preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreate() {
    if (!confirmation) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, decision: confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDocuments((current) => [data.document, ...current]);
      setConfirmation(null);
      setId(newDecisionId());
      setTitle("");
      setContext("");
      setOptions("");
      setOutcome("");
      setRationale("");
      setConsequences("");
      setDeliverables("");
      setSource(manualSource());
      setMessage(`Decision record saved locally.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function markDecided(document: ProjectDecisionDocument) {
    const outcomeValue = (decisionOutcomes[document.decision.id] ?? document.decision.outcome).trim();
    const reviewer = (reviewers[document.decision.id] ?? document.decision.confirmed_by ?? "").trim();
    if (!outcomeValue || !reviewer) {
      setMessage("Enter the confirmed outcome and the person confirming it.");
      return;
    }
    await updateDecision(document, {
      ...document.decision,
      status: "decided",
      outcome: outcomeValue,
      confirmed_by: reviewer,
    });
  }

  async function updateDecision(
    document: ProjectDecisionDocument,
    decision: ProjectDecision,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/decisions/${encodeURIComponent(document.decision.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "update",
            confirmed: true,
            expectedHash: document.hash,
            decision,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(
        data.error === "conflict"
          ? "This record changed elsewhere. Reload the page before trying again."
          : data.error,
      );
      const updated = data.result.document as ProjectDecisionDocument;
      setDocuments((current) =>
        current.map((item) => item.decision.id === updated.decision.id ? updated : item),
      );
      setMessage(`Decision updated.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function supersede(original: ProjectDecisionDocument) {
    if (!replacementTitle.trim() || !replacementOutcome.trim()) {
      setMessage("Enter a replacement title and confirmed outcome.");
      return;
    }
    const reviewer = (reviewers[original.decision.id] ?? "").trim();
    if (!reviewer) {
      setMessage("Enter the person confirming the replacement.");
      return;
    }
    const replacement: ProjectDecision = {
      ...original.decision,
      id: newDecisionId(),
      title: replacementTitle,
      status: "decided",
      decision_date: new Date().toISOString().slice(0, 10),
      recorded_at: new Date().toISOString(),
      confirmed_by: reviewer,
      context: `This record replaces ${original.decision.id}. ${original.decision.context}`.trim(),
      outcome: replacementOutcome,
      sources: [{
        kind: "decision",
        label: original.decision.title,
        path: original.relativePath,
        url: null,
        item_id: original.decision.id,
        source_date: original.decision.decision_date,
        notes: "Superseded decision",
      }],
      supersedes: original.decision.id,
      superseded_by: null,
    };
    setBusy(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/decisions/${encodeURIComponent(original.decision.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "supersede",
            confirmed: true,
            expectedHash: original.hash,
            replacement,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.partial) {
          setDocuments((current) => [data.replacement, ...current]);
          throw new Error(`${data.error} Reload and reconcile the linked records before continuing.`);
        }
        throw new Error(data.error);
      }
      const result = data.result as {
        original: ProjectDecisionDocument;
        replacement: ProjectDecisionDocument;
      };
      setDocuments((current) => [
        result.replacement,
        ...current.map((item) =>
          item.decision.id === result.original.decision.id ? result.original : item,
        ),
      ]);
      setReplacementFor(null);
      setReplacementTitle("");
      setReplacementOutcome("");
      setMessage(`Replacement saved and the original marked superseded.${mirrorMessage(data.mirror)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supersession failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!desktop && mounted && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          This view is read-only on iPhone and in a browser. Use the Mi Mac app to create,
          confirm, or supersede decision records.
        </div>
      )}

      {desktop && meetingCandidates.some((candidate) =>
        !alreadyPromoted.has(`${candidate.meetingPath}:${candidate.id}`)) && (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-medium">Decisions found in meeting notes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Promote saves the item straight away as an open proposal, with an exact source link back to
            the meeting. Add the outcome and rationale later with Edit, once they are known.
          </p>
          <div className="mt-3 space-y-2">
            {meetingCandidates.filter((candidate) =>
              !alreadyPromoted.has(`${candidate.meetingPath}:${candidate.id}`)).map((candidate) => (
                <div key={`${candidate.meetingPath}:${candidate.id}`} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm">{candidate.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{candidate.meetingDate} · {candidate.meetingTitle}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button type="button" disabled={busy} onClick={() => void promoteCandidate(candidate)} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">
                      {busy ? "Saving…" : "Promote"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => selectMeetingCandidate(candidate)} className="text-[11px] text-muted-foreground underline underline-offset-2 disabled:opacity-40">
                      Add details first
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {desktop && (
        <section id="new-decision" className="rounded-lg border border-border p-5">
          <h2 className="font-medium">New decision record</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Save an open proposal or a confirmed decision. Every record needs a named source.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Title"><input className="control" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Decision date"><input className="control" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
            <Field label="State">
              <select className="control" value={status} onChange={(event) => setStatus(event.target.value as "proposed" | "decided")}>
                <option value="proposed">Proposal — not yet decided</option>
                <option value="decided">Confirmed decision</option>
              </select>
            </Field>
            <Field label="Confirmed by"><input className="control" value={confirmedBy} onChange={(event) => setConfirmedBy(event.target.value)} placeholder={status === "decided" ? "Required for accountability" : "Optional"} /></Field>
            <Field label="Deciders (comma or line separated)"><textarea className="control" rows={3} value={deciders} onChange={(event) => setDeciders(event.target.value)} /></Field>
            <Field label="Options considered (one label per line)"><textarea className="control" rows={3} value={options} onChange={(event) => setOptions(event.target.value)} /></Field>
          </div>
          <div className="mt-4 space-y-4">
            <Field label="Context"><textarea className="control" rows={4} value={context} onChange={(event) => setContext(event.target.value)} /></Field>
            <Field label={status === "decided" ? "Confirmed outcome" : "Proposed outcome"}><textarea className="control" rows={3} value={outcome} onChange={(event) => setOutcome(event.target.value)} /></Field>
            <Field label="Rationale"><textarea className="control" rows={3} value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Consequences (one per line)"><textarea className="control" rows={3} value={consequences} onChange={(event) => setConsequences(event.target.value)} /></Field>
              <Field label="Affected deliverables (one per line)"><textarea className="control" rows={3} value={deliverables} onChange={(event) => setDeliverables(event.target.value)} /></Field>
            </div>
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Source: {source.label}{source.path ? ` · ${source.path}` : ""}{source.item_id ? ` · ${source.item_id}` : ""}
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void previewCreate()} className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">
            {busy ? "Checking…" : "Review before saving"}
          </button>
        </section>
      )}

      {message && <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{message}</p>}

      <section>
        <div className="flex items-end justify-between gap-3">
          <div><h2 className="font-medium">Decision register</h2><p className="text-sm text-muted-foreground">{documents.length} tracked record(s)</p></div>
        </div>
        <div className="mt-3 space-y-3">
          {documents.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No decision records yet.</p>}
          {documents.map((document) => {
            const decision = document.decision;
            return (
              <article id={decision.id} key={decision.id} className="scroll-mt-24 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{decision.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{decision.decision_date} · {decision.id}</p>
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-xs">{decision.status}</span>
                </div>
                <p className="mt-3 text-sm">{decision.outcome || decision.context || "No outcome recorded."}</p>
                {decision.supersedes && <p className="mt-2 text-xs text-muted-foreground">Replaces {decision.supersedes}</p>}
                {decision.superseded_by && <p className="mt-2 text-xs text-muted-foreground">Replaced by {decision.superseded_by}</p>}
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Sources and rationale</summary>
                  <p className="mt-2">{decision.rationale || "No rationale recorded."}</p>
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                    {decision.sources.map((reference, index) => <li key={index}>{reference.label}{reference.path ? ` — ${reference.path}` : ""}</li>)}
                  </ul>
                </details>
                {desktop && decision.status === "proposed" && (
                  <div className="mt-4 grid gap-2 rounded-md bg-muted p-3 md:grid-cols-[1fr_14rem_auto]">
                    <textarea className="control" rows={2} placeholder="Confirmed outcome" value={decisionOutcomes[decision.id] ?? decision.outcome} onChange={(event) => setDecisionOutcomes((current) => ({ ...current, [decision.id]: event.target.value }))} />
                    <input className="control" placeholder="Confirmed by" value={reviewers[decision.id] ?? decision.confirmed_by ?? ""} onChange={(event) => setReviewers((current) => ({ ...current, [decision.id]: event.target.value }))} />
                    <button type="button" disabled={busy} onClick={() => void markDecided(document)} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">Confirm decision</button>
                  </div>
                )}
                {desktop && editingId === decision.id && edit && (
                  <div className="mt-4 grid gap-3 rounded-md bg-muted p-3 md:grid-cols-2">
                    <Field label="Title"><input className="control" value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></Field>
                    <Field label="Decision date"><input className="control" type="date" value={edit.date} onChange={(event) => setEdit({ ...edit, date: event.target.value })} /></Field>
                    <Field label="State">
                      <select className="control" value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as "proposed" | "decided" })}>
                        <option value="proposed">Proposal — not yet decided</option>
                        <option value="decided">Confirmed decision</option>
                      </select>
                    </Field>
                    <Field label="Confirmed by"><input className="control" value={edit.confirmedBy} onChange={(event) => setEdit({ ...edit, confirmedBy: event.target.value })} placeholder={edit.status === "decided" ? "Required" : "Optional"} /></Field>
                    <Field label="Deciders (comma or line separated)"><textarea className="control" rows={2} value={edit.deciders} onChange={(event) => setEdit({ ...edit, deciders: event.target.value })} /></Field>
                    <Field label="Context"><textarea className="control" rows={2} value={edit.context} onChange={(event) => setEdit({ ...edit, context: event.target.value })} /></Field>
                    <div className="md:col-span-2 grid gap-3">
                      <Field label={edit.status === "decided" ? "Confirmed outcome" : "Proposed outcome"}><textarea className="control" rows={3} value={edit.outcome} onChange={(event) => setEdit({ ...edit, outcome: event.target.value })} /></Field>
                      <Field label="Rationale"><textarea className="control" rows={3} value={edit.rationale} onChange={(event) => setEdit({ ...edit, rationale: event.target.value })} /></Field>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Consequences (one per line)"><textarea className="control" rows={2} value={edit.consequences} onChange={(event) => setEdit({ ...edit, consequences: event.target.value })} /></Field>
                        <Field label="Affected deliverables (one per line)"><textarea className="control" rows={2} value={edit.deliverables} onChange={(event) => setEdit({ ...edit, deliverables: event.target.value })} /></Field>
                      </div>
                    </div>
                    <div className="md:col-span-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void saveEdit(document)} className="rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">{busy ? "Saving…" : "Save changes"}</button>
                      <button type="button" onClick={() => { setEditingId(null); setEdit(null); }} className="rounded-md border border-border px-3 py-2 text-xs">Cancel</button>
                    </div>
                  </div>
                )}

                {desktop && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    <button type="button" onClick={() => editingId === decision.id ? (setEditingId(null), setEdit(null)) : startEdit(document)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent">
                      {editingId === decision.id ? "Close editor" : "Edit"}
                    </button>
                    <DeleteRecordButton
                      disabled={busy}
                      prompt="Delete this decision record?"
                      onDelete={() => deleteDecision(document)}
                    />
                  </div>
                )}

                {desktop && decision.status === "decided" && (
                  <div className="mt-4">
                    <button type="button" onClick={() => setReplacementFor(replacementFor === decision.id ? null : decision.id)} className="text-xs text-muted-foreground underline">Replace with a newer decision</button>
                    {replacementFor === decision.id && (
                      <div className="mt-2 grid gap-2 rounded-md bg-muted p-3 md:grid-cols-2">
                        <input className="control" placeholder="Replacement title" value={replacementTitle} onChange={(event) => setReplacementTitle(event.target.value)} />
                        <input className="control" placeholder="Confirmed by" value={reviewers[decision.id] ?? ""} onChange={(event) => setReviewers((current) => ({ ...current, [decision.id]: event.target.value }))} />
                        <textarea className="control md:col-span-2" rows={3} placeholder="New confirmed outcome" value={replacementOutcome} onChange={(event) => setReplacementOutcome(event.target.value)} />
                        <button type="button" disabled={busy} onClick={() => void supersede(document)} className="w-fit rounded-md bg-foreground px-3 py-2 text-xs text-background disabled:opacity-40">Confirm replacement</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {confirmation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">Confirm decision record</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Save “{confirmation.title}” as {confirmation.status === "decided" ? "a confirmed decision" : "an open proposal"} under projects/{slug}/decisions/.
              No Notion page will be changed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmation(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void confirmCreate()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40">{busy ? "Saving…" : "Confirm and save"}</button>
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
