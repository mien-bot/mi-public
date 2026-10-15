"use client";

import { useState } from "react";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";
import { useRouter } from "next/navigation";
import type {
  ProjectDeliverable,
  ProjectDeliverableKind,
  ProjectDeliverableStatus,
} from "@/lib/schema";

const KIND_LABELS: Record<ProjectDeliverableKind, string> = {
  presentation: "Presentation",
  plot: "Plot set",
  other: "Other",
};

const STATUS_LABELS: Record<ProjectDeliverableStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  superseded: "Superseded",
};

const CONTROL = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

interface Draft {
  id: string;
  kind: ProjectDeliverableKind;
  title: string;
  issuedDate: string;
  audience: string;
  packagePath: string;
  spaces: string;
  status: ProjectDeliverableStatus;
  supersededBy: string;
  notes: string;
}

function emptyDraft(): Draft {
  return {
    id: "",
    kind: "presentation",
    title: "",
    issuedDate: "",
    audience: "",
    packagePath: "",
    spaces: "",
    status: "draft",
    supersededBy: "",
    notes: "",
  };
}

function toDraft(deliverable: ProjectDeliverable): Draft {
  return {
    id: deliverable.id,
    kind: deliverable.kind,
    title: deliverable.title,
    issuedDate: deliverable.issued_date ?? "",
    audience: deliverable.audience,
    packagePath: deliverable.package_path ?? "",
    spaces: deliverable.spaces.join(", "),
    status: deliverable.status,
    supersededBy: deliverable.superseded_by ?? "",
    notes: deliverable.notes,
  };
}

/**
 * Blank stays blank. Every optional field goes to null/"" rather than being back-filled from a
 * sibling field or a path, so an unconfirmed date or audience reads as unknown in the record
 * instead of becoming a plausible-looking invention.
 */
function fromDraft(draft: Draft): ProjectDeliverable {
  return {
    id: draft.id.trim(),
    kind: draft.kind,
    title: draft.title.trim(),
    issued_date: draft.issuedDate.trim() || null,
    audience: draft.audience.trim(),
    package_path: draft.packagePath.trim() || null,
    spaces: draft.spaces.split(",").map((space) => space.trim()).filter(Boolean),
    status: draft.status,
    superseded_by: draft.supersededBy.trim() || null,
    notes: draft.notes.trim(),
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ProjectDeliverableRegister({
  slug,
  initialDeliverables,
  initialHash,
}: {
  slug: string;
  initialDeliverables: ProjectDeliverable[];
  initialHash: string | null;
}) {
  const router = useRouter();
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [hash, setHash] = useState(initialHash);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function startNew() {
    setDraft(emptyDraft());
    setEditingId(null);
    setMessage("");
  }

  function startEdit(deliverable: ProjectDeliverable) {
    setDraft(toDraft(deliverable));
    setEditingId(deliverable.id);
    setMessage("");
  }

  function cancel() {
    setDraft(null);
    setEditingId(null);
    setMessage("");
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/deliverables`, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverable: fromDraft(draft),
        id: editingId ?? undefined,
        expectedHash: hash,
        confirmed: true,
      }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setSaving(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      deliverable?: ProjectDeliverable;
      hash?: string | null;
    };
    if (!response.ok || !result.deliverable) {
      setMessage(result.error ?? "The deliverable could not be saved.");
      setSaving(false);
      return;
    }
    const saved = result.deliverable;
    setDeliverables((current) => (editingId
      ? current.map((entry) => (entry.id === editingId ? saved : entry))
      : [saved, ...current]));
    setHash(result.hash ?? null);
    setDraft(null);
    setEditingId(null);
    setSaving(false);
    router.refresh();
  }

  /**
   * Removes one row from the register. Throws on failure so DeleteRecordButton can show the
   * reason inline — a hash conflict here means someone else added a deliverable since this
   * page loaded, which the person needs to read rather than have swallowed.
   */
  async function removeDeliverable(id: string) {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/deliverables`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, id, expectedHash: hash }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "The deliverable could not be deleted.");
    setDeliverables((current) => current.filter((entry) => entry.id !== id));
    setHash(data.hash ?? null);
    setMessage("Deliverable deleted.");
  }

  return (
    <div className="flex flex-col gap-4">
      {!draft && (
        <div>
          <button
            type="button"
            onClick={startNew}
            className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent"
          >
            Record a deliverable
          </button>
        </div>
      )}

      {draft && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">{editingId ? `Edit ${editingId}` : "New deliverable"}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Id" hint="Stable, lowercase, e.g. 2026-08-05-schematic-deck. Cannot change later.">
              <input
                className={CONTROL}
                value={draft.id}
                disabled={Boolean(editingId)}
                onChange={(event) => setDraft({ ...draft, id: event.target.value })}
              />
            </Field>
            <Field label="Title">
              <input
                className={CONTROL}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </Field>
            <Field label="Kind">
              <select
                className={CONTROL}
                value={draft.kind}
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as ProjectDeliverableKind })}
              >
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                className={CONTROL}
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectDeliverableStatus })}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Issued date" hint="Leave blank until the date it went out is confirmed.">
              <input
                className={CONTROL}
                type="date"
                value={draft.issuedDate}
                onChange={(event) => setDraft({ ...draft, issuedDate: event.target.value })}
              />
            </Field>
            <Field label="Audience" hint="Who received it. Blank if unconfirmed.">
              <input
                className={CONTROL}
                value={draft.audience}
                onChange={(event) => setDraft({ ...draft, audience: event.target.value })}
              />
            </Field>
            <Field label="Package folder" hint="Relative to this project's folder, e.g. 04_Presentation/2026-08-05 Client Review. Confirm it yourself; Mi never fills this in.">
              <input
                className={CONTROL}
                value={draft.packagePath}
                onChange={(event) => setDraft({ ...draft, packagePath: event.target.value })}
              />
            </Field>
            <Field label="Spaces covered" hint="Comma separated.">
              <input
                className={CONTROL}
                value={draft.spaces}
                onChange={(event) => setDraft({ ...draft, spaces: event.target.value })}
              />
            </Field>
            <Field label="Superseded by" hint="Id of the deliverable that replaced this one.">
              <input
                className={CONTROL}
                value={draft.supersededBy}
                onChange={(event) => setDraft({ ...draft, supersededBy: event.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Notes">
              <textarea
                className={`${CONTROL} min-h-24`}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </Field>
          </div>
          {message && <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="rounded-md border border-accent px-3 py-2 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Confirm and save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancel}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {deliverables.length === 0 && !draft && (
        <p className="text-sm text-muted-foreground">
          No deliverables recorded yet. This register is Mi&apos;s record of what went out — it does
          not scan the Dropbox folder, so a package exists here only once someone records it.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {deliverables.map((deliverable) => (
          <li key={deliverable.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{deliverable.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {KIND_LABELS[deliverable.kind]} · {STATUS_LABELS[deliverable.status]} ·{" "}
                  {deliverable.issued_date ?? "date not confirmed"}
                  {deliverable.audience && ` · to ${deliverable.audience}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(deliverable)}
                  className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent"
                >
                  Edit
                </button>
                <DeleteRecordButton
                  disabled={saving}
                  prompt="Delete this deliverable?"
                  recoverableNote="The register's previous revision is kept on disk."
                  onDelete={() => removeDeliverable(deliverable.id)}
                />
              </div>
            </div>
            {deliverable.spaces.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Spaces: {deliverable.spaces.join(", ")}</p>
            )}
            <p className="mt-2 break-all text-xs text-muted-foreground">
              {deliverable.package_path ?? "Package folder not linked"}
            </p>
            {deliverable.superseded_by && (
              <p className="mt-2 text-xs text-muted-foreground">Superseded by {deliverable.superseded_by}</p>
            )}
            {deliverable.notes && <p className="mt-2 text-sm">{deliverable.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
