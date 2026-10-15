import fs from "node:fs";
import path from "node:path";
import { resolveFirmDataDir } from "./paths";

/** Creates the reviews/ subfolder for an existing permit-qaqc/<slug>/ dir, without touching qaqc.yaml. Shared by scaffoldPermitQaqcEngagement and createPermitQaqcEngagement so both end up with the same layout. */
export function ensurePermitQaqcSubdirs(engagementDir: string): void {
  fs.mkdirSync(path.join(engagementDir, "reviews"), { recursive: true });
}

export interface ScaffoldPermitQaqcOptions {
  submittingFirm?: string;
  engagementNumber?: string | null;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function scaffoldPermitQaqcFiles(name: string, options: ScaffoldPermitQaqcOptions): Record<string, string> {
  const submittingFirm = options.submittingFirm?.trim() || "";
  const engagementNumber = options.engagementNumber?.trim() || null;

  return {
    "qaqc.yaml": `name: ${yamlString(name)}
# The firm whose drawings STUDIO is reviewing/stamping (e.g. "SampleConsultant", "SampleConsultant+Consultant").
submitting_firm: ${yamlString(submittingFirm)}
# See permitQaqcStatusSchema in lib/schema.ts for the allowed values.
status: received
# This engagement's real Dropbox folder (Received/Sent/Admin/Reference), relative to
# DROPBOX_ROOT. Never inferred from the name -- set explicitly once a human confirms
# the real folder (it already exists; Mi never creates it for an onboarded engagement).
dropbox_path: null
engagement_number: ${engagementNumber === null ? "null" : yamlString(engagementNumber)}
rounds: []
notes: ""
`,
  };
}

/** Creates permit-qaqc/<slug>/ with the standard schema-valid engagement layout. */
export function scaffoldPermitQaqcEngagement(
  slug: string,
  name: string,
  options: ScaffoldPermitQaqcOptions = {},
): void {
  const permitQaqcDirRoot = resolveFirmDataDir("permit-qaqc").dir;
  const engagementDir = path.join(permitQaqcDirRoot, slug);
  if (fs.existsSync(engagementDir)) throw new Error(`permit-qaqc/${slug} already exists.`);

  fs.mkdirSync(engagementDir, { recursive: true });
  ensurePermitQaqcSubdirs(engagementDir);
  for (const [relativePath, content] of Object.entries(scaffoldPermitQaqcFiles(name, options))) {
    fs.writeFileSync(path.join(engagementDir, relativePath), content, "utf8");
  }
}
