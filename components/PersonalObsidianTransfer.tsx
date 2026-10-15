"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  buildObsidianVaultZip,
  previewObsidianFiles,
  type ObsidianImportPreview,
} from "@/lib/personal/obsidian";
import type { PersonalRecord, PersonalRecordDraft, PersonalRecordKind } from "@/lib/personal/schema";

const kindLabels: Record<PersonalRecordKind, string> = {
  journal: "Journal",
  thought: "Thought",
  task: "Task",
  plan: "Plan",
};

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PersonalObsidianTransfer({
  records,
  busy,
  onImport,
}: {
  records: PersonalRecord[];
  busy: boolean;
  onImport: (drafts: PersonalRecordDraft[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previews, setPreviews] = useState<ObsidianImportPreview[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.some((file) => !file.name.toLowerCase().endsWith(".md"))) {
      setMessage("Choose Markdown (.md) files from an Obsidian vault.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const next = previewObsidianFiles(await Promise.all(files.map(async (file) => ({
        name: file.name,
        content: await file.text(),
      }))));
      setPreviews(next);
      setSelected(new Set(next.map((_, index) => index)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mi could not preview those Markdown files.");
    } finally {
      setWorking(false);
    }
  }

  function updateDraft(index: number, patch: Partial<PersonalRecordDraft>) {
    setPreviews((current) => current.map((preview, entryIndex) => entryIndex === index
      ? { ...preview, draft: { ...preview.draft, ...patch } }
      : preview));
  }

  async function confirmImport() {
    const drafts = previews.filter((_, index) => selected.has(index)).map((preview) => preview.draft);
    if (drafts.length === 0) return;
    setWorking(true);
    setMessage("");
    try {
      await onImport(drafts);
      setPreviews([]);
      setSelected(new Set());
      setMessage(`${drafts.length} reviewed Obsidian note${drafts.length === 1 ? "" : "s"} imported privately into Mi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reviewed Obsidian notes could not be imported.");
    } finally {
      setWorking(false);
    }
  }

  async function exportVault() {
    setWorking(true);
    setMessage("");
    try {
      const zip = await buildObsidianVaultZip(records);
      downloadBlob(`Mi Personal Obsidian ${new Date().toISOString().slice(0, 10)}.zip`, zip);
      setMessage("Obsidian vault export prepared. Mi did not change any records.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Obsidian export could not be prepared.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-light">Obsidian transfer</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            Preview Markdown notes before importing them into the private Personal database, or export current records as an Obsidian-ready vault ZIP.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept=".md,text/markdown" multiple onChange={(event) => void chooseFiles(event)} className="hidden" />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || working} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50">
            Import from Obsidian
          </button>
          <button type="button" onClick={() => void exportVault()} disabled={busy || working || records.length === 0} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50">
            Export to Obsidian
          </button>
        </div>
      </div>

      {previews.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Review import drafts · nothing saved yet</p>
            <button type="button" onClick={() => { setPreviews([]); setSelected(new Set()); }} disabled={working} className="text-xs text-muted-foreground hover:underline">Dismiss all</button>
          </div>
          {previews.map((preview, index) => (
            <article key={`${preview.sourceName}-${index}`} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Import ${preview.sourceName}`}
                  checked={selected.has(index)}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(index); else next.delete(index);
                    return next;
                  })}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{preview.sourceName}</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
                    <label className="text-xs text-muted-foreground">Title
                      <input value={preview.draft.title} maxLength={200} onChange={(event) => updateDraft(index, { title: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                    </label>
                    <label className="text-xs text-muted-foreground">Kind
                      <select value={preview.draft.kind} onChange={(event) => updateDraft(index, { kind: event.target.value as PersonalRecordKind })} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                        {(Object.keys(kindLabels) as PersonalRecordKind[]).map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">Status
                      <select value={preview.draft.status} onChange={(event) => updateDraft(index, { status: event.target.value as PersonalRecordDraft["status"] })} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                        <option value="inbox">Inbox</option><option value="active">Active</option><option value="done">Done</option><option value="archived">Archived</option>
                      </select>
                    </label>
                  </div>
                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm">{preview.draft.body || "No note body."}</p>
                  {preview.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-status-warning-foreground">{warning}</p>)}
                </div>
              </div>
            </article>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={() => void confirmImport()} disabled={working || busy || selected.size === 0} className="rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground disabled:opacity-50">
              {working ? "Importing…" : `Confirm import ${selected.size} note${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
