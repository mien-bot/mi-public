"use client";

import { formatHoursAndMinutes } from "@/lib/duration";
import { meetingAgendaMinutes } from "@/lib/meetingAgenda";
import { formatMeetingTimeRange } from "@/lib/meetingTime";
import type { MeetingNoteRecord } from "@/lib/content/meetingNoteFile";
import type { MeetingNote } from "@/lib/schema";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";

export function MeetingRecordList({ records, onTakeNotes, onDelete }: {
  records: MeetingNoteRecord[];
  onTakeNotes?: (record: MeetingNoteRecord) => void;
  /**
   * Removes the note. Optional so read-only surfaces render exactly as before; supplied by
   * the project and lead meeting workspaces, which are the two places a mis-filed meeting
   * actually needs taking back.
   */
  onDelete?: (record: MeetingNoteRecord) => Promise<void>;
}) {
  if (records.length === 0) return null;
  const planned = records.filter(({ meeting }) => meeting.meeting_status === "planned");
  const completed = records.filter(({ meeting }) => meeting.meeting_status === "completed");

  return (
    <div className="space-y-6">
      {planned.length > 0 && (
        <section>
          <div>
            <h2 className="font-medium">Meeting agendas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep Mi on screen as the live agenda, then use Take notes to complete the same record.
            </p>
          </div>
          <div className="mt-3 space-y-3">
            {planned.map((record) => (
              <MeetingRecord
                key={`${record.meeting.date}-${record.meeting.id}`}
                meeting={record.meeting}
                open
                onTakeNotes={onTakeNotes ? () => onTakeNotes(record) : undefined}
                onDelete={onDelete ? () => onDelete(record) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <h2 className="font-medium">Completed meeting notes</h2>
          <div className="mt-3 space-y-3">
            {completed.map((record) => (
              <MeetingRecord
                key={`${record.meeting.date}-${record.meeting.id}`}
                meeting={record.meeting}
                onDelete={onDelete ? () => onDelete(record) : undefined}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MeetingRecord({ meeting, open = false, onTakeNotes, onDelete }: {
  meeting: MeetingNote;
  open?: boolean;
  onTakeNotes?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const agendaMinutes = meetingAgendaMinutes(meeting.agenda_items);
  const hasOutcomes = Boolean(
    meeting.summary || meeting.decisions.length || meeting.action_items.length || meeting.open_questions.length || meeting.raw_notes,
  );

  return (
    <details open={open} className="group rounded-lg border border-border bg-card">
      <summary className="cursor-pointer list-none p-4 marker:content-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{meeting.title}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {meeting.meeting_status === "planned" ? "Planned" : "Completed"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {meeting.date} · {formatMeetingTimeRange(meeting.start_time, meeting.end_time)} · {meeting.timezone}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {meeting.meeting_type}
              {meeting.attendees.length > 0 ? ` · ${meeting.attendees.join(", ")}` : " · Attendees unconfirmed"}
              {agendaMinutes > 0 ? ` · ${formatHoursAndMinutes(agendaMinutes / 60)} agenda` : ""}
            </p>
          </div>
          <span className="text-xs text-muted-foreground group-open:hidden">Open agenda and notes</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">Hide details</span>
        </div>
      </summary>

      <div className="border-t border-border p-4">
        {onDelete && (
          <div className="mb-4 flex justify-end">
            <DeleteRecordButton prompt="Delete this meeting note?" onDelete={onDelete} />
          </div>
        )}
        {meeting.objective && (
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objective</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm">{meeting.objective}</p>
          </section>
        )}

        {meeting.preparation.length > 0 && (
          <section className="mt-5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Before the meeting</h4>
            <ul className="mt-2 space-y-2 text-sm">
              {meeting.preparation.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">□</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {meeting.agenda_items.length > 0 && (
          <section className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agenda</h4>
              <span className="text-xs text-muted-foreground">{formatHoursAndMinutes(agendaMinutes / 60)} total</span>
            </div>
            <ol className="mt-2 divide-y divide-border rounded-md border border-border">
              {meeting.agenda_items.map((item, index) => (
                <li key={`${item.topic}-${index}`} className="grid gap-2 p-3 sm:grid-cols-[2rem_1fr_auto]">
                  <span className="text-sm tabular-nums text-muted-foreground">{index + 1}.</span>
                  <div>
                    <p className="text-sm font-medium">{item.topic}</p>
                    {item.desired_outcome && <p className="mt-1 text-xs text-muted-foreground">Outcome: {item.desired_outcome}</p>}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{item.duration_minutes} min</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {meeting.meeting_status === "planned" && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
            <p className="text-xs text-muted-foreground">
              This is a meeting plan. Take notes to preserve its agenda and complete this same record.
            </p>
            {onTakeNotes && (
              <button type="button" onClick={onTakeNotes} className="rounded-md bg-foreground px-3 py-2 text-xs text-background">
                Take notes
              </button>
            )}
          </div>
        )}

        {hasOutcomes && (
          <section className="mt-5 border-t border-border pt-5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meeting record</h4>
            {meeting.summary && <p className="mt-2 whitespace-pre-wrap text-sm">{meeting.summary}</p>}
            <OutcomeList title="Decisions" values={meeting.decisions} />
            {meeting.action_items.length > 0 && (
              <div className="mt-4">
                <h5 className="text-sm font-medium">Action items</h5>
                <ul className="mt-2 space-y-2 text-sm">
                  {meeting.action_items.map((item, index) => (
                    <li key={`${item.description}-${index}`}>
                      <span>{item.description}</span>
                      {(item.owner || item.due_date) && (
                        <span className="text-muted-foreground">
                          {item.owner ? ` — ${item.owner}` : ""}{item.due_date ? ` · due ${item.due_date}` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <OutcomeList title="Open questions" values={meeting.open_questions} />
            {meeting.raw_notes && (
              <details className="mt-4 rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">Raw notes</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{meeting.raw_notes}</p>
              </details>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

function OutcomeList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-4">
      <h5 className="text-sm font-medium">{title}</h5>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
      </ul>
    </div>
  );
}
