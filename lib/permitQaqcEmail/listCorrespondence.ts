import type { DropboxNode } from "@/lib/content/dropbox";
import { parseEmailFile, type ParsedEmail } from "./parseEmail";

function collectEmlPaths(nodes: DropboxNode[]): string[][] {
  const paths: string[][] = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      if (node.children) paths.push(...collectEmlPaths(node.children));
      continue;
    }
    if (node.name.toLowerCase().endsWith(".eml")) {
      paths.push(node.relativePath.split(/[/\\]/));
    }
  }
  return paths;
}

export interface CorrespondenceListResult {
  emails: ParsedEmail[];
  errors: { relativePath: string; error: string }[];
}

/**
 * Parses every .eml file found anywhere in a Dropbox folder tree, newest first.
 * Read-only, on the fly -- nothing is persisted locally. Shared by the correspondence
 * API route and the engagement detail page's server-rendered initial view, so both
 * stay in sync with one implementation.
 */
export async function listPermitQaqcCorrespondence(dropboxDir: string, tree: DropboxNode[]): Promise<CorrespondenceListResult> {
  const emlPaths = collectEmlPaths(tree);
  const emails: ParsedEmail[] = [];
  const errors: { relativePath: string; error: string }[] = [];

  for (const segments of emlPaths) {
    try {
      emails.push(await parseEmailFile(dropboxDir, segments));
    } catch (cause) {
      errors.push({
        relativePath: segments.join("/"),
        error: cause instanceof Error ? cause.message : "Could not parse this email.",
      });
    }
  }
  emails.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { emails, errors };
}
