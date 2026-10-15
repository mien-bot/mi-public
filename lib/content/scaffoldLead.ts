import fs from "node:fs";
import path from "node:path";
import { resolveFirmDataDir } from "./paths";

const SCAFFOLD_DIRS = ["site-visits", "correspondence", "contracts/archive", "site-photos", "owner-supplied", "meetings"];
const EMPTY_SUBDIR_FILES: Record<string, string> = {
  "site-visits/index.yaml": "[]\n",
  "correspondence/index.yaml": "[]\n",
  "contracts/index.yaml": "[]\n",
  "contracts/archive/.gitkeep": "Superseded contract draft versions. Local/Dropbox only.\n",
  "site-photos/index.yaml": "[]\n",
  "owner-supplied/index.yaml": "[]\n",
};

/** Creates the site-visits/correspondence/contracts/site-photos/owner-supplied subfolders for an existing leads/<slug>/ dir, without touching lead.yaml. Shared by scaffoldLead and createLead (API-created leads) so both end up with the same layout. */
export function ensureLeadSubdirs(leadDir: string): void {
  for (const dir of SCAFFOLD_DIRS) fs.mkdirSync(path.join(leadDir, dir), { recursive: true });
  for (const [relativePath, content] of Object.entries(EMPTY_SUBDIR_FILES)) {
    const target = path.join(leadDir, relativePath);
    if (!fs.existsSync(target)) fs.writeFileSync(target, content, "utf8");
  }
}

export interface ScaffoldLeadOptions {
  source?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  referrerName?: string | null;
  estimatedValue?: number | null;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function scaffoldLeadFiles(name: string, options: ScaffoldLeadOptions): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  const source = options.source?.trim() || "other";
  const estimatedValue = options.estimatedValue ?? null;

  return {
    "lead.yaml": `name: ${yamlString(name)}
# See leadSourceSchema in lib/schema.ts for the allowed values.
source: ${source}
contact_name: ${yamlString(options.contactName?.trim() || "")}
contact_email: ${yamlString(options.contactEmail?.trim() || "")}
contact_phone: ${yamlString(options.contactPhone?.trim() || "")}
referrer_name: ${yamlString(options.referrerName?.trim() || "")}
date_received: "${today}"
status: new
estimated_value: ${estimatedValue === null ? "null" : estimatedValue}
notes: ""
lost_reason: null
# Slug of the projects/<slug>/ this becomes, once converted. Human-set/via
# the "Convert to project" action — never guessed.
converted_project_slug: null
converted_date: null
# This lead's real Dropbox folder (site visit photos, contract drafts,
# correspondence), relative to DROPBOX_ROOT. Never inferred from the name —
# set explicitly once a human confirms the real folder.
dropbox_path: null
contract_stage: not-sent
contract_notes: ""
notion_page_id: null
`,
  };
}

/** Creates leads/<slug>/ with the standard schema-valid lead layout. */
export function scaffoldLead(slug: string, name: string, options: ScaffoldLeadOptions = {}): void {
  const leadsDir = resolveFirmDataDir("leads").dir;
  const leadDir = path.join(leadsDir, slug);
  if (fs.existsSync(leadDir)) throw new Error(`leads/${slug} already exists.`);

  fs.mkdirSync(leadDir, { recursive: true });
  ensureLeadSubdirs(leadDir);
  for (const [relativePath, content] of Object.entries(scaffoldLeadFiles(name, options))) {
    fs.writeFileSync(path.join(leadDir, relativePath), content, "utf8");
  }
}
