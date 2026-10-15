import path from "node:path";
import readline from "node:readline/promises";
import { getProject, getProjectSlugs } from "@/lib/content";
import { PROJECTS_DIR } from "@/lib/content/paths";
import { listStudioProjectPages } from "@/src/adapters/notion/studioProjects";
import { matchProjectName } from "@/src/domain/project";
import { patchScalarField } from "@/src/adapters/repo/patchYamlField";

export async function notionLinkCommand(args: string[]): Promise<void> {
  const [slug] = args;
  if (!slug) {
    console.error("Usage: npm run mi -- notion link <slug>");
    process.exit(1);
  }
  if (!getProjectSlugs().includes(slug)) {
    console.error(`No project at projects/${slug}/.`);
    process.exit(1);
  }

  const project = getProject(slug);
  if (project.meta.notion_page_id) {
    console.log(`projects/${slug} is already linked to Notion page ${project.meta.notion_page_id}.`);
    console.log("Delete the notion_page_id line in project.yaml first if you want to re-link.");
    return;
  }

  console.log(`Searching Studio Projects in Notion for a match to "${project.meta.name}"...`);
  const pages = await listStudioProjectPages();
  const ranked = matchProjectName(project.meta.name, pages).slice(0, 5);

  if (ranked.length === 0 || ranked[0].score === 0) {
    console.log("No plausible match found. Run `npm run notion-probe` to confirm Studio Projects is shared, or check the project name.");
    return;
  }

  console.log("\nCandidates (best match first):");
  ranked.forEach((candidate, i) => {
    console.log(`  ${i + 1}. "${candidate.name}" (score ${candidate.score.toFixed(2)}) — ${candidate.id}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `\nLink projects/${slug} to candidate #1 ("${ranked[0].name}")? [y/N/<number>]: `,
    );
    const trimmed = answer.trim().toLowerCase();

    let chosen: (typeof ranked)[number] | undefined;
    if (trimmed === "y" || trimmed === "yes") {
      chosen = ranked[0];
    } else if (/^\d+$/.test(trimmed)) {
      chosen = ranked[Number(trimmed) - 1];
    }

    if (!chosen) {
      console.log("Not linked.");
      return;
    }

    const filePath = path.join(PROJECTS_DIR, slug, "project.yaml");
    patchScalarField(filePath, "notion_page_id", `"${chosen.id}"`);
    console.log(`Linked projects/${slug} to "${chosen.name}" (${chosen.id}).`);
  } finally {
    rl.close();
  }
}
