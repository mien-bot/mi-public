import JSZip from "jszip";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  personalRecordDraftSchema,
  personalScheduleSchema,
  type PersonalRecord,
  type PersonalRecordDraft,
  type PersonalRecordKind,
  type PersonalRecordStatus,
} from "./schema";

export interface ObsidianMarkdownFile {
  name: string;
  content: string;
}

export interface ObsidianImportPreview {
  sourceName: string;
  draft: PersonalRecordDraft;
  warnings: string[];
}

const recordKinds = new Set<PersonalRecordKind>(["journal", "thought", "task", "plan"]);
const recordStatuses = new Set<PersonalRecordStatus>(["inbox", "active", "done", "archived"]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function markdownParts(content: string): { metadata: Record<string, unknown>; body: string; warning?: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { metadata: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { metadata: {}, body: normalized, warning: "Frontmatter was not closed, so Mi preserved it as note text." };
  try {
    return {
      metadata: objectValue(loadYaml(normalized.slice(4, end))) ?? {},
      body: normalized.slice(end + 5),
    };
  } catch {
    return { metadata: {}, body: normalized, warning: "Frontmatter could not be read, so Mi preserved it as note text." };
  }
}

function filenameTitle(name: string): string {
  return name.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim() || "Imported note";
}

function tagsValue(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  return [...new Set(values.map((entry) => String(entry).trim().replace(/^#/, "")).filter(Boolean))]
    .slice(0, 20)
    .map((tag) => tag.slice(0, 50));
}

export function previewObsidianMarkdown(file: ObsidianMarkdownFile): ObsidianImportPreview {
  if (file.content.length > 100_000) throw new Error(`${file.name} is larger than the 100 KB import limit.`);
  const warnings: string[] = [];
  const { metadata, body: rawBody, warning } = markdownParts(file.content);
  if (warning) warnings.push(warning);
  const mi = objectValue(metadata.mi) ?? {};
  const heading = rawBody.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const rawTitle = typeof metadata.title === "string"
    ? metadata.title.trim()
    : heading || filenameTitle(file.name);
  const title = rawTitle.slice(0, 200) || filenameTitle(file.name);
  if (rawTitle.length > 200) warnings.push("The title was shortened to 200 characters.");

  const rawKind = typeof mi.kind === "string" ? mi.kind : metadata.kind;
  const kind = typeof rawKind === "string" && recordKinds.has(rawKind as PersonalRecordKind)
    ? rawKind as PersonalRecordKind
    : "thought";
  if (kind === "thought" && rawKind !== "thought") {
    warnings.push("No recognized Mi record kind was found; review the Thought classification before importing.");
  }
  const rawStatus = typeof mi.status === "string" ? mi.status : metadata.status;
  const status = typeof rawStatus === "string" && recordStatuses.has(rawStatus as PersonalRecordStatus)
    ? rawStatus as PersonalRecordStatus
    : "inbox";
  if (rawStatus !== undefined && status === "inbox" && rawStatus !== "inbox") {
    warnings.push("The Obsidian status was not recognized; Mi set the draft to Inbox.");
  }

  const moodValue = typeof mi.mood === "string" ? mi.mood : metadata.mood;
  const mood = typeof moodValue === "string" && moodValue.trim()
    ? moodValue.trim().slice(0, 80)
    : null;
  let schedule = null;
  if (mi.schedule !== undefined && mi.schedule !== null) {
    const parsedSchedule = personalScheduleSchema.safeParse(mi.schedule);
    if (parsedSchedule.success) schedule = parsedSchedule.data;
    else warnings.push("Mi could not validate the exported schedule fields; review and add them after import.");
  }

  let body = rawBody.trim();
  if (heading && heading === rawTitle) body = body.replace(/^#\s+.+(?:\n+|$)/, "").trim();
  if (body.length > 20_000) {
    body = body.slice(0, 20_000);
    warnings.push("The note body was shortened to Mi's 20,000-character record limit.");
  }
  const tags = tagsValue(metadata.tags ?? mi.tags);
  if (Array.isArray(metadata.tags) && metadata.tags.length > 20) warnings.push("Only the first 20 tags will be imported.");

  return {
    sourceName: file.name,
    draft: personalRecordDraftSchema.parse({ kind, title, body, tags, mood, status, schedule }),
    warnings,
  };
}

export function previewObsidianFiles(files: ObsidianMarkdownFile[]): ObsidianImportPreview[] {
  if (files.length === 0) throw new Error("Choose at least one Obsidian Markdown file.");
  if (files.length > 100) throw new Error("Import no more than 100 Markdown files at a time.");
  return files.map(previewObsidianMarkdown);
}

export function personalRecordToObsidianMarkdown(record: PersonalRecord): string {
  const metadata = {
    title: record.title,
    tags: record.tags,
    mi: {
      kind: record.kind,
      status: record.status,
      mood: record.mood,
      schedule: record.schedule,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
  };
  return `---\n${dumpYaml(metadata, { lineWidth: 100, noRefs: true }).trim()}\n---\n\n# ${record.title}\n\n${record.body}\n`;
}

function safeFilename(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").slice(0, 100) || "Untitled";
}

export async function buildObsidianVaultZip(records: PersonalRecord[]): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder("Mi Personal")!;
  const names = new Map<string, number>();
  records.forEach((record) => {
    const base = safeFilename(record.title);
    const count = (names.get(base.toLowerCase()) ?? 0) + 1;
    names.set(base.toLowerCase(), count);
    folder.file(`${base}${count > 1 ? ` ${count}` : ""}.md`, personalRecordToObsidianMarkdown(record));
  });
  folder.file("README.md", "# Mi Personal export\n\nMarkdown records exported from Mi for review in an Obsidian vault.\n");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
