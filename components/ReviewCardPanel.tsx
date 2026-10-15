"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadMiProfile } from "@/components/profilePreferences";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";
import type { ReviewDestinationKind } from "@/lib/content/reviewInbox";

const STATUS_STYLES: Record<string, string> = {
  pending: "border-accent/60 bg-accent/10 text-accent",
  applied: "border-border bg-muted text-muted-foreground",
  dismissed: "border-border bg-muted text-muted-foreground",
  superseded: "border-border bg-muted text-muted-foreground",
  failed: "border-destructive/60 bg-destructive/10 text-destructive",
};

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${className || "border-border bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

/**
 * One review card, everywhere it appears.
 *
 * The same component renders in the mailbox and in a record's Pending Review panel so that
 * the two can never drift into showing different things about the same card — the panel
 * existing at all is only useful if acting there is identical to acting in the mailbox.
 *
 * Nothing in here applies anything on click. Every destination button opens the preview
 * below it, and only the button inside that preview — with the record, the field, the
 * existing content, and the proposed content on screen — actually writes.
 */
export function ReviewCardPanel({ view, defaultOpen = false }: {
  view: ReviewCardView;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { card, content, meeting, destinations, confirmation } = view;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingDestination, setPendingDestination] = useState<ReviewDestinationKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: content?.title ?? "",
    body: content?.body ?? "",
    why: content?.why ?? "",
  });
  const [expanded, setExpanded] = useState(defaultOpen);
  const [reviewedBy, setReviewedBy] = useState("");

  useEffect(() => {
    // The reviewer's name lives in localStorage, which the server render cannot see. Reading
    // it after mount is what keeps the audit line correct without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only profile read
    if (typeof window !== "undefined") setReviewedBy(loadMiProfile(window.localStorage).displayName);
  }, []);

  const preview = useMemo(
    () => destinations.find((option) => option.ref.kind === pendingDestination) ?? null,
    [destinations, pendingDestination],
  );

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/review-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: view.workspace.kind,
          slug: view.workspace.slug,
          cardId: card.id,
          reviewedBy,
          ...payload,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The action could not be completed.");
      setMessage(data.message ?? "Done.");
      setPendingDestination(null);
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
    } finally {
      setBusy("");
    }
  }

  const isPending = card.status === "pending";
  const isFailed = card.status === "failed";
  const timing = view.timing;

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip className={STATUS_STYLES[card.status]}>{card.status}</Chip>
        {card.entry_kind && <Chip>{card.entry_kind}</Chip>}
        {card.visibility && (
          <Chip className={card.visibility === "internal" ? "border-border bg-muted text-muted-foreground" : "border-accent/50 bg-accent/10 text-accent"}>
            {card.visibility === "internal" ? "Internal" : "Client-visible"}
          </Chip>
        )}
        <Link href={view.workspace.href} className="text-xs text-link underline-offset-2 hover:underline">
          {view.workspace.label}
        </Link>
        {card.parent_id && <span className="text-xs text-muted-foreground">split from a meeting card</span>}
      </div>

      <h3 className="mt-2 text-sm font-medium">{content?.title || card.source.file_name}</h3>
      {card.status === "applied" && card.destination?.kind === "project-notes" && view.workspace.kind === "project" && (
        <Link href={`/projects/${view.workspace.slug}/knowledge`} className="mt-2 inline-block text-sm text-link underline">Open saved project knowledge</Link>
      )}
      {timing && <p className="mt-0.5 text-xs text-muted-foreground">{timing}</p>}

      {isFailed && card.failure && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">
            {card.failure.stage === "import" ? "This file could not be imported" : "This card could not be applied"}
          </p>
          <p className="mt-1 text-muted-foreground">{card.failure.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            File: {card.source.path} · The original file was not changed or deleted.
          </p>
        </div>
      )}

      {meeting ? (
        <div className="mt-3 text-sm">
          {meeting.attendees.length > 0 && (
            <p><span className="text-muted-foreground">Attendees:</span> {meeting.attendees.join(", ")}</p>
          )}
          {meeting.summary && <p className="mt-2 whitespace-pre-line">{meeting.summary}</p>}
          <Bullets title="Decisions" items={meeting.decisions} />
          {meeting.actionItems.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Action items</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {meeting.actionItems.map((item, index) => (
                  <li key={`action-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{item.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.owner ? `owner ${item.owner}` : "owner not stated"}
                      {" · "}
                      {item.dueDate ? `due ${item.dueDate}` : "no due date"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Bullets title="Open questions" items={meeting.openQuestions} />
          <Bullets title="Risks" items={meeting.risks} />
          {meeting.remainder && <p className="mt-3 whitespace-pre-line text-sm">{meeting.remainder}</p>}
        </div>
      ) : (
        content && (
          <p className="mt-2 whitespace-pre-line text-sm">
            {expanded || content.body.length <= 400 ? content.body : `${content.body.slice(0, 400)}…`}
            {content.body.length > 400 && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                className="ml-2 text-xs text-link underline-offset-2 hover:underline"
              >
                {expanded ? "Show less" : "Show all"}
              </button>
            )}
          </p>
        )
      )}

      {content?.why && <p className="mt-2 text-sm text-muted-foreground">Why: {content.why}</p>}

      {content && content.evidence.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Evidence: {content.evidence.map((item) => item.path ?? item.quote).filter(Boolean).join(" · ")}
        </p>
      )}

      {/*
        Folded away rather than deleted. Which agent, which session and which file an entry
        came from is what makes a confirmed write auditable months later -- and it is also
        four lines of dense grey on every card in a queue, repeated for entries that are all
        from the same session. It stays one click from the claim it supports.
      */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Where this came from
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">
          {card.source.agent ? `Recorded by ${card.source.agent}` : "Recorded"}
          {card.source.session_id && ` · session ${card.source.session_id}`}
          {card.source.created_at && ` · ${card.source.created_at.slice(0, 16).replace("T", " ")}`}
          {" · "}imported {card.imported_at.slice(0, 10)} · {card.source.path}
        </p>
      </details>

      {card.edited && (
        <p className="mt-1 text-xs text-accent">Edited before confirmation. The original entry file is unchanged.</p>
      )}

      {isPending && confirmation.required && (
        <p className="mt-2 text-xs text-muted-foreground">
          Always needs your confirmation — {confirmation.reason}
        </p>
      )}

      {card.status === "applied" && (
        <p className="mt-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
          Applied {card.reviewed_at?.slice(0, 16).replace("T", " ")}
          {card.reviewed_by ? ` by ${card.reviewed_by}` : ""}
          {card.destination ? ` → ${card.destination.record}` : ""}. {card.result}
        </p>
      )}
      {(card.status === "dismissed" || card.status === "superseded") && (
        <p className="mt-2 text-xs text-muted-foreground">
          {card.status === "dismissed" ? "Dismissed" : "Superseded"}{" "}
          {card.reviewed_at?.slice(0, 16).replace("T", " ")}
          {card.reviewed_by ? ` by ${card.reviewed_by}` : ""}. No record was changed.
          {card.result ? ` ${card.result}` : ""}
        </p>
      )}

      {message && <p className="mt-3 rounded-md border border-accent/50 bg-accent/10 p-2 text-sm">{message}</p>}
      {error && <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 p-2 text-sm">{error}</p>}

      {editing && content && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Editing changes only what Mi would write. The agent&apos;s original entry file stays exactly as it is.
          </p>
          <label className="text-xs text-muted-foreground">
            Title
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Body
            <textarea
              value={draft.body}
              rows={8}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Why it should be recorded
            <textarea
              value={draft.why}
              rows={2}
              onChange={(event) => setDraft((current) => ({ ...current, why: event.target.value }))}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => post({
                action: "edit",
                content: { ...content, title: draft.title, body: draft.body, why: draft.why },
              }, "edit")}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-60"
            >
              {busy === "edit" ? "Saving…" : "Save edit"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-md border border-accent/60 bg-accent/5 p-3">
          <h4 className="text-sm font-medium">Confirm this change</h4>
          <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Record and field</dt>
              <dd className="font-mono">{preview.record}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">How it is written</dt>
              <dd>{preview.mode === "append" ? "Appended as a new dated section — existing content is preserved" : "Replaces the field's current value"}</dd>
            </div>
          </dl>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Existing content</p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs">
                {preview.current || "(empty)"}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {preview.mode === "append" ? "What gets added" : "Proposed value"}
              </p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-accent/50 bg-background p-2 text-xs">
                {preview.proposed}
              </pre>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => post({ action: "confirm", destination: preview.ref.kind, confirmed: true }, "confirm")}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-60"
            >
              {busy === "confirm" ? "Saving…" : preview.ref.kind === "project-notes" ? "Confirm and save project knowledge" : `Confirm and write to ${preview.record}`}
            </button>
            <button
              type="button"
              onClick={() => setPendingDestination(null)}
              className="rounded-md border border-border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <span className="text-xs text-muted-foreground">
              Recorded as reviewed by {reviewedBy || "an unnamed Mi user"}.
            </span>
          </div>
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap gap-2">
          {destinations.map((option) => (
            <button
              key={option.ref.kind}
              type="button"
              disabled={!option.available || busy !== ""}
              title={option.available ? option.record : option.unavailableReason}
              onClick={() => setPendingDestination(option.ref.kind)}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => setEditing((open) => !open)}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
          >
            Edit before confirming
          </button>
          {view.splitPreview.length > 1 && (
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => post({ action: "split" }, "split")}
              title={view.splitPreview.map((part) => `${part.kind}: ${part.title}`).join("\n")}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
            >
              {busy === "split" ? "Splitting…" : `Split into ${view.splitPreview.length} cards`}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => post({ action: "dismiss" }, "dismiss")}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => post({ action: "duplicate" }, "duplicate")}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
          >
            Mark as duplicate
          </button>
        </div>
      )}

      {isFailed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => post({ action: "retry" }, "retry")}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
          >
            {busy === "retry" ? "Retrying…" : "Retry import"}
          </button>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => post({ action: "dismiss", reason: "Failed import cleared." }, "dismiss")}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
          >
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}
