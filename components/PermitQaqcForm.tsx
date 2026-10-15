"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PermitQaqcEngagement } from "@/lib/schema";

const STATUSES = ["received", "in-review", "response-sent", "resubmitted", "closed"];

const EMPTY_ENGAGEMENT: PermitQaqcEngagement = {
  name: "",
  submitting_firm: "",
  status: "received",
  dropbox_path: null,
  engagement_number: null,
  rounds: [],
  notes: "",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function PermitQaqcForm({
  mode,
  slug,
  initialEngagement,
  initialHash = null,
  onCancel,
}: {
  mode: "create" | "edit";
  slug?: string;
  initialEngagement?: PermitQaqcEngagement;
  /** Captured when this engagement was loaded -- echoed back on save so a concurrent edit is
   * detected instead of silently overwritten. Not used in create mode. */
  initialHash?: string | null;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [engagementSlug, setEngagementSlug] = useState(slug ?? "");
  const [engagement, setEngagement] = useState<PermitQaqcEngagement>(initialEngagement ?? EMPTY_ENGAGEMENT);
  const [expectedHash, setExpectedHash] = useState<string | null>(initialHash);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function set<K extends keyof PermitQaqcEngagement>(key: K, value: PermitQaqcEngagement[K]) {
    setEngagement((current) => ({ ...current, [key]: value }));
  }

  async function performSave(overrideExpectedHash?: "skip-check") {
    setMessage("");
    setConflict(false);
    setSaving(true);
    const payload: PermitQaqcEngagement = {
      ...engagement,
      engagement_number: engagement.engagement_number?.trim() || null,
    };
    const url = mode === "create" ? "/api/permit-qaqc" : `/api/permit-qaqc/${encodeURIComponent(slug ?? "")}`;
    const response = await fetch(url, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "create"
          ? { slug: engagementSlug, engagement: payload }
          : { engagement: payload, expectedHash: overrideExpectedHash === "skip-check" ? undefined : expectedHash },
      ),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setSaving(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string; slug?: string; hash?: string | null };
    if (!response.ok) {
      if (result.error === "conflict") {
        setConflict(true);
        setMessage("This engagement was changed elsewhere since you loaded it. Reload to see the latest, or save over it anyway.");
      } else {
        setMessage(result.error ?? "Engagement could not be saved.");
      }
      setSaving(false);
      return;
    }
    if (mode === "create" && result.slug) {
      router.push(`/permit-qaqc/${result.slug}`);
    } else {
      setMessage("Saved.");
      setExpectedHash(result.hash ?? null);
      router.refresh();
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performSave();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        {mode === "create" && (
          <Field label="Engagement slug">
            <input
              value={engagementSlug}
              onChange={(event) => setEngagementSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="lowercase-path-safe-slug"
              required
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Name (address)">
          <input
            value={engagement.name}
            onChange={(event) => set("name", event.target.value)}
            required
            maxLength={200}
            placeholder="e.g. example-record-13"
            className={inputClass}
          />
        </Field>
        <Field label="Submitting firm">
          <input
            value={engagement.submitting_firm}
            onChange={(event) => set("submitting_firm", event.target.value)}
            required
            maxLength={200}
            placeholder="e.g. SampleConsultant, SampleConsultant+Consultant"
            className={inputClass}
          />
        </Field>
        <Field label="Status">
          <select
            value={engagement.status}
            onChange={(event) => set("status", event.target.value as PermitQaqcEngagement["status"])}
            className={inputClass}
          >
            {STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Engagement number (folder prefix)">
          <input
            value={engagement.engagement_number ?? ""}
            onChange={(event) => set("engagement_number", event.target.value || null)}
            placeholder="e.g. 03 (informational only)"
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Dropbox folder (relative to DROPBOX_ROOT)">
        <input
          value={engagement.dropbox_path ?? ""}
          onChange={(event) => set("dropbox_path", event.target.value || null)}
          placeholder="e.g. example-record-14"
          className={inputClass}
        />
        <span className="text-xs text-muted-foreground">
          This engagement&apos;s real, already-existing Dropbox folder (Received/Sent/Admin/
          Reference). Never guessed — type the exact folder. Run{" "}
          <code>npm run suggest-permit-qaqc-links</code> to list real folders that aren&apos;t
          linked to an engagement yet.
        </span>
      </Field>
      <Field label="Notes">
        <textarea
          value={engagement.notes ?? ""}
          onChange={(event) => set("notes", event.target.value)}
          rows={5}
          className={inputClass}
        />
      </Field>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {conflict && (
        <div className="flex gap-2">
          <button type="button" onClick={() => router.refresh()} className="rounded-md border border-border px-3 py-2 text-sm">
            Reload
          </button>
          <button type="button" disabled={saving} onClick={() => void performSave("skip-check")} className="rounded-md border border-border px-3 py-2 text-sm">
            Save over it anyway
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
