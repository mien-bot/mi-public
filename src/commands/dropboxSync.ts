import {
  getAllProjects,
  getProjectSlugs,
  mirrorProjectKnowledge,
  previewProjectKnowledgeMirror,
} from "@/lib/content";

export interface DropboxSyncOptions {
  all: boolean;
  slug: string | null;
  apply: boolean;
  confirmProject: string | null;
}

export function parseDropboxSyncArgs(args: string[]): DropboxSyncOptions {
  let all = false;
  let apply = false;
  let confirmProject: string | null = null;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--confirm-project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--confirm-project requires a slug.");
      confirmProject = value;
      index++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      positional.push(arg);
    }
  }

  if (all && positional.length > 0) throw new Error("Choose a project slug or --all, not both.");
  if (!all && positional.length !== 1) {
    throw new Error("Usage: mi dropbox sync <slug> [--apply --confirm-project <slug>] | --all");
  }
  if (all && apply) {
    throw new Error("Dropbox writes must be applied one project at a time after reviewing the preview.");
  }
  const slug = positional[0] ?? null;
  if (apply && confirmProject !== slug) {
    throw new Error(`--apply requires --confirm-project ${slug} as a second, exact confirmation.`);
  }
  if (!apply && confirmProject) {
    throw new Error("--confirm-project is only valid together with --apply.");
  }
  return { all, slug, apply, confirmProject };
}

export function dropboxSyncCommand(args: string[]): void {
  const options = parseDropboxSyncArgs(args);

  const slugs = options.all
    ? getAllProjects().filter((project) => project.meta.dropbox_path).map((project) => project.slug)
    : [options.slug as string];
  const knownSlugs = new Set(getProjectSlugs());

  for (const projectSlug of slugs) {
    if (!knownSlugs.has(projectSlug)) {
      console.error(`No project at projects/${projectSlug}/.`);
      continue;
    }
    const preview = previewProjectKnowledgeMirror(projectSlug);
    if (!preview.mirrored) {
      if (preview.reason === "conflict") {
        const paths = preview.conflicts?.map((conflict) => conflict.relativePath).join(", ") || "unknown files";
        console.log(`${projectSlug}: blocked by ${preview.conflicts?.length ?? 0} user-owned conflict(s): ${paths}`);
        continue;
      }
      console.log(`${projectSlug}: skipped (${preview.reason})`);
      continue;
    }
    if (!options.apply) {
      const changes = preview.entries?.filter((entry) => entry.action !== "identical").length ?? preview.fileCount;
      console.log(
        `${projectSlug}: would refresh ${changes} of ${preview.fileCount} file(s) in ${preview.destination}`,
      );
      continue;
    }
    const result = mirrorProjectKnowledge(projectSlug);
    if (!result.mirrored) {
      throw new Error(`${projectSlug}: mirror stopped (${result.reason}). No files were overwritten.`);
    }
    const changed = result.entries?.filter((entry) => entry.action !== "identical").length ?? result.fileCount;
    console.log(`${projectSlug}: refreshed ${changed} file(s) in ${result.destination}`);
  }

  if (!options.apply) {
    console.log(
      options.all
        ? "Preview only. Apply one reviewed project at a time."
        : `Preview only. Re-run with --apply --confirm-project ${options.slug} to write to Dropbox.`,
    );
  }
}
