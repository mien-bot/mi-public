"use client";

import { useState } from "react";
import { loadMiProfile } from "./profilePreferences";
import type { ReviewCardView } from "@/lib/content/reviewInboxService";
import type { previewInboxDelete, confirmInboxDelete } from "@/lib/content/reviewInboxDelete";

export function ReviewInboxDelete({ views, onDeleted }: { views: ReviewCardView[]; onDeleted: (message: string) => void }) {
  const [plan, setPlan] = useState<ReturnType<typeof previewInboxDelete> | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ReturnType<typeof confirmInboxDelete> | null>(null);
  const items = views.map(view => ({ kind: view.workspace.kind, slug: view.workspace.slug, cardId: view.card.id }));
  async function run(action: "preview" | "delete") {
    setBusy(true); setError(""); setResults(null);
    try {
      const response = await fetch("/api/review-inbox/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items, fingerprint: plan?.fingerprint,
          confirmed: step === 2, confirmedAgain: step === 2,
          reviewedBy: loadMiProfile(window.localStorage).displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Deletion failed.");
      if (action === "preview") { setPlan(data.plan); setStep(1); }
      else { setResults(data.results); setStep(0); setPlan(null); onDeleted(`${data.results.filter((item: { deleted: boolean }) => item.deleted).length} deleted. ${data.results.filter((item: { deleted: boolean }) => !item.deleted).map((item: { title: string; error: string }) => `${item.title}: ${item.error}`).join(" ")}`); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deletion failed.");
      setStep(0); setPlan(null);
    } finally { setBusy(false); }
  }
  return <section aria-label="Delete selected inbox items" className="rounded-lg border border-border bg-card p-3 text-sm">
    {step === 0 && <button disabled={busy || !views.length || views.length > 100} onClick={() => void run("preview")}
      className="rounded-md border border-destructive/50 px-3 py-2 text-destructive disabled:opacity-50">
      {busy ? "Checking…" : `Delete ${views.length} from inbox`}
    </button>}
    {step > 0 && plan && <div role="alertdialog" aria-label={step === 1 ? "Confirm inbox deletion" : "Final deletion confirmation"}>
      <p className="font-medium">{step === 1 ? `Delete these ${plan.items.length} items from the inbox?` : `Confirm again: delete ${plan.items.length} items?`}</p>
      <p className="mt-1 text-muted-foreground">Moves items to dismissed history. Saved records and source files stay intact.</p>
      <ul className="my-3 max-h-48 overflow-auto list-disc pl-5">{plan.items.map(item => <li key={JSON.stringify([item.kind, item.slug, item.cardId])}>{item.title} <span className="text-muted-foreground">· {views.find(view => view.workspace.kind === item.kind && view.workspace.slug === item.slug)?.workspace.label}</span></li>)}</ul>
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => step === 1 ? setStep(2) : void run("delete")}
          className="rounded-md bg-destructive px-3 py-2 text-white disabled:opacity-50">{busy ? "Deleting…" : step === 1 ? "Confirm deletion" : "Yes, delete from inbox"}</button>
        <button disabled={busy} onClick={() => { setStep(0); setPlan(null); }} className="rounded-md border border-border px-3 py-2">Cancel</button>
      </div>
    </div>}
    {results && <div role="status">{results.filter(item => item.deleted).length} deleted.{results.filter(item => !item.deleted).map(item => <p key={JSON.stringify([item.kind, item.slug, item.cardId])}>{item.title}: {item.error}</p>)}</div>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </section>;
}
