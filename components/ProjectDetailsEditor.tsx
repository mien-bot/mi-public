"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { projectDetailsSchema, type ProjectDetails } from "@/lib/schema";
import type { DropboxContractCandidate } from "@/lib/content/projectWorkspace";
import { NotionLink } from "./NotionLink";
import { projectDetailsChanges } from "./projectDetailsChanges";

const SECTIONS = ["Basics & scope", "People", "Fees & contract", "Phases", "Connections"] as const;

export function ProjectDetailsEditor({ slug, initial, initialHash, dropboxPath, notionUrl, contractCandidates, feeCandidate }: {
  slug: string;
  initial: ProjectDetails;
  initialHash: string | null;
  dropboxPath: string | null;
  notionUrl: string | null;
  contractCandidates: DropboxContractCandidate[];
  feeCandidate: number | null;
}) {
  const router = useRouter();
  const [details, setDetails] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [savedHash, setSavedHash] = useState(initialHash);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>(SECTIONS[0]);
  const [expectedHash, setExpectedHash] = useState<string | null>(initialHash);
  const [confirming, setConfirming] = useState(false);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const control = "mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm";
  const draftKey = `mi-project-details:${slug}`;
  const changes = projectDetailsChanges(saved, details);

  useEffect(() => {
    if (!confirming) return;
    const dialog = reviewDialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previousFocus?.focus(); };
  }, [confirming]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      const parsed = projectDetailsSchema.safeParse(draft.details);
      if (!parsed.success || !(draft.hash === null || typeof draft.hash === "string")) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore browser-only draft after hydration
      setDetails(parsed.data);
      setExpectedHash(draft.hash);
      setMessage("Your unsaved draft was restored. Review it before saving.");
    } catch { /* Browser storage is optional. */ }
  }, [draftKey]);

  useEffect(() => {
    // Electron cancels reload/close on beforeunload without a native confirmation UI.
    // Its recoverable session draft protects edits; browsers can show their own prompt.
    if (!changes.length || window.electronAPI) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

  function patch<K extends keyof ProjectDetails>(key: K, value: ProjectDetails[K]) {
    const next = { ...details, [key]: value };
    setDetails(next);
    setConfirming(false);
    try { sessionStorage.setItem(draftKey, JSON.stringify({ details: next, hash: expectedHash })); } catch { /* Optional. */ }
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setConflict(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          details,
          expectedHash,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === "conflict") {
          setConflict(true);
          throw new Error("This was changed elsewhere since you loaded it. Reload and review the latest version before saving again.");
        }
        throw new Error(data.error);
      }
      setMessage("Project details saved.");
      setSaved(details);
      setSavedHash(data.hash ?? null);
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional. */ }
      setExpectedHash(data.hash ?? null);
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "The save timed out. Reload to check whether it completed before retrying; your draft is kept."
          : error instanceof Error ? error.message : "Project details save failed.",
      );
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
      <p role="status" className="text-sm">{changes.length ? `${changes.length} changed field group(s) · unsaved draft` : "All changes saved"}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !changes.length} onClick={() => {
          setDetails(saved); setExpectedHash(savedHash); setConfirming(false); setMessage("Draft discarded.");
          try { sessionStorage.removeItem(draftKey); } catch { /* Optional. */ }
        }} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Discard draft</button>
        <button type="button" disabled={busy || !changes.length || conflict} onClick={() => {
          const result = projectDetailsSchema.safeParse(details);
          if (!result.success) { setMessage(`Check ${result.error.issues[0]?.path.join(" → ")}: ${result.error.issues[0]?.message}`); return; }
          setConfirming(true);
        }} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">Review changes</button>
      </div>
    </div>
    {message && <p role="status" className="rounded-md border border-border p-3 text-sm">{message}</p>}
    <nav aria-label="Project editing sections" className="flex flex-wrap gap-2">
      {SECTIONS.map((name, index) => <button type="button" key={name} aria-pressed={section === name} onClick={() => setSection(name)}
        className={`rounded-md border px-4 py-2 text-sm ${section === name ? "border-accent bg-accent/10 text-accent" : "border-border"}`}>{index + 1}. {name}</button>)}
    </nav>
    <fieldset disabled={busy}>
    <section className="rounded-lg border border-border p-5">
      <h2 className="text-lg font-medium">{section}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Edit a section, then review all your changes together before saving.</p>
      <div hidden={section !== "Basics & scope"}>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Client name<input value={details.client_name} onChange={(event) => patch("client_name", event.target.value)} className={control} /></label>
        <label className="text-sm">Address<input value={details.address} onChange={(event) => patch("address", event.target.value)} className={control} /></label>
        <label className="text-sm">Project type<input value={details.project_type} onChange={(event) => patch("project_type", event.target.value)} className={control} /></label>
        <label className="text-sm md:col-span-2">Scope<textarea value={details.scope} onChange={(event) => patch("scope", event.target.value)} rows={4} className={control} /></label>
      </div>
      </div>
      <div hidden={section !== "Fees & contract"}>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Fee<div className="mt-1 flex gap-2"><input type="number" min="0" step="0.01" value={details.fee ?? ""} onChange={(event) => patch("fee", event.target.value ? Number(event.target.value) : null)} className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm" /><input aria-label="Fee currency" maxLength={3} value={details.fee_currency} onChange={(event) => patch("fee_currency", event.target.value.toUpperCase())} className="w-20 rounded-md border border-border bg-card px-3 py-2 text-sm" /></div></label>
        <label className="text-sm md:col-span-2">Fee notes / breakdown<textarea value={details.fee_notes} onChange={(event) => patch("fee_notes", event.target.value)} rows={4} className={control} /></label>
        <label className="text-sm md:col-span-2">Confirmed contract link or Dropbox-relative path<input value={details.contract_link_or_path} onChange={(event) => patch("contract_link_or_path", event.target.value)} className={control} /></label>
      </div>
      </div>
      <div hidden={section !== "People"}>

      <div className="mt-5"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Client contacts</h3><button type="button" onClick={() => patch("client_contacts", [...details.client_contacts, { name: "", role: "", email: "", phone: "" }])} className="text-xs text-muted-foreground hover:underline">Add contact</button></div><div className="mt-2 space-y-2">{details.client_contacts.map((contact, index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-4"><input aria-label={`Contact ${index + 1} name`} placeholder="Name" value={contact.name} onChange={(event) => patch("client_contacts", details.client_contacts.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" /><input aria-label={`Contact ${index + 1} role`} placeholder="Role" value={contact.role} onChange={(event) => patch("client_contacts", details.client_contacts.map((entry, i) => i === index ? { ...entry, role: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" /><input aria-label={`Contact ${index + 1} email`} placeholder="Email" value={contact.email} onChange={(event) => patch("client_contacts", details.client_contacts.map((entry, i) => i === index ? { ...entry, email: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" /><div className="flex gap-2"><input aria-label={`Contact ${index + 1} phone`} placeholder="Phone" value={contact.phone} onChange={(event) => patch("client_contacts", details.client_contacts.map((entry, i) => i === index ? { ...entry, phone: event.target.value } : entry))} className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm" /><button type="button" onClick={() => patch("client_contacts", details.client_contacts.filter((_, i) => i !== index))} aria-label={`Remove contact ${index + 1}`} className="text-xs text-muted-foreground">Remove</button></div></div>)}</div></div>

      <div className="mt-5"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Project team</h3><button type="button" onClick={() => patch("team", [...details.team, { name: "", role: "" }])} className="text-xs text-muted-foreground hover:underline">Add team member</button></div><div className="mt-2 space-y-2">{details.team.map((member, index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto]"><input aria-label={`Team member ${index + 1} name`} placeholder="Name" value={member.name} onChange={(event) => patch("team", details.team.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" /><input aria-label={`Team member ${index + 1} role`} placeholder="Role" value={member.role} onChange={(event) => patch("team", details.team.map((entry, i) => i === index ? { ...entry, role: event.target.value } : entry))} className="rounded-md border border-border bg-card px-2 py-1 text-sm" /><button type="button" onClick={() => patch("team", details.team.filter((_, i) => i !== index))} className="text-xs text-muted-foreground">Remove</button></div>)}</div></div>

      </div>
      <div className="mt-5" hidden={section !== "Phases"}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Project phases and agreements</h3>
          <button
            type="button"
            onClick={() => patch("phases", [...details.phases, {
              id: crypto.randomUUID(),
              name: "",
              status: "planned",
              charge: null,
              charge_currency: "USD",
              contract_link_or_path: "",
              planned_start_date: "",
              planned_end_date: "",
              paid: false,
            }])}
            className="text-xs text-muted-foreground hover:underline"
          >
            + Add phase
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Track multiple services and contracts in one project, including separate construction administration or additional-service agreements.
        </p>
        <div className="mt-2 space-y-2">
          {details.phases.map((phase, index) => (
            <div key={phase.id} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-2">
              <input
                placeholder="Phase name"
                value={phase.name}
                onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              />
              <select
                aria-label="Phase status"
                value={phase.status}
                onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, status: event.target.value as typeof phase.status } : entry))}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
                <option value="on-hold">On hold</option>
              </select>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Charge"
                  value={phase.charge ?? ""}
                  onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, charge: event.target.value ? Number(event.target.value) : null } : entry))}
                  className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm"
                />
                <input
                  aria-label="Phase charge currency"
                  maxLength={3}
                  value={phase.charge_currency}
                  onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, charge_currency: event.target.value.toUpperCase() } : entry))}
                  className="w-20 rounded-md border border-border bg-card px-2 py-1 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={phase.paid}
                  onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, paid: event.target.checked } : entry))}
                />
                Paid
              </label>
              <input
                type="date"
                aria-label="Phase planned start date"
                value={phase.planned_start_date}
                onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, planned_start_date: event.target.value } : entry))}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              />
              <input
                type="date"
                aria-label="Phase planned end date"
                value={phase.planned_end_date}
                onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, planned_end_date: event.target.value } : entry))}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              />
              <input
                placeholder="Phase contract link or Dropbox-relative path"
                value={phase.contract_link_or_path}
                onChange={(event) => patch("phases", details.phases.map((entry, i) => i === index ? { ...entry, contract_link_or_path: event.target.value } : entry))}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm md:col-span-2"
              />
              <button
                type="button"
                onClick={() => patch("phases", details.phases.filter((_, i) => i !== index))}
                className="justify-self-start text-xs text-muted-foreground hover:underline"
              >
                Remove phase
              </button>
            </div>
          ))}
        </div>
      </div>

      <div hidden={section !== "Connections"}>
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-md border border-border p-3"><h3 className="font-medium">Dropbox folder</h3><p className="mt-1 break-all">{dropboxPath || "Not linked"}</p><a href={`/projects/${slug}/files`} className="mt-2 inline-block text-link underline">Choose or change folder</a></div>
          <div className="rounded-md border border-border p-3"><h3 className="font-medium">Notion project</h3><div className="mt-1">{notionUrl ? <NotionLink href={notionUrl}>Open linked project in Notion</NotionLink> : "No confirmed Notion page linked"}</div><a href={`/projects/${slug}/knowledge`} className="mt-2 inline-block text-link underline">Review and publish project knowledge</a></div>
        </div>
      </div>
    </section>
    </fieldset>

    {/* Indigo/blue-violet candidate-callout treatment (not amber/orange) — see docs/design/blue-palette.md. */}
    {(feeCandidate !== null || contractCandidates.length > 0) && <section className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-5"><h2 className="font-medium">Unconfirmed candidates</h2><p className="mt-1 text-sm text-muted-foreground">Selecting a candidate only fills the form. It is not saved until the details confirmation above.</p>{feeCandidate !== null && <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"><span>Notion page-body fee candidate: ${feeCandidate.toLocaleString()}</span><button type="button" onClick={() => patch("fee", feeCandidate)} className="rounded-md border border-border px-3 py-1">Use candidate</button></div>}<ul className="mt-3 space-y-2">{contractCandidates.map((candidate) => <li key={candidate.relative_path} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"><div><div>{candidate.name}</div><code className="text-xs text-muted-foreground">{candidate.relative_path}</code></div><button type="button" onClick={() => patch("contract_link_or_path", candidate.relative_path)} className="rounded-md border border-border px-3 py-1">Select contract candidate</button></li>)}</ul></section>}
    {conflict && (
      <div className="flex gap-2">
        <button type="button" onClick={() => { sessionStorage.removeItem(draftKey); window.location.reload(); }} className="rounded-md border border-border px-3 py-2 text-sm">
          Discard draft and reload latest details
        </button>
      </div>
    )}
    {confirming && <dialog ref={reviewDialog} aria-labelledby="details-review-title" onCancel={event => { event.preventDefault(); if (!busy) setConfirming(false); }} className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-5 text-foreground backdrop:bg-black/50">
        <h2 id="details-review-title" className="text-lg font-medium">Review project changes</h2>
        <p className="mt-2 text-sm text-muted-foreground">Save these changes in Mi. Shared project data syncs through Dropbox when configured. Publish knowledge to Notion separately from the Knowledge page.</p>
        <div className="mt-4 space-y-4">{changes.map(change => <section key={change.key} className="rounded-md border border-border p-3"><h3 className="text-sm font-medium">{change.label}</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Before</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{change.before}</p></div><div><p className="text-xs text-accent">After</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{change.after}</p></div></div></section>)}</div>
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-card py-2"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Keep editing</button><button type="button" disabled={busy} onClick={() => void save()} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{busy ? "Saving…" : "Confirm and save changes"}</button></div>
    </dialog>}
  </div>;
}
