"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LEAD_FILE_KINDS,
  LEAD_FILE_KIND_LABEL,
  type LeadConversionPlan,
} from "@/lib/content/leadHandoffPlan";
import { PROJECT_WORKFLOW_PROFILES, type ProjectWorkflowProfile } from "@/lib/content/projectCreationPlan";
import { leadProjectName } from "@/lib/content/leadProjectName";

interface PreviewResponse {
  plan?: LeadConversionPlan;
  handoffPreview?: string | null;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Conversion is three real writes -- a Dropbox folder seeded with the lead's own material, a
 * Studio Projects page, and the local Mi record -- so it uses the same preview-then-confirm
 * boundary as the New Project form. Every settings change re-previews on the server rather
 * than editing the plan locally, because the copy destinations are derived from the folder
 * list: a locally edited plan would no longer be the plan the server applies.
 */
export function ConvertLeadButton({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const projectName = leadProjectName(name);
  const [open, setOpen] = useState(false);
  const [workflow, setWorkflow] = useState<ProjectWorkflowProfile>("architecture");
  const [folderName, setFolderName] = useState(projectName);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [notionPage, setNotionPage] = useState<"create" | "skip">("create");
  const [newFolder, setNewFolder] = useState("");
  const [plan, setPlan] = useState<LeadConversionPlan | null>(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [requestId, setRequestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState("");
  const numbered = useRef(false);

  const settings = useCallback(() => ({
    workflow,
    dropboxFolder: folderName,
    notionPage,
    ...(folders ? { folders } : {}),
  }), [workflow, folderName, notionPage, folders]);

  // Suggests the next Dropbox folder number the same way the New Project form does. A
  // suggestion only: it never overwrites a name already edited here.
  useEffect(() => {
    if (!open || numbered.current) return;
    numbered.current = true;
    fetch("/api/projects/next-numbering")
      .then((response) => response.json())
      .then((suggestion: { dropboxFolderPrefix: string | null }) => {
        if (suggestion.dropboxFolderPrefix) setFolderName(`${suggestion.dropboxFolderPrefix}${projectName}`);
      })
      .catch(() => {
        // Best effort -- the project name without a folder number is a fine default.
      });
  }, [open, projectName]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/leads/${encodeURIComponent(slug)}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings(), confirmed: false }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => ({}))) as PreviewResponse;
          if (!response.ok || !result.plan) throw new Error(result.error || "Could not preview the conversion.");
          setPlan(result.plan);
          setHandoff(result.handoffPreview ?? null);
          setRequestId(crypto.randomUUID());
          setMessage("");
        })
        .catch((cause: Error) => {
          if (cause.name === "AbortError") return;
          setPlan(null);
          setMessage(cause.message);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, slug, settings]);

  async function convert() {
    if (!plan || !requestId) return;
    setConverting(true);
    setMessage("");
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...settings(),
        folders: plan.project.dropbox.folders,
        confirmed: true,
        clientRequestId: requestId,
        previewPlan: plan,
      }),
    }).catch(() => null);
    if (!response) {
      setMessage("Could not reach the local Mi server.");
      setConverting(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as { error?: string; projectSlug?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Lead could not be converted.");
      setConverting(false);
      return;
    }
    setOpen(false);
    if (result.projectSlug) router.push(`/projects/${result.projectSlug}`);
    router.refresh();
  }

  function close() {
    setOpen(false);
    setPlan(null);
    setHandoff(null);
    setFolders(null);
    setMessage("");
  }

  const seed = plan?.seed;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-foreground px-3 py-2 text-sm text-background"
      >
        Convert to project
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`convert-lead-${slug}`}
            className="my-8 w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-xl"
          >
            <h2 id={`convert-lead-${slug}`} className="font-medium">Convert {name} to a project?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Creates the Dropbox project folder below, seeds it with this lead&apos;s own records and
              files, adds the Studio Projects page, then links the lead to the new project. Nothing is
              created until you confirm. The lead&apos;s own Dropbox folder is never moved or emptied
              &mdash; its files are copied, and the originals stay where they are.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Working folder profile
                <select
                  value={workflow}
                  onChange={(event) => {
                    setWorkflow(event.target.value as ProjectWorkflowProfile);
                    setFolders(null);
                  }}
                  className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent"
                >
                  {Object.entries(PROJECT_WORKFLOW_PROFILES).map(([value, profile]) => (
                    <option key={value} value={value}>{profile.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Dropbox folder name
                <input
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  className="rounded-md border border-border bg-card px-3 py-2 outline-none focus:border-accent"
                />
              </label>
            </div>

            {plan && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <section className="rounded-md border border-border p-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mi</h3>
                  <p className="mt-2 break-all text-sm">{plan.project.mi.localPath}</p>
                </section>
                <section className="rounded-md border border-border p-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dropbox</h3>
                  <p className="mt-2 break-all text-sm">
                    {plan.dropbox === "create"
                      ? plan.project.dropbox.relativePath
                      : "No Dropbox root configured — no folder will be created."}
                  </p>
                </section>
              </div>
            )}

            {plan?.dropbox === "create" && (
              <details open className="mt-3 rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Folders to create ({plan.project.dropbox.folders.length})
                </summary>
                <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {plan.project.dropbox.folders.map((folder) => (
                    <li key={folder} className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate">{folder}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${folder}`}
                        onClick={() => setFolders(plan.project.dropbox.folders.filter((entry) => entry !== folder))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
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
                  <button
                    type="button"
                    onClick={() => {
                      const folder = newFolder.trim();
                      if (!folder || plan.project.dropbox.folders.includes(folder)) return;
                      setFolders([...plan.project.dropbox.folders, folder]);
                      setNewFolder("");
                    }}
                    className="rounded-md border border-border px-3 py-1 text-xs"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Plus <code>Mi/</code>, created empty. Removing a folder that lead files were headed
                  for sends them to <code>00_From-Lead/</code> instead.
                </p>
              </details>
            )}

            {seed && (
              <details open className="mt-3 rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Lead material to copy in ({seed.copies.length} file{seed.copies.length === 1 ? "" : "s"}
                  {seed.copies.length > 0 ? `, ${formatBytes(seed.totalBytes)}` : ""})
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  <code>{seed.handoffFile}</code> — the lead&apos;s fields, notes, contract notes,{" "}
                  {seed.counts.siteVisits} site visit(s), {seed.counts.correspondence} correspondence
                  entr(ies), and {seed.counts.meetings} meeting(s).
                </p>
                {LEAD_FILE_KINDS.map((kind) => {
                  const forKind = seed.copies.filter((copy) => copy.kind === kind);
                  if (forKind.length === 0) return null;
                  return (
                    <div key={kind} className="mt-2">
                      <p className="text-xs font-medium">{LEAD_FILE_KIND_LABEL[kind]} ({forKind.length})</p>
                      <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
                        {forKind.map((copy) => (
                          <li key={copy.target} className="truncate">
                            <code>{copy.target}</code> — {formatBytes(copy.bytes)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                {seed.excluded.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Not copied: {seed.excluded.map((entry) => entry.source).join(", ")} — indexed by the
                    lead but missing or unsafe on disk.
                  </p>
                )}
                {plan?.lead.dropboxFolder && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The lead&apos;s own Dropbox folder (<code>{plan.lead.dropboxFolder}</code>) is recorded
                    in the brief and left untouched.
                  </p>
                )}
                {handoff && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Read the brief
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-xs">
                      {handoff}
                    </pre>
                  </details>
                )}
              </details>
            )}

            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={notionPage === "create"}
                onChange={(event) => setNotionPage(event.target.checked ? "create" : "skip")}
                className="mt-1"
              />
              <span>
                Create the Studio Projects page
                <span className="block text-xs text-muted-foreground">
                  Leave this off if Notion is unreachable — you can link the project to Notion later.
                </span>
              </span>
            </label>

            {message && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={converting}
                onClick={close}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={converting || loading || !plan}
                onClick={() => void convert()}
                className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
              >
                {converting ? "Converting…" : loading ? "Checking…" : "Confirm conversion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
