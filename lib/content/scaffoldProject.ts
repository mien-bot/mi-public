import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./paths";

const SCAFFOLD_DIRS = [
  "progress-log",
  "reviews",
  "markups/originals",
  "markups/redlines",
  "drawings/sd",
  "drawings/dd",
  "drawings/cd",
  "drawings/ca",
  "references/drawing-sets",
  "references/codes-to-follow",
  "mep",
  "permits",
  "schedule",
  "budget",
  "lessons-learned",
  "checklists",
  "qaqc",
  "questions",
  "submissions/archive",
  "deliverables",
  "inspiration",
  "contracts/archive",
  "memory",
];

export interface ScaffoldProjectOptions {
  client?: string | null;
  address?: string | null;
  status?: "not-started" | "in-progress" | "complete" | "abandoned" | null;
  /** Set immediately when known (e.g. scaffolding from a Notion picker selection). */
  notionPageId?: string | null;
  dropboxPath?: string | null;
  projectType?: string | null;
  scopeLabels?: string[];
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function scaffoldProjectFiles(name: string, options: ScaffoldProjectOptions): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  const status = options.status ?? "not-started";
  const notionPageId = options.notionPageId ? yamlString(options.notionPageId) : "null";
  const dropboxPath = options.dropboxPath ? yamlString(options.dropboxPath) : "null";
  const projectType = options.projectType?.trim() || "";
  const scope = (options.scopeLabels ?? []).join(", ");

  return {
    "project.yaml": `name: ${yamlString(name)}
address: ${yamlString(options.address?.trim() || "")}
client: ${yamlString(options.client?.trim() || "")}
status: ${status}
building_type: null
occupancy_group: []
start_date: null
team: []
dropbox_path: ${dropboxPath}
notion_page_id: ${notionPageId}
client_id: null
`,
    "details.yaml": `client_name: ${yamlString(options.client?.trim() || "")}
client_contacts: []
address: ${yamlString(options.address?.trim() || "")}
scope: ${yamlString(scope)}
project_type: ${yamlString(projectType)}
team: []
fee: null
fee_currency: USD
fee_notes: ""
contract_link_or_path: ""
phases: []
`,
    [`progress-log/${today}.md`]: `---
date: ${today}
author: "Mi"
type: progress-log
tags: [project-created]
---

Project created in Mi.
`,
    "markups/originals/.gitkeep": "Place unmarked, original sheet PDFs/scans here. Local/Dropbox only.\n",
    "markups/redlines/.gitkeep": "Place annotated/redlined sheet PDFs or images here. Local/Dropbox only.\n",
    "markups/index.yaml": "[]\n",
    "drawings/index.yaml": "[]\n",
    "drawings/sd/.gitkeep": "Schematic Design sheet PDFs. Local/Dropbox only.\n",
    "drawings/dd/.gitkeep": "Design Development sheet PDFs. Local/Dropbox only.\n",
    "drawings/cd/.gitkeep": "Construction Documents sheet PDFs. Local/Dropbox only.\n",
    "drawings/ca/.gitkeep": "Construction Administration sheet PDFs. Local/Dropbox only.\n",
    "references/drawing-sets/.gitkeep": "Reference and precedent drawing sets. Local/Dropbox only.\n",
    "references/codes-to-follow/.gitkeep": "Project-specific source code and permit documents. Local/Dropbox only.\n",
    "references/links.md": `---
last_updated: ${yamlString(today)}
---

## Project links
`,
    "mep/mechanical.md": `---
discipline: mechanical
last_updated: ${yamlString(today)}
---

## Open questions
`,
    "mep/electrical.md": `---
discipline: electrical
last_updated: ${yamlString(today)}
---

## Open questions
`,
    "mep/plumbing.md": `---
discipline: plumbing
last_updated: ${yamlString(today)}
---

## Open questions
`,
    "permits/status.yaml": "[]\n",
    "schedule/schedule.yaml": "milestones: []\n",
    "budget/budget.yaml": "categories: []\n",
    "lessons-learned/lessons.md": `---
last_updated: ${yamlString(today)}
---
`,
    "checklists/code-compliance.yaml": "checklist_id: code-compliance-v1\nitems: []\n",
    "qaqc/qaqc.yaml": "checklist_id: qaqc-v1\nitems: []\n",
    "questions/questions.md": `---
last_updated: ${yamlString(today)}
---

## Open questions
`,
    "submissions/index.yaml": "[]\n",
    "submissions/archive/.gitkeep": "Superseded submission packages. Local/Dropbox only.\n",
    "deliverables/index.yaml": "[]\n",
    "inspiration/index.yaml": "[]\n",
    "contracts/index.yaml": "[]\n",
    "contracts/archive/.gitkeep": "Superseded agreement versions. Local/Dropbox only.\n",
    "memory/notes.md": `---
last_updated: ${yamlString(today)}
---

Project facts, decisions, and durable context for Mi agents.
`,
  };
}

/** Creates projects/<slug>/ with the standard schema-valid project layout. */
export function scaffoldProject(slug: string, name: string, options: ScaffoldProjectOptions = {}): void {
  const projectDir = path.join(PROJECTS_DIR, slug);
  if (fs.existsSync(projectDir)) throw new Error(`projects/${slug} already exists.`);

  for (const dir of SCAFFOLD_DIRS) fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  for (const [relativePath, content] of Object.entries(scaffoldProjectFiles(name, options))) {
    fs.writeFileSync(path.join(projectDir, relativePath), content, "utf8");
  }
}
