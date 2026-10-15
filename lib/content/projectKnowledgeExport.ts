import { getProject } from "./projects";
import { getProjectDetails, getProjectMemory } from "./projectWorkspace";
import { readProjectKnowledge } from "./projectKnowledge";
import { DETAIL_LABELS } from "@/components/projectDetailsChanges";
import type { KnowledgePublishEntry } from "@/src/services/projectKnowledgeNotion";

/** Uses stored facts only; every exported value is included in the publishing preview. */
export function projectKnowledgeExport(slug: string) {
  const project = getProject(slug);
  const details = getProjectDetails(slug);
  const knowledge = readProjectKnowledge(getProjectMemory(slug));
  const entries: KnowledgePublishEntry[] = [];
  const facts = Object.entries(details).flatMap(([key, value]) => {
    if (key === "fee_currency" && details.fee === null) return [];
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) return [];
    const rendered = Array.isArray(value) ? value.map(item => Object.entries(item)
      .filter(([field, entry]) => field !== "id" && entry !== "" && entry !== null)
      .map(([field, entry]) => `${field.replaceAll("_", " ")}: ${entry}`).join("; ")).join("\n") : String(value);
    return [`${DETAIL_LABELS[key as keyof typeof details]}: ${rendered}`];
  });
  if (facts.length) entries.push({ title: "Project details", body: facts.join("\n\n") });
  if (knowledge?.preamble.trim()) entries.push({ title: "Project knowledge overview", body: knowledge.preamble.trim() });
  for (const entry of knowledge?.entries ?? []) entries.push({ title: entry.heading, body: entry.body });
  return { project, entries };
}
