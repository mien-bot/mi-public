"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { LibraryDocument } from "@/lib/schema";
import { DeleteRecordButton } from "@/components/DeleteRecordButton";

const inputClass =
  "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function LibraryDocumentEditor({
  collection,
  document,
}: {
  collection: string;
  document: LibraryDocument;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState(document.tags.join(", "));
  const [source, setSource] = useState(document.source ?? "");
  const [notes, setNotes] = useState(document.notes ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * Removes the file and its index row together. Leaving either behind is worse than
   * leaving both: an orphaned file gets re-indexed by the next scan, and an orphaned index
   * row points at nothing.
   */
  async function removeDocument() {
    const response = await fetch(`/api/library/collections/${encodeURIComponent(collection)}/documents`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, file: document.file }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "The document could not be deleted.");
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/library/collections/${encodeURIComponent(collection)}/documents`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: document.file,
        metadata: {
          title,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          source,
          notes,
        },
      }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setSaving(false);
      return;
    }
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Document metadata could not be saved.");
    } else {
      setMessage("Metadata saved.");
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 border-t border-border pt-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Tags, comma separated</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span>Source</span>
          <input value={source} onChange={(event) => setSource(event.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span>Notes</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50">
          {saving ? "Saving…" : "Save metadata"}
        </button>
        <DeleteRecordButton
          disabled={saving}
          label="Delete document"
          prompt="Delete this document and its index entry?"
          onDelete={removeDocument}
        />
        {message && <span role="status" className="text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}
