"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface PreviewItem {
  folder: string;
  dropboxRelativePath: string;
  status: "create" | "exists" | "conflict";
  message: string;
}

interface ApplyItem {
  folder: string;
  dropboxRelativePath: string;
  status: "created" | "exists" | "conflict" | "error";
  message: string;
}

const inputClass =
  "rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function LibraryWorkspace({ recommendedFolders }: { recommendedFolders: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [collectionMessage, setCollectionMessage] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [folderText, setFolderText] = useState(recommendedFolders.join("\n"));
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyItem[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function folders() {
    return folderText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setCollectionMessage("");
    const response = await fetch("/api/library/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    }).catch(() => null);
    if (!response) {
      setCollectionMessage("Could not reach the local Mi server.");
      setBusy(false);
      return;
    }
    const result = await response.json().catch(() => ({})) as { error?: string; slug?: string };
    if (!response.ok) {
      setCollectionMessage(result.error ?? "Collection could not be created.");
      setBusy(false);
      return;
    }
    setCollectionMessage("Collection created.");
    setName("");
    setSlug("");
    setBusy(false);
    router.refresh();
  }

  async function previewPlan() {
    setBusy(true);
    setPlanMessage("");
    setPreview(null);
    setApplyResults(null);
    setConfirmed(false);
    const response = await fetch("/api/library/dropbox-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath, folders: folders() }),
    }).catch(() => null);
    if (!response) {
      setPlanMessage("Could not reach the local Mi server.");
      setBusy(false);
      return;
    }
    const result = await response.json().catch(() => ({})) as {
      error?: string;
      folders?: PreviewItem[];
    };
    if (!response.ok) {
      setPlanMessage(result.error ?? "Folder plan could not be previewed.");
    } else {
      setPreview(result.folders ?? []);
      setPlanMessage("Preview only. No Dropbox folders were created.");
    }
    setBusy(false);
  }

  async function applyPlan() {
    if (!confirmed) {
      setPlanMessage("Confirm the exact preview before creating folders.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/library/dropbox-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath, folders: folders(), confirmed: true }),
    }).catch(() => null);
    if (!response) {
      setPlanMessage("Could not reach the local Mi server.");
      setBusy(false);
      return;
    }
    const result = await response.json().catch(() => ({})) as {
      error?: string;
      results?: ApplyItem[];
    };
    if (!response.ok) {
      setPlanMessage(result.error ?? "Folder plan could not be applied.");
    } else {
      setApplyResults(result.results ?? []);
      setPlanMessage("Folder creation finished. Review every per-folder result below.");
      setConfirmed(false);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">Create local metadata collection</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This creates an empty Mi metadata index. It does not copy, upload, download, or parse documents.
        </p>
        <form onSubmit={createCollection} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1 text-sm">
            <span>Collection name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Collection slug</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="lowercase-path-safe-slug"
              required
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={busy} className="self-end rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
            Save collection
          </button>
        </form>
        {collectionMessage && <p role="status" className="mt-2 text-sm text-muted-foreground">{collectionMessage}</p>}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">Proposed Dropbox firm library</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter a human-confirmed parent path relative to DROPBOX_ROOT. Edit the neutral proposal,
          preview exact outcomes, then separately confirm before any folder is created.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Confirmed parent under DROPBOX_ROOT</span>
            <input
              value={parentPath}
              onChange={(event) => { setParentPath(event.target.value); setPreview(null); }}
              placeholder="Shared/Firm-Library"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Folders, one relative path per line</span>
            <textarea
              value={folderText}
              onChange={(event) => { setFolderText(event.target.value); setPreview(null); }}
              rows={15}
              className={`${inputClass} font-mono`}
            />
          </label>
          <div>
            <button type="button" onClick={previewPlan} disabled={busy} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">
              Preview exact folder plan
            </button>
          </div>
        </div>

        {preview && (
          <div className="mt-4 grid gap-3">
            <ul className="grid gap-2 text-sm">
              {preview.map((item) => (
                <li key={item.folder} className="rounded-md border border-border p-3">
                  <span className="font-mono">{item.dropboxRelativePath}</span>
                  <span className="ml-2 font-medium">{item.status}</span>
                  <div className="text-muted-foreground">{item.message}</div>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I confirm this exact parent and folder list. Create only folders marked “create”.</span>
            </label>
            <div>
              <button
                type="button"
                onClick={applyPlan}
                disabled={busy || !confirmed || preview.some((item) => item.status === "conflict")}
                className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              >
                Create confirmed folders
              </button>
            </div>
          </div>
        )}
        {applyResults && (
          <ul className="mt-4 grid gap-2 text-sm">
            {applyResults.map((item) => (
              <li key={item.folder} className="rounded-md border border-border p-3">
                <span className="font-mono">{item.dropboxRelativePath}</span>
                <span className="ml-2 font-medium">{item.status}</span>
                <div className="text-muted-foreground">{item.message}</div>
              </li>
            ))}
          </ul>
        )}
        {planMessage && <p role="status" className="mt-3 text-sm text-muted-foreground">{planMessage}</p>}
        <p className="mt-4 text-xs text-muted-foreground">
          Downloaded marketing and reference assets require source, copyright, and license review before use.
        </p>
      </section>
    </div>
  );
}
