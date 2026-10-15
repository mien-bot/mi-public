"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { previewDayOneExport, type DayOneImportPreview } from "@/lib/personal/dayone";
import type { PersonalRecordDraft, PersonalRecordKind } from "@/lib/personal/schema";

const kindLabels: Record<PersonalRecordKind, string> = {
  journal: "Journal",
  thought: "Thought",
  task: "Task",
  plan: "Plan",
};

export function PersonalDayOneTransfer({
  busy,
  onImport,
}: {
  busy: boolean;
  onImport: (drafts: PersonalRecordDraft[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previews, setPreviews] = useState<DayOneImportPreview[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorking(true);
    setMessage("");
    try {
      const next = await previewDayOneExport({ name: file.name, data: await file.arrayBuffer() });
      setPreviews(next);
      setSelected(new Set(next.map((_, index) => index)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mi could not preview that Day One export.");
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
      setMessage(`${drafts.length} reviewed Day One entr${drafts.length === 1 ? "y" : "ies"} imported privately into Mi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reviewed Day One entries could not be imported.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-light">Day One import</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            From Day One: Settings → Export → JSON, then choose the .zip (or the Journal.json inside
            it) here. Preview and edit every entry before anything is imported. Photos and other
            attachments are not imported -- Mi&apos;s journal entries are text-only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept=".zip,.json,application/zip,application/json" onChange={(event) => void chooseFile(event)} className="hidden" />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || working} className="rounded-md border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50">
            Import from Day One
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
                  aria-label={`Import ${preview.draft.title}`}
                  checked={selected.has(index)}
                  onChange={(event) => setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(index); else next.delete(index);
                    return next;
                  })}
                  className="mt-1 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <label className="text-xs text-muted-foreground">Title
                      <input value={preview.draft.title} maxLength={200} onChange={(event) => updateDraft(index, { title: event.target.value })} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                    </label>
                    <label className="text-xs text-muted-foreground">Kind
                      <select value={preview.draft.kind} onChange={(event) => updateDraft(index, { kind: event.target.value as PersonalRecordKind })} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                        {(Object.keys(kindLabels) as PersonalRecordKind[]).map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
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
              {working ? "Importing…" : `Confirm import ${selected.size} entr${selected.size === 1 ? "y" : "ies"}`}
            </button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
