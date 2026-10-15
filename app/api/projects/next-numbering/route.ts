import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DROPBOX_ROOT } from "@/lib/content/paths";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Suggests, but never enforces, two independent naming conventions confirmed against real
 * project data (2026-07-26): recent Notion project titles lean on a YY_MMDD_ date stamp
 * (e.g. "example-record-55"), while real Dropbox project folders use a plain
 * incrementing NN_ prefix unrelated to date (e.g. "11_1002 S Example Blvd Ave"). Both are
 * editable defaults returned for the New Project form to pre-fill -- never validated or
 * required, matching this app's "suggest, never guess/enforce" rule.
 */
export async function GET() {
  const now = new Date();
  const notionNamePrefix = `${pad2(now.getFullYear() % 100)}_${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_`;

  let dropboxFolderPrefix: string | null = null;
  if (DROPBOX_ROOT) {
    try {
      const projectsRoot = path.join(DROPBOX_ROOT, "1.00 PROJECTS");
      if (fs.existsSync(projectsRoot)) {
        let max = 0;
        for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          // The sequence number is always followed by an underscore ("07_SampleStudio",
          // "21_ABC Clinic"). Requiring it keeps year folders sitting in the same directory
          // ("2024", "2025 Archive") from reading as project number 2024 and suggesting a
          // year as the next number. Up to three digits, so passing 99 still works while a
          // four-digit year never matches.
          const match = /^(\d{1,3})_/.exec(entry.name);
          if (match) max = Math.max(max, Number(match[1]));
        }
        dropboxFolderPrefix = `${pad2(max + 1)}_`;
      }
    } catch {
      dropboxFolderPrefix = null;
    }
  }

  return NextResponse.json({ notionNamePrefix, dropboxFolderPrefix });
}
