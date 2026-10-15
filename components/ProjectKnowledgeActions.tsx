"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgePublishPlan } from "@/src/services/projectKnowledgeNotion";
import { NotionLink } from "./NotionLink";

export function ProjectKnowledgeActions({ slug, notionLinked, initialHash }: {
  slug: string; notionLinked: boolean; initialHash: string | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [entry, setEntry] = useState("");
  const [hash, setHash] = useState(initialHash);
  const [plan, setPlan] = useState<KnowledgePublishPlan | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const button = "rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50";

  async function request(action: "note" | "preview" | "publish" | "enable") {
    setBusy(action); setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/knowledge${action === "note" ? "" : "/notion"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "note" ? { title, entry, expectedHash: hash, confirmed: true }
          : { action, confirmed: action === "publish" || action === "enable", previewPlan: plan }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) setPermissionNeeded(true);
        throw new Error(result.error || "The action could not be completed.");
      }
      if (action === "note") { setHash(result.hash); setTitle(""); setEntry(""); setAdding(false); setPlan(null); setMessage("Saved to project knowledge."); router.refresh(); }
      if (action === "preview") { setPermissionNeeded(false); setPlan(result.plan); }
      if (action === "publish") { setPlan(null); setMessage(`Published ${result.published} item(s) to Notion.${result.remaining ? ` ${result.remaining} more ready; preview the next batch.` : ""}`); }
      if (action === "enable") { setPermissionNeeded(false); setMessage("Knowledge publishing enabled on this computer. Preview the Notion changes next."); }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The action failed.");
      if (action === "publish") setPlan(null);
    } finally { setBusy(""); }
  }

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-label="Knowledge actions">
    <div className="flex flex-wrap gap-2">
      <Link href={`/review?workspace=${encodeURIComponent(`project/${slug}`)}`} className={button}>Review inbox → save knowledge</Link>
      <button type="button" className={button} disabled={!!busy} onClick={() => setAdding(!adding)}>Add a knowledge note</button>
      <button type="button" className={button} disabled={!!busy || !notionLinked} onClick={() => void request("preview")}>{busy === "preview" ? "Checking Notion…" : "Publish knowledge to Notion"}</button>
    </div>
    <p className="text-sm text-muted-foreground">Keep confirmed knowledge here. Publish reviewed notes and project details to the Knowledge section of the linked Notion project page.</p>
    {!notionLinked && <p className="text-sm text-muted-foreground">A confirmed Notion project link is needed before publishing. <Link href={`/projects/${slug}/details`} className="text-link underline">Project connections</Link></p>}
    {adding && <div className="space-y-3 border-t border-border pt-4">
      <label className="block text-sm">Note title<input className="mt-1 block w-full rounded border border-border bg-background p-2" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} disabled={!!busy} /></label>
      <label className="block text-sm">Confirmed knowledge or correction<textarea rows={6} maxLength={20_000} className="mt-1 block w-full rounded border border-border bg-background p-2" value={entry} onChange={e => setEntry(e.target.value)} disabled={!!busy} /></label>
      <p className="text-xs text-muted-foreground">This adds a new note and preserves existing knowledge. Review the text above before confirming.</p>
      <button type="button" className={button} disabled={!!busy || !title.trim() || !entry.trim()} onClick={() => void request("note")}>{busy === "note" ? "Saving…" : "Confirm and save note"}</button>
    </div>}
    {permissionNeeded && <div className="space-y-2 rounded-md border border-border p-3 text-sm">
      <p>This installation has not enabled project knowledge publishing. Enabling it allows reviewed additions to the linked Notion project page; every publish still needs your confirmation.</p>
      <button type="button" className={button} disabled={!!busy} onClick={() => void request("enable")}>Enable knowledge publishing on this computer</button>
    </div>}
    {plan && <div className="space-y-3 border-t border-border pt-4">
      <h2 className="font-medium">Review Notion additions</h2>
      <NotionLink href={plan.pageUrl}>Open the exact destination project page</NotionLink>
      <p className="text-sm text-muted-foreground">{plan.entries.length} new item(s) · {plan.alreadyPublished} already present{plan.remaining ? ` · ${plan.remaining} more in the next batch` : ""}. This appends to Knowledge · Mi and preserves existing page content. Anyone with access to that Notion page may see these details, including internal notes.</p>
      {plan.entries.length === 0 && <p className="text-sm">The current project knowledge is already published.</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto">{plan.entries.map((item, i) => <details key={i} open className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{item.title}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.body}</p></details>)}</div>
      <div className="flex gap-2"><button type="button" disabled={!!busy || !plan.entries.length} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50" onClick={() => void request("publish")}>{busy === "publish" ? "Publishing…" : `Confirm and publish ${plan.entries.length} item(s)`}</button><button type="button" disabled={!!busy} className={button} onClick={() => setPlan(null)}>Cancel</button></div>
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
