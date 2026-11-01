"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDetails, ProjectPayment } from "@/lib/schema";
import { PROJECT_CHAT_OPEN_EVENT } from "./projectChatUi";
import { useDesktopPaneWindows } from "./workspacePanes";

const CONTRACT_PROMPT = `Plan this project's schedule with me from its signed contract. Find the signed contract in this project's files; if you can't tell which one is signed, ask me. Read only what the contract states: its duration, start and end dates, phases, and payment schedule. Then propose:
- one project-details change with contract_start_date, contract_end_date, contract_duration, phases, and payments
- one schedule-item for each milestone and payment date the contract fixes

Leave a date blank when the contract doesn't fix it, and keep the contract's own wording in a payment's trigger. Ask me for the start date if it depends on something like notice to proceed. These are proposals for me to review.`;

const control = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm";

function blankPayment(): ProjectPayment {
  return { id: crypto.randomUUID(), label: "", amount: null, trigger: "", due_date: "", invoiced_date: "", paid_date: "", phase_id: "" };
}

/** Contract dates, payments and phase progress, tracked per project. */
export function ProjectContractPlan({ slug, initialDetails, initialHash }: {
  slug: string;
  initialDetails: ProjectDetails;
  initialHash: string | null;
}) {
  const router = useRouter();
  const desktop = useDesktopPaneWindows();
  const [details, setDetails] = useState(initialDetails);
  const [hash, setHash] = useState(initialHash);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const patchPayment = (id: string, change: Partial<ProjectPayment>) =>
    setDetails((current) => ({ ...current, payments: current.payments.map((item) => item.id === id ? { ...item, ...change } : item) }));
  const invalid = details.payments.some((payment) => !payment.label.trim());

  function planFromContract() {
    window.dispatchEvent(new CustomEvent(PROJECT_CHAT_OPEN_EVENT, { detail: { slug, tab: "chat", fresh: true, prompt: CONTRACT_PROMPT,
      onResult: (error: string | null) => setMessage(error || "A new chat is open with the request in its message box. Send it when you’re ready."),
    } }));
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/details`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, expectedHash: hash, details }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error === "conflict" ? "This project changed elsewhere. Reload before saving." : data.error || "Could not save.");
      }
      setHash(data.hash ?? null);
      setConfirming(false);
      setMessage("Contract plan saved in Mi.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally { setBusy(false); }
  }

  return <section className="rounded-lg border border-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-medium">Contract &amp; payments</h2>
        <p className="text-sm text-muted-foreground">The contract’s dates and payment schedule, tracked here and shown on the calendars.</p>
      </div>
      {desktop && <button type="button" onClick={planFromContract} className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Plan from contract</button>}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-muted-foreground">Contract start<input type="date" value={details.contract_start_date} onChange={(event) => setDetails({ ...details, contract_start_date: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
      <label className="text-xs text-muted-foreground">Contract end<input type="date" value={details.contract_end_date} onChange={(event) => setDetails({ ...details, contract_end_date: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
      <label className="text-xs text-muted-foreground">Duration in the contract<input value={details.contract_duration} placeholder="e.g. 26 weeks from notice to proceed" onChange={(event) => setDetails({ ...details, contract_duration: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
    </div>

    <h3 className="mt-5 text-sm font-medium">Payment schedule</h3>
    <div className="mt-2 space-y-2">
      {details.payments.map((payment) => <div key={payment.id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <label className="text-xs text-muted-foreground">Payment<input value={payment.label} onChange={(event) => patchPayment(payment.id, { label: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground">Amount<input type="number" min="0" step="0.01" value={payment.amount ?? ""} onChange={(event) => patchPayment(payment.id, { amount: event.target.value === "" ? null : Number(event.target.value) })} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground">Due<input type="date" value={payment.due_date} onChange={(event) => patchPayment(payment.id, { due_date: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground">Invoiced<input type="date" value={payment.invoiced_date} onChange={(event) => patchPayment(payment.id, { invoiced_date: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground">Paid<input type="date" value={payment.paid_date} onChange={(event) => patchPayment(payment.id, { paid_date: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
        <button type="button" onClick={() => setDetails({ ...details, payments: details.payments.filter((item) => item.id !== payment.id) })} className="self-end rounded-md border border-border px-2 py-1.5 text-xs">Remove</button>
        <label className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Due when (contract wording)<input value={payment.trigger} onChange={(event) => patchPayment(payment.id, { trigger: event.target.value })} className={`mt-1 block ${control} text-foreground`} /></label>
        <label className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Phase
          <select value={payment.phase_id} onChange={(event) => patchPayment(payment.id, { phase_id: event.target.value })} className={`mt-1 block ${control} text-foreground`}>
            <option value="">None</option>
            {details.phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}
          </select>
        </label>
      </div>)}
      <button type="button" onClick={() => setDetails({ ...details, payments: [...details.payments, blankPayment()] })} className="rounded-md border border-border px-3 py-1.5 text-sm">Add payment</button>
    </div>

    {details.phases.length > 0 && <>
      <h3 className="mt-5 text-sm font-medium">Phase progress</h3>
      <div className="mt-2 space-y-2">
        {details.phases.map((phase) => <div key={phase.id} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <p className="text-sm">{phase.name}</p>
          <label className="text-xs text-muted-foreground">Percent through<input type="number" min="0" max="100" step="5" value={phase.progress_percent ?? ""} onChange={(event) => setDetails({ ...details, phases: details.phases.map((item) => item.id === phase.id ? { ...item, progress_percent: event.target.value === "" ? null : Math.min(100, Math.max(0, Math.round(Number(event.target.value)))) } : item) })} className={`mt-1 block ${control} text-foreground`} /></label>
          <label className="text-xs text-muted-foreground">Client approved<input type="date" value={phase.client_approved_date} onChange={(event) => setDetails({ ...details, phases: details.phases.map((item) => item.id === phase.id ? { ...item, client_approved_date: event.target.value } : item) })} className={`mt-1 block ${control} text-foreground`} /></label>
        </div>)}
      </div>
    </>}

    <div className="mt-4 flex flex-wrap items-center gap-2">
      {confirming
        ? <>
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">{busy ? "Saving…" : "Confirm save in Mi"}</button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Keep editing</button>
        </>
        : <button type="button" disabled={invalid} onClick={() => setConfirming(true)} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">Save contract plan</button>}
      {invalid && <span className="text-xs text-muted-foreground">Name each payment to save.</span>}
    </div>
    {message && <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p>}
  </section>;
}
