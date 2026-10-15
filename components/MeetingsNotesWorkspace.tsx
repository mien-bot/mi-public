"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeetingRecordList } from "@/components/MeetingRecordList";
import type { MeetingNoteRecord } from "@/lib/content/meetingNoteFile";
import { localDateTimeToCanonical } from "@/lib/content/timezone";
import { formatHoursAndMinutes } from "@/lib/duration";
import { meetingAgendaMinutes } from "@/lib/meetingAgenda";
import {
  MEETING_TYPE_SUGGESTIONS,
  type AiMeetingResponse,
  type MeetingAgendaItem,
  type MeetingDecisionRecord,
  type MeetingImpact,
  type MeetingNote,
  type MeetingSource,
  type MeetingVisibility,
  type ScheduleDraftItem,
} from "@/lib/schema";
import { usePersonalTimezone } from "./usePersonalTimezone";

type Confirmation = "local" | "notion" | null;

export function MeetingsNotesWorkspace({ slug, notionLinked, records, scope = "project" }: {
  slug: string;
  notionLinked: boolean;
  records: MeetingNoteRecord[];
  scope?: "project" | "lead";
}) {
  const router = useRouter();
  const formRef = useRef<HTMLElement>(null);
  const { timezone } = usePersonalTimezone();
  const [mounted, setMounted] = useState(false);
  const [engine, setEngine] = useState<"codex" | "claude">("codex");
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState("Client Meeting");
  /*
   * Starts empty on purpose. Visibility decides whether the team's own notes about a
   * client's budget can leave the firm, so the person records it rather than accepting
   * whatever a default would have chosen for them.
   */
  const [visibility, setVisibility] = useState<MeetingVisibility | "">("");
  const [meetingStatus, setMeetingStatus] = useState<MeetingNote["meeting_status"]>("planned");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [attendees, setAttendees] = useState("");
  const [objective, setObjective] = useState("");
  const [preparation, setPreparation] = useState("");
  const [agendaItems, setAgendaItems] = useState<MeetingAgendaItem[]>([]);
  const [rawNotes, setRawNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [decisions, setDecisions] = useState("");
  const [actions, setActions] = useState<AiMeetingResponse["action_items"]>([]);
  const [questions, setQuestions] = useState("");
  const [decisionRecords, setDecisionRecords] = useState<MeetingDecisionRecord[]>([]);
  const [blockingQuestions, setBlockingQuestions] = useState<string[]>([]);
  const [impacts, setImpacts] = useState<MeetingImpact[]>([]);
  const [sources, setSources] = useState<MeetingSource[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [candidates, setCandidates] = useState<{ relativePath: string; reason: string }[]>([]);
  const [candidateNote, setCandidateNote] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [editing, setEditing] = useState<{ expectedHash: string; title: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [syncResult, setSyncResult] = useState("");
  /*
   * The page opens on the record list, not on an empty form. Reading what was decided is
   * the common visit; entering a new meeting is the occasional one, and a form sitting
   * open above the list pushed every existing note below the fold.
   */
  const [composerOpen, setComposerOpen] = useState(false);
  const agendaMinutes = meetingAgendaMinutes(agendaItems);
  const meetingsApi = `/api/${scope === "project" ? "projects" : "leads"}/${encodeURIComponent(slug)}/meetings`;

  /**
   * Removes a meeting note. Throws on failure so the shared delete control can render the
   * reason inline — most usefully the hash conflict, which means the note changed after
   * this page opened and should be re-read rather than discarded.
   */
  async function removeMeeting(record: MeetingNoteRecord) {
    const response = await fetch(meetingsApi, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, id: record.meeting.id, expectedHash: record.hash }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "The meeting could not be deleted.");
    router.refresh();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe desktop state and client-only UUID
    setMounted(true); setMeetingId(`meeting-${crypto.randomUUID()}`);
  }, []);

  useEffect(() => {
    if (composerOpen) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [composerOpen]);
  const desktop = mounted && Boolean(window.electronAPI);

  function resetMeetingForm() {
    setEditing(null);
    setMeetingId(`meeting-${crypto.randomUUID()}`);
    setTitle("");
    setMeetingType("Client Meeting");
    setVisibility("");
    setDecisionRecords([]);
    setBlockingQuestions([]);
    setImpacts([]);
    setSources([]);
    setMeetingStatus("planned");
    setDate("");
    setStartTime("");
    setEndTime("");
    setAttendees("");
    setObjective("");
    setPreparation("");
    setAgendaItems([]);
    setRawNotes("");
    setSummary("");
    setDecisions("");
    setActions([]);
    setQuestions("");
  }

  function takeNotes(record: MeetingNoteRecord) {
    const planned = record.meeting;
    setEditing({ expectedHash: record.hash, title: planned.title });
    setMeetingId(planned.id);
    setTitle(planned.title);
    setMeetingType(planned.meeting_type);
    setMeetingStatus("completed");
    setDate(planned.date);
    setStartTime(planned.start_time);
    setEndTime(planned.end_time);
    setAttendees(planned.attendees.join(", "));
    setObjective(planned.objective);
    setPreparation(planned.preparation.join("\n"));
    setAgendaItems(planned.agenda_items);
    setRawNotes(planned.raw_notes);
    setSummary(planned.summary);
    setDecisions(planned.decisions.join("\n"));
    setActions(planned.action_items);
    setQuestions(planned.open_questions.join("\n"));
    setMessage(`Taking notes for ${planned.title}. The saved agenda stays in place until you review and confirm the completed record.`);
    setComposerOpen(true);
  }

  const meeting = useMemo<MeetingNote>(() => {
    const decisionList = decisions.split("\n").map((value) => value.trim()).filter(Boolean);
    const questionList = questions.split("\n").map((value) => value.trim()).filter(Boolean);
    /*
     * The decisions and open-questions textareas stay free text, so a person editing them
     * can orphan an extracted reasoning record or a blocking flag. Reconciling here keeps
     * meetingNoteSchema's mirror invariant satisfied by construction rather than surfacing
     * a validation error about a field the form never showed them.
     */
    const decisionSet = new Set(decisionList);
    const questionSet = new Set(questionList);
    return {
      id: meetingId,
      title,
      meeting_type: meetingType,
      visibility: visibility || undefined,
      meeting_status: meetingStatus,
      date,
      start_time: startTime,
      end_time: endTime,
      timezone,
      attendees: attendees.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
      objective,
      preparation: preparation.split("\n").map((value) => value.trim()).filter(Boolean),
      agenda_items: agendaItems,
      raw_notes: rawNotes,
      summary,
      decisions: decisionList,
      action_items: actions,
      open_questions: questionList,
      decision_records: decisionRecords.filter((record) => decisionSet.has(record.statement)),
      blocking_questions: blockingQuestions.filter((question) => questionSet.has(question)),
      impacts,
      sources,
    };
  }, [meetingId, title, meetingType, visibility, meetingStatus, date, startTime, endTime, timezone, attendees, objective, preparation, agendaItems, rawNotes, summary, decisions, actions, questions, decisionRecords, blockingQuestions, impacts, sources]);

  const sourceApi = "/api/meeting-source";
  const workspaceKind = scope === "project" ? "project" : "lead";

  async function loadCandidates() {
    setSourceBusy(true);
    setCandidateNote("");
    try {
      const response = await fetch(sourceApi, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: workspaceKind, slug, action: "candidates", meetingDate: date }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCandidates(data.candidates);
      setCandidateNote(data.candidates.length === 0
        ? data.note || "No files in this record's folder match that date."
        : "");
    } catch (error) {
      setCandidateNote(error instanceof Error ? error.message : "The folder could not be read.");
    } finally { setSourceBusy(false); }
  }

  /*
   * Attaching keeps the source text in raw_notes as well as recording the descriptor.
   * The extraction is a convenience; the transcript is the evidence, so the record has to
   * carry the words themselves, not just a hash of a file someone might later move.
   */
  function absorb(data: { source: MeetingSource; text: string; warnings: string[] }) {
    setSources((current) => [...current.filter((item) => item.sha256 !== data.source.sha256), data.source]);
    if (data.text.trim()) {
      const header = `--- ${data.source.label} (${data.source.relative_path ?? "pasted"}) ---`;
      setRawNotes((current) => current.includes(header)
        ? current
        : [current.trim(), header, data.text.trim()].filter(Boolean).join("\n\n"));
    }
    setMessage([`Attached ${data.source.label}.`, ...data.warnings].join(" "));
  }

  async function attachFile(relativePath: string) {
    setSourceBusy(true);
    try {
      const response = await fetch(sourceApi, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: workspaceKind, slug, relativePath }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      absorb(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The file could not be read."); }
    finally { setSourceBusy(false); }
  }

  async function attachPaste() {
    setSourceBusy(true);
    try {
      const response = await fetch(sourceApi, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: workspaceKind, slug, text: pasteText, label: `Pasted for ${title || "this meeting"}` }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      absorb(data);
      setPasteText("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The text could not be attached."); }
    finally { setSourceBusy(false); }
  }

  function localSaveBody(confirmed: boolean) {
    return {
      confirmed,
      operation: editing ? "update" : "create",
      expectedHash: editing?.expectedHash,
      meeting,
    };
  }

  async function generateDraft() {
    if (!desktop || scope !== "project") return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/ai`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "meeting", engine, meeting: { title, meetingType, date, startTime, endTime, attendees, rawNotes } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const draft = data.draft as AiMeetingResponse;
      setSummary(draft.summary);
      setDecisions(draft.decisions.join("\n"));
      setActions(draft.action_items);
      setQuestions(draft.open_questions.join("\n"));
      setMeetingStatus("completed");
      setMessage("AI summary draft created in read-only mode. Review every field before confirming a local save.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI summary failed."); }
    finally { setBusy(false); }
  }

  async function previewLocalSave() {
    setBusy(true);
    try {
      const response = await fetch(meetingsApi, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localSaveBody(false)),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfirmation("local");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Meeting preview failed."); }
    finally { setBusy(false); }
  }

  function scheduleItem(): ScheduleDraftItem {
    return {
      client_request_id: `${meetingId}-schedule`, name: title, date, type: "Meeting",
      start_time: localDateTimeToCanonical(date, startTime, timezone),
      end_time: localDateTimeToCanonical(date, endTime, timezone),
    };
  }

  async function previewNotion() {
    setBusy(true);
    try {
      const item = scheduleItem();
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "sync", confirmed: false, items: [item] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConfirmation("notion");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Schedule preview failed."); }
    finally { setBusy(false); }
  }

  async function applyConfirmed() {
    setBusy(true);
    try {
      if (confirmation === "local") {
        const response = await fetch(meetingsApi, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localSaveBody(true)),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const mirrorMessage = scope === "lead"
          ? " Nothing was sent to Notion."
          : data.mirror?.mirrored
            ? " It was also refreshed in this project's Dropbox Mi folder."
            : data.mirror?.reason === "not-linked"
              ? " Link the project Dropbox folder to enable its Mi mirror."
              : data.mirror?.error
                ? ` The local note was saved, but the Dropbox Mi mirror failed: ${data.mirror.error}`
                : " Nothing was sent to Notion.";
        setMessage(`Meeting ${editing ? "updated" : "saved"} locally as ${data.file}.${mirrorMessage}`);
        resetMeetingForm();
        // Back to the list: the record that was just written is the thing worth seeing next.
        setComposerOpen(false);
        router.refresh();
      } else if (confirmation === "notion") {
        const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/schedule`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "sync", confirmed: true, items: [scheduleItem()] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const result = data.results[0];
        setSyncResult(`${result.name}: ${result.status}${result.error ? ` — ${result.error}` : ""}`);
      }
      setConfirmation(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Confirmed operation failed."); }
    finally { setBusy(false); }
  }

  const completedCount = records.filter(({ meeting }) => meeting.meeting_status === "completed").length;
  const plannedCount = records.length - completedCount;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-medium">Meeting records</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {records.length === 0
            ? "No meetings recorded yet."
            : `${completedCount} completed note${completedCount === 1 ? "" : "s"}${plannedCount > 0 ? ` · ${plannedCount} planned agenda${plannedCount === 1 ? "" : "s"}` : ""}.`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => { if (composerOpen) { resetMeetingForm(); } setComposerOpen((open) => !open); }}
        className="tactile-control rounded-md bg-foreground px-4 py-2 text-sm text-background"
      >
        {composerOpen ? "Close" : "Add meeting"}
      </button>
    </div>

    {records.length === 0 && !composerOpen && (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        Meetings confirmed here become tracked Markdown records. Use <span className="font-medium">Add meeting</span> to
        plan an agenda or write up one that already happened.
      </p>
    )}

    <MeetingRecordList records={records} onTakeNotes={takeNotes} onDelete={removeMeeting} />

    {composerOpen && <>
    {scope === "project" && !desktop && mounted && <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">AI meeting summaries are available in the Mi desktop app. You can still enter and save reviewed notes manually in a browser.</div>}
    <section ref={formRef} className="scroll-mt-6 rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">{editing ? `Take notes · ${editing.title}` : "Plan or capture a meeting"}</h2><p className="text-sm text-muted-foreground">{editing ? "The saved agenda is loaded below. Add live notes and outcomes, then confirm the update." : "Build a timeboxed agenda before the meeting, then capture notes and outcomes when it happens."}</p></div>{scope === "project" && <select value={engine} onChange={(event) => setEngine(event.target.value as "codex" | "claude")} className="rounded-md border border-border bg-card px-3 py-2 text-sm"><option value="codex">Codex</option><option value="claude">Claude</option></select>}</div>
      {editing && <button type="button" onClick={resetMeetingForm} className="mt-3 text-xs text-muted-foreground hover:underline">Cancel taking notes and start a new meeting</button>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Meeting title"><input required value={title} onChange={(event) => setTitle(event.target.value)} className="control" /></Field>
        <Field label="Meeting type">
          <input list="mi-meeting-types" value={meetingType} onChange={(event) => setMeetingType(event.target.value)} className="control" />
          <datalist id="mi-meeting-types">
            {MEETING_TYPE_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
          </datalist>
        </Field>
        <Field label="Visibility">
          <select
            required
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as MeetingVisibility | "")}
            className="control"
          >
            <option value="">Choose before saving…</option>
            <option value="internal">Internal — never leaves the firm</option>
            <option value="client-visible">Client-visible — may appear in client output</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {visibility === "client-visible"
              ? "This record may be included in client-facing output."
              : "Internal records are excluded from every client-facing export Mi generates."}
          </p>
        </Field>
        <Field label="Record state"><select disabled={Boolean(editing)} value={meetingStatus} onChange={(event) => setMeetingStatus(event.target.value as MeetingNote["meeting_status"])} className="control disabled:opacity-60"><option value="planned">Planned agenda</option><option value="completed">Completed notes</option></select></Field>
        <Field label="Date"><input disabled={Boolean(editing)} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="control disabled:opacity-60" /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label={`Start (${timezone})`}><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="control" /></Field><Field label={`End (${timezone})`}><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="control" /></Field></div>
        <Field label="Attendees (comma or line separated)"><textarea value={attendees} onChange={(event) => setAttendees(event.target.value)} rows={3} className="control" /></Field>
        <Field label="Meeting objective"><textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} className="control" placeholder="What should be true by the end of this meeting?" /></Field>
        <Field label="Preparation (one item per line)"><textarea value={preparation} onChange={(event) => setPreparation(event.target.value)} rows={4} className="control" placeholder={"Review the contract\nBring the latest drawing set"} /></Field>
      </div>
      <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-medium">Timeboxed agenda</h3><p className="text-xs text-muted-foreground">Break the meeting into topics with a clear outcome for each block.{agendaMinutes > 0 ? ` Current total: ${formatHoursAndMinutes(agendaMinutes / 60)}.` : ""}</p></div>
          <button type="button" onClick={() => setAgendaItems((current) => [...current, { topic: "", duration_minutes: 15, desired_outcome: "" }])} className="rounded-md border border-border px-3 py-2 text-xs">Add agenda item</button>
        </div>
        <div className="mt-3 space-y-2">
          {agendaItems.map((item, index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_7rem_1fr_auto]">
            <input aria-label={`Agenda item ${index + 1} topic`} placeholder="Topic" value={item.topic} onChange={(event) => setAgendaItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, topic: event.target.value } : entry))} className="control" />
            <label className="text-xs text-muted-foreground"><span className="mb-1 block">Minutes</span><input aria-label={`Agenda item ${index + 1} minutes`} type="number" min={1} max={480} value={item.duration_minutes} onChange={(event) => setAgendaItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, duration_minutes: Number(event.target.value) } : entry))} className="control" /></label>
            <input aria-label={`Agenda item ${index + 1} outcome`} placeholder="Desired outcome" value={item.desired_outcome} onChange={(event) => setAgendaItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, desired_outcome: event.target.value } : entry))} className="control" />
            <button type="button" onClick={() => setAgendaItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs text-muted-foreground">Remove</button>
          </div>)}
          {agendaItems.length === 0 && <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No agenda items yet. Add them here or ask Mi in project chat to draft a structured work session or client agenda.</p>}
        </div>
      </div>
      <div className="mt-5 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Sources</h3>
            <p className="text-xs text-muted-foreground">
              Attach a transcript, notes, or a file from this record&apos;s folder. The source stays
              attached as evidence — what Mi reads out of it never replaces it.
            </p>
          </div>
          <button type="button" onClick={() => void loadCandidates()} disabled={sourceBusy || !date} className="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-40">
            {date ? "Find files for this date" : "Set the date first"}
          </button>
        </div>

        {candidateNote && <p className="mt-2 text-xs text-muted-foreground">{candidateNote}</p>}
        {candidates.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {candidates.map((candidate) => (
              <li key={candidate.relativePath} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                <span className="min-w-0 break-all">
                  {candidate.relativePath}
                  <span className="text-muted-foreground"> — {candidate.reason}</span>
                </span>
                <button type="button" disabled={sourceBusy} onClick={() => void attachFile(candidate.relativePath)} className="rounded-md border border-border px-2 py-1 disabled:opacity-40">Attach</button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <Field label="Paste a transcript or notes">
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={4} className="control" placeholder="Paste the full transcript here — Mi keeps it whole." />
          </Field>
          <button type="button" disabled={sourceBusy || !pasteText.trim()} onClick={() => void attachPaste()} className="mt-2 rounded-md border border-border px-3 py-2 text-xs disabled:opacity-40">
            {sourceBusy ? "Reading…" : "Attach pasted text"}
          </button>
        </div>

        {sources.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs">
            {sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
                <span className="min-w-0 break-all">
                  {source.label}
                  <span className="text-muted-foreground"> — {source.characters.toLocaleString()} characters read</span>
                </span>
                <button type="button" onClick={() => setSources((current) => current.filter((item) => item.id !== source.id))} className="text-muted-foreground">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5"><Field label="Raw notes during or after the meeting"><textarea value={rawNotes} onChange={(event) => setRawNotes(event.target.value)} rows={6} className="control" /></Field></div>
      {scope === "project" && <button type="button" disabled={!desktop || busy || !rawNotes.trim()} onClick={() => void generateDraft()} className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40">{busy ? "Working…" : "Generate editable AI summary"}</button>}
    </section>

    <section className="rounded-lg border border-border p-5"><h2 className="font-medium">Human-reviewed summary</h2><div className="mt-4 space-y-4">
      <Field label="Summary"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} className="control" /></Field>
      <Field label="Decisions (one per line)"><textarea value={decisions} onChange={(event) => setDecisions(event.target.value)} rows={4} className="control" /></Field>
      <div><div className="flex items-center justify-between"><span className="text-sm font-medium">Action items</span><button type="button" onClick={() => setActions((current) => [...current, { description: "", owner: "", due_date: "" }])} className="text-xs text-muted-foreground hover:underline">Add action</button></div><div className="mt-2 space-y-2">{actions.map((action, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_12rem_auto_auto]"><input placeholder="Action" value={action.description} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} className="control" /><input placeholder="Owner" value={action.owner} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, owner: event.target.value } : item))} className="control" /><input type="date" value={action.due_date} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, due_date: event.target.value } : item))} className="control" /><button type="button" onClick={() => setActions((current) => current.filter((_, i) => i !== index))} className="text-xs text-muted-foreground">Remove</button></div>)}</div></div>
      <Field label="Open questions (one per line)"><textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={4} className="control" /></Field>
    </div><div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void previewLocalSave()} className="rounded-md border border-border px-4 py-2 text-sm">{editing ? "Preview completed meeting update" : "Preview local Markdown save"}</button>{scope === "project" && !editing && <button type="button" disabled={!notionLinked || busy} onClick={() => void previewNotion()} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-40">Preview new linked STUDIO meeting item</button>}</div>{scope === "project" && !notionLinked && !editing && <p className="mt-2 text-xs text-muted-foreground">Notion option unavailable until the project link is human-confirmed.</p>}{editing && <p className="mt-2 text-xs text-muted-foreground">Completing this record updates Mi only. Calendar or Notion changes remain a separate confirmed action.</p>}</section>
    </>}

    {message && <p className="text-sm text-muted-foreground">{message}</p>}{syncResult && <p className="rounded-md border border-border p-3 text-sm">Notion apply report: {syncResult}</p>}
    {confirmation &&<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5"><h2 className="font-medium">{confirmation === "local" ? editing ? "Confirm completed meeting update" : "Confirm local meeting save" : "Confirm linked STUDIO Schedule item"}</h2><p className="mt-2 text-sm text-muted-foreground">{confirmation === "local" ? editing ? `The existing ${title} agenda will become a completed meeting record. Mi will refuse the update if the file changed since you opened it, and will keep a backup of the prior agenda. Notion will not change.` : `A tracked Markdown note will be written under ${scope === "project" ? "projects" : "leads"}/${slug}/meetings/. Notion will not change.` : `A new “${title}” Meeting item dated ${date}, ${startTime}–${endTime} ${timezone}, will be created and related to this exact project. The summary text itself will not be sent.`}</p><div className="mt-4 flex justify-end gap-2"><button onClick={() => setConfirmation(null)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button disabled={busy} onClick={() => void applyConfirmed()} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">{busy ? "Applying…" : "Confirm and apply"}</button></div></div></div>}
    <style jsx>{`.control{width:100%;border:1px solid var(--border);border-radius:.375rem;background:var(--card);padding:.5rem .75rem;font-size:.875rem}`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}</label>;
}
