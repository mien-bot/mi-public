/**
 * Phase 5 (stretch) prototype: suggests code sections a project's
 * code-compliance checklist doesn't cite yet, based on matching the
 * project's occupancy_group against each code section's
 * `applies_to_occupancy`. This is a suggestion aid, not a compliance
 * determination — every suggestion still needs a human to confirm
 * applicability and add the real discipline/description before it means
 * anything. Never treat its output as "checked."
 *
 * Usage:
 *   npm run suggest-checklist -- <project-slug>            (dry run, prints suggestions)
 *   npm run suggest-checklist -- <project-slug> --apply     (also appends them as
 *                                                             pending items to the
 *                                                             project's checklist)
 */
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { getAllCodeSections, getChecklist, getProject } from "../lib/content";
import { checklistSchema } from "../lib/schema";

const [, , slugArg, flag] = process.argv;

if (!slugArg) {
  console.error("Usage: npm run suggest-checklist -- <project-slug> [--apply]");
  process.exit(1);
}

function guessDiscipline(codeBook: string): "architectural" | "mechanical" | "electrical" | "plumbing" {
  if (codeBook === "ashrae") return "mechanical";
  return "architectural";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const project = getProject(slugArg);
const occupancyGroups = project.meta.occupancy_group;

const existingChecklist = getChecklist(slugArg);
const citedIds = new Set((existingChecklist?.items ?? []).flatMap((item) => item.code_refs));

const suggestions = getAllCodeSections().filter((section) => {
  const { id, applies_to_occupancy } = section.doc.frontmatter;
  if (citedIds.has(id)) return false;
  if (applies_to_occupancy.includes("all")) return true;
  return applies_to_occupancy.some((group) => group !== "all" && occupancyGroups.includes(group));
});

console.log(
  `Project "${project.meta.name}" — occupancy group(s): ${occupancyGroups.join(", ") || "(none set)"}`,
);

if (suggestions.length === 0) {
  console.log("No new suggestions — every applicable code section already appears on the checklist.");
  process.exit(0);
}

console.log(`\n${suggestions.length} suggested checklist item(s) not yet on the checklist:\n`);
for (const s of suggestions) {
  console.log(`- ${s.doc.frontmatter.id} — ${s.doc.frontmatter.title} (${s.doc.frontmatter.citation})`);
}

if (flag !== "--apply") {
  console.log("\nDry run only. Re-run with --apply to append these as pending checklist items.");
  process.exit(0);
}

const checklistPath = path.join(process.cwd(), "projects", slugArg, "checklists", "code-compliance.yaml");
const current = checklistSchema.parse(
  loadYaml(fs.readFileSync(checklistPath, "utf-8")) ?? { checklist_id: "code-compliance-v1", items: [] },
);

const existingIds = new Set(current.items.map((item) => item.id));
for (const s of suggestions) {
  let id = `${slugify(s.doc.frontmatter.title)}-check`;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${slugify(s.doc.frontmatter.title)}-check-${n++}`;
  }
  existingIds.add(id);
  current.items.push({
    id,
    description: `Verify compliance with ${s.doc.frontmatter.title} (${s.doc.frontmatter.citation}) — REVIEW: confirm description/discipline`,
    code_refs: [s.doc.frontmatter.id],
    discipline: guessDiscipline(s.doc.frontmatter.code_book),
    status: "pending",
    checked_by: null,
    checked_date: null,
    evidence: [],
  });
}

fs.writeFileSync(checklistPath, dumpYaml(current, { lineWidth: 100 }), "utf-8");
console.log(
  `\nAppended ${suggestions.length} item(s) to ${checklistPath}. Review each "REVIEW:" description/discipline before relying on it, then run npm run validate-content.`,
);
