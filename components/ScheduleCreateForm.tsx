"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCalendarScheduleProposal,
  scheduleProjectOptions,
  type ScheduleAttendeeOption,
  type ScheduleProjectOption,
} from "@/components/scheduleCreateDraft";
import { readJsonResponse } from "@/lib/readJsonResponse";
import { ActivityIndicator } from "@/components/UiState";
import { scheduleTypeSchema, type ScheduleType } from "@/lib/schema";
import { usePersonalTimezone } from "./usePersonalTimezone";

export function ScheduleCreateForm({
  initialDate,
  onCancel,
  onApplied,
}: {
  initialDate: string;
  onCancel: () => void;
  onApplied?: () => boolean | void | Promise<boolean | void>;
}) {
  const { timezone } = usePersonalTimezone();
  const [name, setName] = useState("");
  const [date, setDate] = useState(initialDate);
  const [type, setType] = useState<ScheduleType>("Meeting");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [projectPageId, setProjectPageId] = useState("");
  const [projects, setProjects] = useState<ScheduleProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [attendees, setAttendees] = useState<ScheduleAttendeeOption[]>([]);
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(true);
  const [attendeesError, setAttendeesError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/chat/projects", { cache: "no-store" })
      .then((response) => readJsonResponse<unknown>(response, "Mi could not load the project picker."))
      .then((payload) => {
        if (!cancelled) setProjects(scheduleProjectOptions(payload));
      })
      .catch((cause) => {
        if (!cancelled) setProjectsError(cause instanceof Error ? cause.message : "Mi could not load the project picker.");
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/notion/people", { cache: "no-store" })
      .then((response) => readJsonResponse<{ people?: ScheduleAttendeeOption[] }>(response, "Mi could not load Notion people."))
      .then((payload) => {
        if (!cancelled) setAttendees(Array.isArray(payload.people) ? payload.people : []);
      })
      .catch((cause) => {
        if (!cancelled) setAttendeesError(cause instanceof Error ? cause.message : "Mi could not load Notion people.");
      })
      .finally(() => {
        if (!cancelled) setAttendeesLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.notionPageId === projectPageId) ?? null,
    [projectPageId, projects],
  );

  function clearResult() {
    setError("");
    setMessage("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const selectedAttendees = attendees.filter((attendee) => attendeeIds.includes(attendee.id));
      const proposal = buildCalendarScheduleProposal({ name, date, type, startTime, endTime, project: selectedProject, attendees: selectedAttendees, timezone });
      setError("");
      const response = await fetch("/api/schedule/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal, confirmed: true }),
      });
      const body = await readJsonResponse<{ message?: string }>(
        response,
        "The event could not be added.",
      );
      const synced = await Promise.resolve(onApplied?.());
      setMessage(`${body.message ?? "Added to the STUDIO Schedule."}${synced === true ? " Calendar synced." : synced === false ? " Use Sync now to refresh the calendar." : ""}`);
      setName("");
      setStartTime("");
      setEndTime("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The event could not be added.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Add STUDIO Schedule event</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The calendar date is preselected. Choose a confirmed project, or leave it personal / firm-wide, then add the event to Notion.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-accent">
          Close
        </button>
      </div>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="sm:col-span-2 lg:col-span-1">
          <span className="text-xs font-medium">Event name</span>
          <input
            required
            maxLength={160}
            value={name}
            disabled={saving}
            onChange={(event) => { clearResult(); setName(event.target.value); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        <label>
          <span className="text-xs font-medium">Date</span>
          <input
            required
            type="date"
            value={date}
            disabled={saving}
            onChange={(event) => { clearResult(); setDate(event.target.value); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>

        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="text-xs font-medium">Attendance <span className="font-normal text-muted-foreground">(optional)</span></legend>
          <div className="mt-1 max-h-28 overflow-y-auto rounded-md border border-border bg-card p-2">
            {attendeesLoading ? (
              <ActivityIndicator label="Loading people from Notion…" className="text-xs" />
            ) : attendees.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {attendees.map((attendee) => (
                  <label key={attendee.id} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={attendeeIds.includes(attendee.id)}
                      disabled={saving}
                      onChange={(event) => {
                        clearResult();
                        setAttendeeIds((current) => event.target.checked
                          ? [...current, attendee.id]
                          : current.filter((id) => id !== attendee.id));
                      }}
                    />
                    <span>
                      {attendee.name}
                      {attendee.email && (
                        <span className="ml-1 text-xs text-muted-foreground">{attendee.email}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No people are available to the Notion integration.</p>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            STUDIO Schedule members, plus anyone already recorded in Attendance or on a project team —
            that last part is how Notion <em>guests</em> appear here at all, since Notion never lists them.
            Someone still missing has not been added to the Notion workspace yet.
          </p>
        </fieldset>
        <label>
          <span className="text-xs font-medium">Type</span>
          <select
            value={type}
            disabled={saving}
            onChange={(event) => { clearResult(); setType(event.target.value as ScheduleType); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          >
            {scheduleTypeSchema.options.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span className="text-xs font-medium">Start time <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input
            type="time"
            value={startTime}
            disabled={saving}
            onChange={(event) => { clearResult(); setStartTime(event.target.value); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        <label>
          <span className="text-xs font-medium">End time <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input
            type="time"
            value={endTime}
            disabled={saving}
            onChange={(event) => { clearResult(); setEndTime(event.target.value); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>
        <label>
          <span className="text-xs font-medium">Project <span className="font-normal text-muted-foreground">(optional)</span></span>
          <select
            value={projectPageId}
            disabled={saving || projectsLoading}
            onChange={(event) => { clearResult(); setProjectPageId(event.target.value); }}
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">Personal / firm-wide (no project)</option>
            {projects.map((project) => (
              <option key={project.notionPageId} value={project.notionPageId}>{project.name}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={projectsLoading || saving}
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50"
          >
            {saving ? <ActivityIndicator label="Adding to Notion…" className="text-accent-foreground" /> : "Add to schedule"}
          </button>
          {projectsLoading && <ActivityIndicator label="Loading confirmed projects…" className="text-xs" />}
        </div>
      </form>

      {projectsError && <p className="mt-3 text-xs text-status-danger-foreground">{projectsError} Firm-wide events remain available.</p>}
      {attendeesError && <p className="mt-3 text-xs text-status-danger-foreground">{attendeesError} You can still add the event without attendance.</p>}
      {error && <p className="mt-3 text-xs text-status-danger-foreground">{error}</p>}
      {message && <p role="status" className="mt-3 text-xs text-status-success-foreground">{message}</p>}
    </div>
  );
}
