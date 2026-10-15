"use client";

import { useMemo, useState } from "react";
import type { ContractDraftInput, ContractTemplateId } from "@/lib/contracts/schema";
import {
  contractTemplateDefinitions,
  createContractDraft,
  getContractTemplate,
  standardContractTerms,
} from "@/lib/contracts/templates";

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function Field({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "text" | "date";
  placeholder?: string;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}{required && <span className="text-status-danger-foreground"> *</span>}
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
  hint,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}{required && <span className="text-status-danger-foreground"> *</span>}
      {hint && <span className="ml-2 normal-case text-muted-foreground">{hint}</span>}
      <textarea
        required={required}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-accent"
      />
    </label>
  );
}

function PreviewList({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}

export function ContractWriter() {
  const [draft, setDraft] = useState<ContractDraftInput>(() => createContractDraft());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const template = useMemo(() => getContractTemplate(draft.templateId), [draft.templateId]);

  function update<K extends keyof ContractDraftInput>(key: K, value: ContractDraftInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  function changeTemplate(templateId: ContractTemplateId) {
    const hasEnteredProject = Boolean(draft.clientName || draft.projectName);
    if (hasEnteredProject && !window.confirm("Changing the template resets this unsaved form. Continue?")) return;
    setDraft(createContractDraft(templateId));
    setMessage("");
  }

  function addFee() {
    update("fees", [...draft.fees, { label: "Additional service", amount: "$0.00" }]);
  }

  async function prepareDraft() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/contracts/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, draft }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Mi could not prepare the contract draft.");
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "Contract-draft.docx";
      downloadBlob(await response.blob(), filename);
      setConfirming(false);
      setMessage("Editable DOCX draft downloaded. Mi did not save, send, or upload it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mi could not prepare the contract draft.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(
    draft.clientName.trim()
    && draft.projectName.trim()
    && draft.projectDescription.trim()
    && draft.services.length
    && draft.fees.length,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(25rem,0.85fr)]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Starting format</p>
              <h2 className="mt-1 font-display text-xl font-light">Choose a reviewed contract pattern</h2>
            </div>
            <span className="rounded-full bg-status-warning px-3 py-1 text-xs text-status-warning-foreground">Draft only</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {contractTemplateDefinitions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => changeTemplate(option.id)}
                aria-pressed={draft.templateId === option.id}
                className={`rounded-lg border p-3 text-left transition-colors ${draft.templateId === option.id ? "border-accent bg-accent/10" : "border-border hover:border-accent"}`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-light">Client and project</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Proposal date" type="date" required value={draft.proposalDate} onChange={(value) => update("proposalDate", value)} />
            <Field label="Client legal name" required value={draft.clientName} onChange={(value) => update("clientName", value)} placeholder="Confirm spelling before export" />
            <Field label="Client company" value={draft.clientCompany} onChange={(value) => update("clientCompany", value)} />
            <Field label="Contact information" value={draft.contactInformation} onChange={(value) => update("contactInformation", value)} placeholder="Email and phone, if confirmed" />
            <Field label="Project name" required value={draft.projectName} onChange={(value) => update("projectName", value)} />
            <Field label="Project area" value={draft.projectArea} onChange={(value) => update("projectArea", value)} placeholder="Example: Approximately 8,000 SF" />
            <div className="sm:col-span-2">
              <Field label="Project address" value={draft.projectAddress} onChange={(value) => update("projectAddress", value)} />
            </div>
            <div className="sm:col-span-2">
              <TextAreaField label="Project description" required rows={3} value={draft.projectDescription} onChange={(value) => update("projectDescription", value)} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-light">Scope and assumptions</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">One item per line. Use Talk to Mi to refine the wording, then paste only the language you have reviewed here.</p>
          <div className="mt-4 space-y-4">
            <TextAreaField label="Scope of services" required rows={9} hint="one item per line" value={draft.services.join("\n")} onChange={(value) => update("services", splitLines(value))} />
            <TextAreaField label="Services by client or others" rows={6} hint="one item per line" value={draft.clientResponsibilities.join("\n")} onChange={(value) => update("clientResponsibilities", splitLines(value))} />
            <TextAreaField label="Assumptions and exclusions" rows={7} hint="one item per line" value={draft.assumptions.join("\n")} onChange={(value) => update("assumptions", splitLines(value))} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-light">Fees and payment</h2>
            <button type="button" onClick={addFee} className="rounded-md border border-border px-3 py-2 text-xs hover:border-accent">+ Add fee</button>
          </div>
          <div className="mt-4 space-y-2">
            {draft.fees.map((fee, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                <Field label={index === 0 ? "Service / phase" : ""} required value={fee.label} onChange={(value) => update("fees", draft.fees.map((item, itemIndex) => itemIndex === index ? { ...item, label: value } : item))} />
                <Field label={index === 0 ? "Fee" : ""} required value={fee.amount} onChange={(value) => update("fees", draft.fees.map((item, itemIndex) => itemIndex === index ? { ...item, amount: value } : item))} />
                <button type="button" aria-label={`Remove fee ${index + 1}`} disabled={draft.fees.length === 1} onClick={() => update("fees", draft.fees.filter((_, itemIndex) => itemIndex !== index))} className="self-end rounded-md border border-border px-3 py-2.5 text-xs text-muted-foreground hover:border-status-danger-foreground hover:text-status-danger-foreground disabled:opacity-40">Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Reimbursable expense markup" value={draft.reimbursableMarkup} onChange={(value) => update("reimbursableMarkup", value)} />
            <Field label="Additional-services hourly rate" value={draft.hourlyRate} onChange={(value) => update("hourlyRate", value)} />
          </div>
          <div className="mt-4">
            <TextAreaField label="Retainer and payment milestones" required rows={5} hint="one item per line" value={draft.retainerSchedule.join("\n")} onChange={(value) => update("retainerSchedule", splitLines(value))} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-light">Final terms and signatures</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">The DOCX includes the common terms structure found across the three supplied examples. Liability and dispute language is flagged for attorney review.</p>
          <div className="mt-4 space-y-4">
            <TextAreaField label="Project-specific additional terms" rows={5} value={draft.additionalTerms} onChange={(value) => update("additionalTerms", value)} />
            <Field label="Prepared by / firm" required value={draft.preparedBy} onChange={(value) => update("preparedBy", value)} />
            <TextAreaField label="Firm signers" required rows={3} hint="one signer per line" value={draft.firmSigners.join("\n")} onChange={(value) => update("firmSigners", splitLines(value))} />
          </div>
        </section>

        <section className="rounded-xl border border-accent/40 bg-accent/10 p-5">
          <h2 className="font-medium">Export remains local</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Mi prepares an editable Word draft only after your confirmation. Nothing is saved to project records, emailed, or uploaded to Google Drive. You can upload the reviewed DOCX yourself.</p>
          <button type="button" disabled={!ready || busy} onClick={() => setConfirming(true)} className="mt-4 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50">Prepare DOCX draft</button>
          {!ready && <p className="mt-2 text-xs text-muted-foreground">Complete the required client, project, scope, and fee fields first.</p>}
          {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
        </section>
      </div>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <article className="max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-[var(--shadow-sm)]">
          <p className="text-center text-xs font-semibold tracking-[0.16em] text-status-danger-foreground">DRAFT — REVIEW BEFORE SENDING</p>
          <p className="mt-6 text-sm">{draft.proposalDate || "Proposal date"}</p>
          <dl className="mt-4 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-semibold">TO</dt><dd>{draft.clientName || "Client legal name"}</dd>
            {draft.clientCompany && <><dt className="font-semibold">COMPANY</dt><dd>{draft.clientCompany}</dd></>}
            <dt className="font-semibold">FROM</dt><dd>{draft.preparedBy}</dd>
            <dt className="font-semibold">RE</dt><dd>{draft.projectName || "Project name"}</dd>
          </dl>
          <h2 className="mt-8 text-center text-lg font-semibold">{template.proposalTitle}</h2>
          <p className="mt-4 text-sm leading-6">{draft.projectDescription}</p>
          <h3 className="mt-6 font-semibold">Scope of Services</h3><PreviewList items={draft.services} />
          <h3 className="mt-6 font-semibold">Services by Client or Others</h3><PreviewList items={draft.clientResponsibilities} />
          <h3 className="mt-6 font-semibold">Assumptions and Understandings</h3><PreviewList items={draft.assumptions} />
          <h3 className="mt-6 font-semibold">Fee Breakdown</h3>
          <div className="mt-2 overflow-hidden rounded-md border border-border text-sm">
            {draft.fees.map((fee, index) => <div key={index} className="grid grid-cols-[1fr_auto] gap-3 border-b border-border px-3 py-2 last:border-b-0"><span>{fee.label}</span><span className="font-medium">{fee.amount}</span></div>)}
          </div>
          <h3 className="mt-6 font-semibold">Retainer and Payment Schedule</h3><PreviewList items={draft.retainerSchedule} />
          <h3 className="mt-6 font-semibold">Terms and Conditions</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6">
            {standardContractTerms.map((term) => <li key={term.title}><span className="font-medium">{term.title}:</span> {term.text}</li>)}
          </ol>
          {draft.additionalTerms && <><h3 className="mt-6 font-semibold">Project-Specific Additional Terms</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{draft.additionalTerms}</p></>}
          <h3 className="mt-6 font-semibold">Acceptance</h3>
          <div className="mt-8 grid gap-8 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <div><div className="border-b border-foreground pb-8">{draft.clientName || "Client"}</div><p className="mt-1 text-xs text-muted-foreground">Signature / date</p></div>
            <div><div className="border-b border-foreground pb-8">{draft.firmSigners.join(" / ")}</div><p className="mt-1 text-xs text-muted-foreground">Signature(s) / date</p></div>
          </div>
        </article>
      </aside>

      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="contract-download-title" className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Local draft confirmation</p>
            <h2 id="contract-download-title" className="mt-2 font-display text-xl font-light">Prepare this editable DOCX?</h2>
            <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-2 text-sm"><dt className="text-muted-foreground">Client</dt><dd>{draft.clientName}</dd><dt className="text-muted-foreground">Project</dt><dd>{draft.projectName}</dd><dt className="text-muted-foreground">Template</dt><dd>{template.label}</dd></dl>
            <p className="mt-4 rounded-md bg-status-warning p-3 text-xs leading-5 text-status-warning-foreground">This is not a final legal document. Confirm project facts, scope, fees, insurance requirements, limitation language, and signatures with an authorized principal or attorney before sending it to a client.</p>
            <p className="mt-3 text-xs text-muted-foreground">This action downloads a local draft only. It does not save to Mi or upload to Google Drive.</p>
            <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy} onClick={() => void prepareDraft()} className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-50">{busy ? "Preparing…" : "Confirm and download draft"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
