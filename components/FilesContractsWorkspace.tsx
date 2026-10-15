import Link from "next/link";
import type { DropboxContractCandidate } from "@/lib/content/projectWorkspace";
import { DropboxFolderSelector } from "./DropboxFolderSelector";
import { AgentWorkspaceManager } from "./AgentWorkspaceManager";

export function FilesContractsWorkspace({
  slug,
  dropboxPath,
  candidates,
  indexedContracts,
}: {
  slug: string;
  dropboxPath: string | null;
  candidates: DropboxContractCandidate[];
  indexedContracts: { file: string; title: string }[];
}) {
  return (
    <div className="space-y-6">
      <DropboxFolderSelector slug={slug} currentPath={dropboxPath} />
      <AgentWorkspaceManager slug={slug} />
      <section className="rounded-lg border border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Likely Dropbox contracts</h2>
            <p className="text-sm text-muted-foreground">
              Read-only filename discovery inside the linked project folder. No file contents are parsed.
            </p>
          </div>
          <Link href={`/projects/${slug}/details`} className="text-sm hover:underline">
            Select a candidate in Project Details
          </Link>
        </div>
        <ul className="mt-4 space-y-2">
          {candidates.map((candidate) => (
            <li key={candidate.relative_path} className="rounded-md border border-border p-3 text-sm">
              <div>{candidate.name}</div>
              <code className="text-xs text-muted-foreground">{candidate.relative_path}</code>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No likely contract filenames discovered in the linked folder.
            </li>
          )}
        </ul>
      </section>
      <section className="rounded-lg border border-border p-5">
        <h2 className="font-medium">Mi-local contracts index</h2>
        <ul className="mt-3 space-y-2">
          {indexedContracts.map((contract) => (
            <li key={contract.file} className="text-sm">{contract.title || contract.file}</li>
          ))}
          {indexedContracts.length === 0 && (
            <li className="text-sm text-muted-foreground">The local contracts index is empty.</li>
          )}
        </ul>
        <Link href={`/projects/${slug}/contracts`} className="mt-3 inline-block text-sm hover:underline">
          Open local contracts page
        </Link>
      </section>
    </div>
  );
}
