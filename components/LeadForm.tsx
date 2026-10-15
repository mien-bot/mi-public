"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/schema";

/**
 * Matches the YY_MMDD_ convention already confirmed against real Dropbox/Notion
 * project naming (see app/api/projects/next-numbering/route.ts) — leading a lead's
 * Dropbox folder name with its received date keeps a long, growing lead list sorted
 * chronologically at a glance instead of alphabetically by address.
 */
function dateStampPrefix(dateReceived: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateReceived)) return "";
  return `${dateReceived.slice(2, 4)}_${dateReceived.slice(5, 7)}${dateReceived.slice(8, 10)}_`;
}

const SOURCES = ["referral", "website", "past-client", "cold-outreach", "social", "other"];
const STATUSES = ["new", "qualified", "proposal-sent", "won", "lost", "on-hold"];
const CONTRACT_STAGES = ["not-sent", "sent", "under-negotiation", "signed"];

const EMPTY_LEAD: Lead = {
  name: "",
  source: "other",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  referrer_name: "",
  date_received: new Date().toISOString().slice(0, 10),
  status: "new",
  estimated_value: null,
  notes: "",
  lost_reason: null,
  converted_project_slug: null,
  converted_date: null,
  dropbox_path: null,
  contract_stage: "not-sent",
  contract_notes: "",
  notion_page_id: null,
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function LeadForm({
  mode,
  slug,
  initialLead,
  initialHash = null,
  projectSlugs,
  onCancel,
}: {
  mode: "create" | "edit";
  slug?: string;
  initialLead?: Lead;
  /** Captured when this lead was loaded -- echoed back on save so a concurrent edit (another
   * Mi instance sharing this firm's Dropbox-migrated leads) is detected instead of silently
   * overwritten. Not used in create mode (there's nothing to conflict with yet). */
  initialHash?: string | null;
  projectSlugs: string[];
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [leadSlug, setLeadSlug] = useState(slug ?? "");
  const [lead, setLead] = useState<Lead>(initialLead ?? EMPTY_LEAD);
  const [estimatedValue, setEstimatedValue] = useState(
    lead.estimated_value === null ? "" : String(lead.estimated_value),
  );
  const [expectedHash, setExpectedHash] = useState<string | null>(initialHash);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropboxAction, setDropboxAction] = useState<"create" | "link-existing" | "none">(
    mode === "create" ? "create" : initialLead?.dropbox_path ? "link-existing" : "none",
  );
  const [confirmingDropbox, setConfirmingDropbox] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
  }, []);

  function set<K extends keyof Lead>(key: K, value: Lead[K]) {
    setLead((current) => ({ ...current, [key]: value }));
  }

  async function chooseExistingDropboxFolder() {
    const result = await window.electronAPI?.dropbox.pickProjectFolder();
    if (!result || result.canceled) return;
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (result.relativePath) {
      set("dropbox_path", result.relativePath);
      setDropboxAction("link-existing");
      setMessage("Selected an existing Dropbox folder. It will not be changed.");
    }
  }

  async function performSave(overrideExpectedHash?: "skip-check", dropboxConfirmed = false) {
    setMessage("");
    setConflict(false);
    const convertedProject = lead.converted_project_slug?.trim() || null;
    const convertedDate = lead.converted_date || null;
    if (Boolean(convertedProject) !== Boolean(convertedDate)) {
      setMessage("Converted project and converted date must be supplied together.");
      return;
    }
    const numericValue = estimatedValue.trim() === "" ? null : Number(estimatedValue);
    if (numericValue !== null && (!Number.isFinite(numericValue) || numericValue < 0)) {
      setMessage("Estimated value must be a non-negative number or blank.");
      return;
    }
    const requestedDropboxPath = dropboxAction === "none" ? null : lead.dropbox_path?.trim() || null;
    if (mode === "create" && dropboxAction !== "none" && !requestedDropboxPath) {
      setMessage(dropboxAction === "create"
        ? "Enter the Dropbox folder to create, or choose no Dropbox folder yet."
        : "Search for and select the existing Dropbox folder, or enter its exact relative path.");
      return;
    }
    if (mode === "create" && requestedDropboxPath && !dropboxConfirmed) {
      setConfirmingDropbox(true);
      return;
    }

    setSaving(true);
    const payload: Lead = {
      ...lead,
      dropbox_path: requestedDropboxPath,
      estimated_value: numericValue,
      lost_reason: lead.lost_reason?.trim() || null,
      converted_project_slug: convertedProject,
      converted_date: convertedDate,
    };
    const url = mode === "create" ? "/api/leads" : `/api/leads/${encodeURIComponent(slug ?? "")}`;
    const response = await fetch(url, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "create"
          ? { slug: leadSlug, lead: payload, dropboxAction, dropboxConfirmed }
          : { lead: payload, expectedHash: overrideExpectedHash === "skip-check" ? undefined : expectedHash },
      ),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setSaving(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      slug?: string;
      hash?: string | null;
      notionSynced?: boolean;
      notionError?: string | null;
      dropboxError?: string | null;
    };
    if (!response.ok) {
      if (result.error === "conflict") {
        setConflict(true);
        setMessage("This lead was changed elsewhere since you loaded it. Reload to see the latest, or save over it anyway.");
      } else {
        setMessage(result.error ?? "Lead could not be saved.");
      }
      setSaving(false);
      return;
    }
    const notionNote = result.notionSynced
      ? " Synced to Notion."
      : result.notionError
        ? ` Notion sync failed: ${result.notionError}`
        : "";
    if (mode === "create" && result.slug) {
      setConfirmingDropbox(false);
      router.push(result.dropboxError ? `/leads/${result.slug}/dropbox` : `/leads/${result.slug}`);
    } else {
      setMessage(`Saved.${notionNote}`);
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
          <Field label="Lead slug">
            <input
              value={leadSlug}
              onChange={(event) => setLeadSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="lowercase-path-safe-slug"
              required
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Name">
          <input
            value={lead.name}
            onChange={(event) => set("name", event.target.value)}
            required
            maxLength={200}
            className={inputClass}
          />
        </Field>
        <Field label="Source">
          <select
            value={lead.source}
            onChange={(event) => set("source", event.target.value as Lead["source"])}
            className={inputClass}
          >
            {SOURCES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={lead.status}
            onChange={(event) => set("status", event.target.value as Lead["status"])}
            className={inputClass}
          >
            {STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Contract stage">
          <select
            value={lead.contract_stage}
            onChange={(event) => set("contract_stage", event.target.value as Lead["contract_stage"])}
            className={inputClass}
          >
            {CONTRACT_STAGES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Received date">
          <input
            type="date"
            value={lead.date_received}
            onChange={(event) => set("date_received", event.target.value)}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Contact name (owner)">
          <input
            value={lead.contact_name ?? ""}
            onChange={(event) => set("contact_name", event.target.value)}
            placeholder="The property owner / decision-maker"
            className={inputClass}
          />
        </Field>
        <Field label="Referred by">
          <input
            value={lead.referrer_name}
            onChange={(event) => set("referrer_name", event.target.value)}
            placeholder="Who brought us this lead (may also collaborate)"
            className={inputClass}
          />
        </Field>
        <Field label="Contact email">
          <input
            type="email"
            value={lead.contact_email ?? ""}
            onChange={(event) => set("contact_email", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Contact phone">
          <input
            value={lead.contact_phone ?? ""}
            onChange={(event) => set("contact_phone", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Estimated value">
          <input
            type="number"
            min="0"
            step="0.01"
            value={estimatedValue}
            onChange={(event) => setEstimatedValue(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Converted project slug">
          <input
            list="local-project-slugs"
            value={lead.converted_project_slug ?? ""}
            onChange={(event) => set("converted_project_slug", event.target.value || null)}
            placeholder="Leave blank until confirmed"
            className={inputClass}
          />
          <datalist id="local-project-slugs">
            {projectSlugs.map((value) => <option key={value} value={value} />)}
          </datalist>
        </Field>
        <Field label="Converted date">
          <input
            type="date"
            value={lead.converted_date ?? ""}
            onChange={(event) => set("converted_date", event.target.value || null)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Dropbox folder">
        <select
          value={dropboxAction}
          onChange={(event) => setDropboxAction(event.target.value as "create" | "link-existing" | "none")}
          className={inputClass}
        >
          {mode === "create" && <option value="create">Create a new standard lead folder</option>}
          <option value="link-existing">Use an existing Dropbox folder</option>
          <option value="none">No Dropbox folder yet</option>
        </select>
        {dropboxAction !== "none" && <div className="flex flex-wrap gap-2">
          <input
            value={lead.dropbox_path ?? ""}
            onChange={(event) => set("dropbox_path", event.target.value || null)}
            placeholder={`e.g. 1.01 LEADS/${dateStampPrefix(lead.date_received)}${lead.name || "lead-name"}`}
            className={`${inputClass} min-w-0 flex-1`}
          />
          {dropboxAction === "create" && (
            <button
              type="button"
              disabled={!lead.name.trim()}
              onClick={() => set("dropbox_path", `1.01 LEADS/${dateStampPrefix(lead.date_received)}${lead.name.trim()}`)}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent hover:text-foreground disabled:opacity-50"
            >
              Use suggested path
            </button>
          )}
          {mounted && window.electronAPI?.dropbox && (
            <button
              type="button"
              onClick={() => void chooseExistingDropboxFolder()}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent hover:text-foreground"
            >
              Search &amp; select folder
            </button>
          )}
        </div>}
        <span className="text-xs text-muted-foreground">
          {dropboxAction === "create"
            ? <>After confirmation, Mi creates contracts, owner-supplied, site-photos, correspondence, and Mi subfolders at this exact relative path.</>
            : dropboxAction === "link-existing"
              ? <>Choose the exact existing folder. Saving the link does not reorganize or overwrite anything inside it.</>
              : <>You can link or create a Dropbox folder later from this lead.</>}
        </span>
      </Field>
      <Field label="Lost reason">
        <textarea
          value={lead.lost_reason ?? ""}
          onChange={(event) => set("lost_reason", event.target.value || null)}
          rows={2}
          className={inputClass}
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={lead.notes ?? ""}
          onChange={(event) => set("notes", event.target.value)}
          rows={5}
          className={inputClass}
        />
      </Field>
      <Field label="Contract notes / Google Drive link">
        <textarea
          value={lead.contract_notes}
          onChange={(event) => set("contract_notes", event.target.value)}
          rows={3}
          placeholder="Negotiation specifics and the reviewed Google Drive contract URL, if that is where the working agreement lives."
          className={inputClass}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Converted project links are never inferred. Choose an exact existing local project slug and
        provide its real conversion date together.
      </p>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {confirmingDropbox && lead.dropbox_path && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5">
            <h2 className="font-medium">
              {dropboxAction === "create" ? "Confirm Dropbox folder creation" : "Confirm existing Dropbox folder"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {dropboxAction === "create" ? (
                <>Create <code>{lead.dropbox_path}</code> plus contracts, owner-supplied, site-photos, correspondence, and Mi subfolders, then create this lead.</>
              ) : (
                <>Link this lead to the existing folder <code>{lead.dropbox_path}</code>. Mi will verify it and will not change its contents.</>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setConfirmingDropbox(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={() => void performSave(undefined, true)} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
                {saving ? "Saving…" : dropboxAction === "create" ? "Confirm and create" : "Confirm and link"}
              </button>
            </div>
          </div>
        </div>
      )}
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
