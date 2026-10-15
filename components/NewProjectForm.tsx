"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NOTION_PROJECT_SCOPES,
  NOTION_PROJECT_TYPES,
  PROJECT_WORKFLOW_PROFILES,
  projectSlugFromName,
  type ProjectCreationPlan,
} from "@/lib/content/projectCreationPlan";
import { PROJECT_LIST_CHANGED_EVENT } from "@/components/projectChatUi";

interface ProjectPayload {
  name: string;
  slug: string;
  client: string;
  location: string;
  status: string;
  workflow: string;
  projectType: string;
  scopes: string[];
  dropboxMode: "create" | "link-existing";
  dropboxFolder: string;
  dropboxPath: string;
}

interface NumberingSuggestion {
  notionNamePrefix: string;
  dropboxFolderPrefix: string | null;
}

/**
 * This form is uncontrolled, so its values live only in the DOM and navigating away -- to
 * another tab, or anywhere that unmounts it -- used to discard everything typed so far. The
 * draft is mirrored to localStorage instead of component state so it also survives closing and
 * reopening the app, and it holds only what the person typed into this form: no Dropbox paths,
 * credentials, or anything read from project data.
 */
const DRAFT_KEY = "mi.new-project.draft";

function readFormPayload(form: HTMLFormElement): ProjectPayload {
  const data = new FormData(form);
  return {
    name: String(data.get("name") ?? ""),
    slug: String(data.get("slug") ?? ""),
    client: String(data.get("client") ?? ""),
    location: String(data.get("location") ?? ""),
    status: String(data.get("status") ?? ""),
    workflow: String(data.get("workflow") ?? ""),
    projectType: String(data.get("projectType") ?? ""),
    scopes: data.getAll("scopes").map(String),
    dropboxMode: data.get("dropboxMode") === "link-existing" ? "link-existing" : "create",
    dropboxFolder: String(data.get("dropboxFolder") ?? ""),
    dropboxPath: String(data.get("dropboxPath") ?? ""),
  };
}

function saveDraft(payload: ProjectPayload): void {
  const typed = [payload.name, payload.slug, payload.client, payload.location, payload.dropboxFolder, payload.dropboxPath]
    .some((value) => value.trim() !== "") || payload.scopes.length > 0;
  try {
    if (typed) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be unavailable or full. Drafting is best effort and never blocks creation.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to recover from -- the draft is disposable by definition.
  }
}

function readDraft(): ProjectPayload | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectPayload> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      name: text(parsed.name),
      slug: text(parsed.slug),
      client: text(parsed.client),
      location: text(parsed.location),
      status: text(parsed.status),
      workflow: text(parsed.workflow),
      projectType: text(parsed.projectType),
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((scope) => typeof scope === "string") : [],
      dropboxMode: parsed.dropboxMode === "link-existing" ? "link-existing" : "create",
      dropboxFolder: text(parsed.dropboxFolder),
      dropboxPath: text(parsed.dropboxPath),
    };
  } catch {
    return null;
  }
}

/** Writes a restored draft back into the DOM. A select whose saved value is no longer offered
 * keeps its own default rather than blanking out. */
function applyDraft(form: HTMLFormElement, draft: ProjectPayload): void {
  for (const [key, value] of Object.entries(draft)) {
    if (key === "scopes" || typeof value !== "string" || !value) continue;
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLInputElement) field.value = value;
    else if (field instanceof HTMLSelectElement && [...field.options].some((option) => option.value === value)) {
      field.value = value;
    }
  }
  const scopes = new Set(draft.scopes);
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="scopes"]')) {
    box.checked = scopes.has(box.value);
  }
}

export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ProjectCreationPlan | null>(null);
  const [previewPayload, setPreviewPayload] = useState<ProjectPayload | null>(null);
  const [requestId, setRequestId] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropboxMode, setDropboxMode] = useState<"create" | "link-existing">("create");
  const [existingDropboxPath, setExistingDropboxPath] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const dropboxFolderInput = useRef<HTMLInputElement>(null);
  const dropboxPathInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const slugEdited = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe Electron capability check
    setMounted(true);
  }, []);

  // Runs before the numbering fetch below resolves, so a restored name or folder is never
  // overwritten by a suggestion -- that effect only fills fields it finds empty.
  useEffect(() => {
    if (!open || !formRef.current) return;
    const draft = readDraft();
    if (!draft) return;
    applyDraft(formRef.current, draft);
    // A restored slug is the person's own choice as much as a freshly typed one.
    if (draft.slug) slugEdited.current = true;
    queueMicrotask(() => {
      setDropboxMode(draft.dropboxMode);
      setExistingDropboxPath(draft.dropboxPath);
      setRestoredDraft(true);
    });
  }, [open]);

  async function chooseExistingDropboxFolder() {
    const result = await window.electronAPI?.dropbox.pickProjectFolder();
    if (!result || result.canceled) return;
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.relativePath && dropboxPathInput.current && formRef.current) {
      setExistingDropboxPath(result.relativePath);
      saveDraft({ ...readFormPayload(formRef.current), dropboxMode: "link-existing", dropboxPath: result.relativePath });
      setError("");
    }
  }

  /** Keeps the slug derived from the name until the person writes their own, then leaves it
   * alone for the rest of the session -- never silently overwriting a deliberate slug. */
  function handleFormChange(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const field = event.target;
    if (field instanceof HTMLInputElement && field.name === "slug") slugEdited.current = true;
    if (field instanceof HTMLInputElement && field.name === "name" && !slugEdited.current) {
      const slugField = form.elements.namedItem("slug");
      if (slugField instanceof HTMLInputElement) slugField.value = projectSlugFromName(field.value);
    }
    if (field instanceof HTMLSelectElement && field.name === "workflow" && field.value === "marketing") {
      const projectType = form.elements.namedItem("projectType");
      if (projectType instanceof HTMLSelectElement && !projectType.value) projectType.value = "Marketing";
      const scopeBoxes = [...form.querySelectorAll<HTMLInputElement>('input[name="scopes"]')];
      if (!scopeBoxes.some((box) => box.checked)) {
        const marketingScope = scopeBoxes.find((box) => box.value === "Marketing");
        if (marketingScope) marketingScope.checked = true;
      }
    }
    saveDraft(readFormPayload(form));
  }

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects/next-numbering")
      .then((response) => response.json())
      .then((suggestion: NumberingSuggestion) => {
        // Only pre-fill if the user hasn't already typed something -- a suggestion, never
        // an override of what's already there.
        if (nameInput.current && !nameInput.current.value) {
          nameInput.current.value = suggestion.notionNamePrefix;
        }
        // Assigning .value fires no change event, so derive the slug from the pre-filled name
        // here as well -- otherwise the field would stay empty until the first keystroke.
        const slugField = formRef.current?.elements.namedItem("slug");
        if (slugField instanceof HTMLInputElement && !slugField.value && !slugEdited.current && nameInput.current) {
          slugField.value = projectSlugFromName(nameInput.current.value);
        }
        if (dropboxFolderInput.current && !dropboxFolderInput.current.value && suggestion.dropboxFolderPrefix) {
          dropboxFolderInput.current.value = suggestion.dropboxFolderPrefix;
        }
      })
      .catch(() => {
        // Best-effort only -- leave the fields blank/freeform if this fails.
      });
  }, [open]);

  async function previewPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = readFormPayload(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirmed: false }),
      });
      const result = (await response.json()) as { plan?: ProjectCreationPlan; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error || "Could not preview project.");
      setPreview(result.plan);
      setPreviewPayload(payload);
      setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not preview project.");
    } finally {
      setSaving(false);
    }
  }

  function addFolder() {
    const folder = newFolder.trim();
    if (!folder || !preview) return;
    if (preview.dropbox.folders.includes(folder)) { setNewFolder(""); return; }
    setPreview({ ...preview, dropbox: { ...preview.dropbox, folders: [...preview.dropbox.folders, folder] } });
    setNewFolder("");
  }

  function removeFolder(folder: string) {
    if (!preview) return;
    setPreview({
      ...preview,
      dropbox: { ...preview.dropbox, folders: preview.dropbox.folders.filter((entry) => entry !== folder) },
    });
  }

  async function createProject() {
    if (!preview || !previewPayload || !requestId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...previewPayload,
          ...(preview.dropbox.mode === "create" ? { folders: preview.dropbox.folders } : {}),
          confirmed: true,
          clientRequestId: requestId,
          previewPlan: preview,
        }),
      });
      const result = (await response.json()) as { slug?: string; error?: string };
      if (!response.ok || !result.slug) throw new Error(result.error || "Could not create project.");
      clearDraft();
      window.dispatchEvent(new Event(PROJECT_LIST_CHANGED_EVENT));
      router.push(`/projects/${result.slug}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-foreground px-4 py-2 text-sm text-background">
        New project
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      {!preview ? (
        <form
          ref={formRef}
          onSubmit={previewPlan}
          onChange={handleFormChange}
          className="grid gap-3 md:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Project name
            <input ref={nameInput} name="name" required className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
            <span className="text-xs text-muted-foreground">Pre-filled with today&apos;s date stamp, matching recent real projects &mdash; edit freely.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mi slug
            <input name="slug" placeholder="26-0804-project-name" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
            <span className="text-xs text-muted-foreground">Written for you from the project name &mdash; type your own to take it over.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Client
            <input name="client" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Location
            <input name="location" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select name="status" defaultValue="not-started" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent">
              <option value="not-started">Not Started</option>
              <option value="in-progress">In Progress</option>
              <option value="complete">Complete</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Working folder profile
            <select name="workflow" defaultValue="architecture" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent">
              {Object.entries(PROJECT_WORKFLOW_PROFILES).map(([value, profile]) => (
                <option key={value} value={value}>{profile.label}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">A starting point only &mdash; you can add, rename, or remove folders before creating.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Notion Project Type
            <select name="projectType" defaultValue="" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent">
              <option value="">Leave blank</option>
              {NOTION_PROJECT_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Dropbox setup
            <select
              name="dropboxMode"
              value={dropboxMode}
              onChange={(event) => setDropboxMode(event.target.value as "create" | "link-existing")}
              className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent"
            >
              <option value="create">Create a new standard project folder</option>
              <option value="link-existing">Use an existing Dropbox project folder</option>
            </select>
            <span className="text-xs text-muted-foreground">The exact choice is shown again in the confirmation preview.</span>
          </label>
          {dropboxMode === "create" ? (
            <label className="flex flex-col gap-1 text-sm">
              Dropbox project folder name
              <input ref={dropboxFolderInput} name="dropboxFolder" placeholder="Defaults to project name" className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
              <span className="text-xs text-muted-foreground">Pre-filled with the next available folder number, if your Dropbox root is reachable.</span>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              Existing Dropbox project folder
              <div className="flex gap-2">
                <input
                  ref={dropboxPathInput}
                  name="dropboxPath"
                  value={existingDropboxPath}
                  onChange={(event) => setExistingDropboxPath(event.target.value)}
                  required
                  placeholder="1.00 PROJECTS/Existing Project"
                  className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent"
                />
                {mounted && window.electronAPI?.dropbox && (
                  <button
                    type="button"
                    onClick={() => void chooseExistingDropboxFolder()}
                    className="shrink-0 rounded-md border border-border px-3 py-2 text-xs hover:border-accent"
                  >
                    Search &amp; select
                  </button>
                )}
              </div>
              <span className="text-xs text-muted-foreground">Select the real existing folder. Mi will link it without changing its contents.</span>
            </label>
          )}
          <fieldset className="md:col-span-2">
            <legend className="text-sm">Notion Scope (choose only confirmed values)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {NOTION_PROJECT_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <input type="checkbox" name="scopes" value={scope} />
                  {scope}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-3 md:col-span-2">
            <button type="submit" disabled={saving} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
              {saving ? "Checking…" : "Preview creation plan"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setRestoredDraft(false);
                setOpen(false);
              }}
              className="text-sm text-muted-foreground hover:underline"
            >
              Cancel
            </button>
            {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          </div>
          {restoredDraft && (
            <p role="status" className="text-xs text-muted-foreground md:col-span-2">
              Restored what you had typed here before. Cancel discards it.
            </p>
          )}
        </form>
      ) : (
        <div>
          <h3 className="font-medium">Review before creating</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing was created by the preview. Confirmation {preview.dropbox.mode === "create"
              ? "creates the reviewed Dropbox folders, one Studio Projects page, then the local Mi record."
              : "links the selected existing Dropbox folder, creates one Studio Projects page, then adds the local Mi record."}
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <section className="rounded-md border border-border p-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mi</h4>
              <p className="mt-2 text-sm font-medium">{preview.mi.localPath}</p>
              <p className="mt-1 text-xs text-muted-foreground">{preview.mi.behavior}</p>
            </section>
            <section className="rounded-md border border-border p-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notion</h4>
              <p className="mt-2 text-sm">{preview.notion.database}</p>
              <p className="mt-1 text-xs text-muted-foreground">Type: {preview.notion.projectType ?? "blank"}</p>
              <p className="text-xs text-muted-foreground">Scope: {preview.notion.scopes.join(", ") || "blank"}</p>
            </section>
            <section className="rounded-md border border-border p-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dropbox</h4>
              <p className="mt-2 break-all text-sm font-medium">{preview.dropbox.relativePath}</p>
              <p className="mt-1 text-xs text-muted-foreground">{preview.dropbox.behavior}</p>
            </section>
          </div>
          {preview.dropbox.mode === "create" ? <details open className="mt-4 rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Folders to create ({preview.dropbox.folders.length})</summary>
            <p className="mt-1 text-xs text-muted-foreground">
              Edit this list before confirming &mdash; real projects vary, so treat the profile as a starting point.
            </p>
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {preview.dropbox.folders.map((folder) => (
                <li key={folder} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">{folder}</span>
                  <button type="button" onClick={() => removeFolder(folder)} className="text-muted-foreground hover:text-foreground">×</button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder="Add a folder (e.g. 08_Renderings)"
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
              />
              <button type="button" onClick={addFolder} className="rounded-md border border-border px-3 py-1 text-xs">Add</button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Plus <code>Mi/</code> &mdash; created empty; agent instructions generate the first time you use the
              Agent Workspace refresh on this project&apos;s Files &amp; Contracts page.
            </p>
          </details> : (
            <div className="mt-4 rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Existing folder selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Confirmation creates the Mi project record and Notion project link. No folder,
                file, or agent workspace will be added to this Dropbox folder.
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={createProject} disabled={saving} className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50">
              {saving ? "Creating confirmed project…" : preview.dropbox.mode === "create" ? "Confirm and create folders + project" : "Confirm folder link + project"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setPreviewPayload(null);
                setRequestId("");
                setError("");
              }}
              disabled={saving}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Edit details
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="text-sm text-muted-foreground hover:underline">Cancel</button>
            {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
