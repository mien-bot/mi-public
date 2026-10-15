import fs from "node:fs";
import path from "node:path";
import { getProject, getProjectSlugs } from "@/lib/content";
import { PROJECTS_DIR, DROPBOX_ROOT } from "@/lib/content/paths";
import { patchScalarField } from "@/src/adapters/repo/patchYamlField";

export async function dropboxLinkCommand(args: string[]): Promise<void> {
  const [slug, ...rest] = args;
  const relativePath = rest.join(" ");
  if (!slug || !relativePath) {
    console.error('Usage: npm run mi -- dropbox link <slug> "<path relative to DROPBOX_ROOT>"');
    console.error("Try `npm run suggest-dropbox-links` first for candidate paths.");
    process.exit(1);
  }
  if (!getProjectSlugs().includes(slug)) {
    console.error(`No project at projects/${slug}/.`);
    process.exit(1);
  }

  const project = getProject(slug);
  if (project.meta.dropbox_path) {
    console.log(`projects/${slug} is already linked to "${project.meta.dropbox_path}".`);
    console.log("Delete the dropbox_path line in project.yaml first if you want to re-link.");
    return;
  }

  if (DROPBOX_ROOT) {
    const target = path.join(DROPBOX_ROOT, relativePath);
    if (!fs.existsSync(target)) {
      console.error(
        `Warning: "${target}" doesn't exist on this machine — linking anyway ` +
          "(DROPBOX_ROOT is per-machine, so this could still be correct on another machine).",
      );
    }
  }

  const filePath = path.join(PROJECTS_DIR, slug, "project.yaml");
  patchScalarField(filePath, "dropbox_path", `"${relativePath}"`);
  console.log(`Linked projects/${slug} to Dropbox folder "${relativePath}".`);
}
