import JSZip from "jszip";
import { personalRecordDraftSchema, type PersonalRecordDraft } from "./schema";

export interface DayOneImportPreview {
  sourceName: string;
  draft: PersonalRecordDraft;
  warnings: string[];
}

interface DayOneEntry {
  text?: unknown;
  creationDate?: unknown;
  tags?: unknown;
}

const MAX_ENTRIES = 100;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatEntryDate(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(parsed);
}

/** Strips Day One's photo/video/audio embed placeholders (e.g. ![](dayone-moment://UUID)) --
 * Mi's personal record body is plain text with no attachment mechanism, so these would
 * otherwise import as dead links. */
function stripMediaPlaceholders(text: string): { body: string; hadMedia: boolean } {
  const withoutMedia = text.replace(/!\[]\(dayone-moment:\/\/[^)]+\)/g, "");
  const body = withoutMedia.replace(/\n{3,}/g, "\n\n").trim();
  return { body, hadMedia: withoutMedia.trim() !== text.trim() };
}

function previewDayOneEntry(entry: DayOneEntry, sourceName: string): DayOneImportPreview | null {
  const rawText = stringValue(entry.text);
  if (!rawText.trim()) return null;
  const warnings: string[] = [];
  const { body: stripped, hadMedia } = stripMediaPlaceholders(rawText);
  if (hadMedia) {
    warnings.push("Photos, videos, and audio attached in Day One were not imported -- Mi's journal entries are text-only.");
  }

  let body = stripped || "(No text -- this Day One entry was photos or media only.)";
  if (body.length > 20_000) {
    body = body.slice(0, 20_000);
    warnings.push("The entry was shortened to Mi's 20,000-character record limit.");
  }

  const dateLabel = formatEntryDate(entry.creationDate);
  if (!dateLabel) warnings.push("Day One did not include a readable date for this entry -- review the title.");
  const title = (dateLabel ?? "Imported journal entry").slice(0, 200);

  const tags = Array.isArray(entry.tags)
    ? [...new Set(entry.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20).map((tag) => tag.slice(0, 50))
    : [];

  return {
    sourceName,
    draft: personalRecordDraftSchema.parse({
      kind: "journal",
      title,
      body,
      tags,
      mood: null,
      status: "inbox",
      schedule: null,
    }),
    warnings,
  };
}

function parseJournalEntries(journalText: string): DayOneEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(journalText);
  } catch {
    throw new Error("Mi could not read that file as Day One's JSON export format.");
  }
  const entries = parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
    ? (parsed as { entries: DayOneEntry[] }).entries
    : null;
  if (!entries) throw new Error('That file does not look like a Day One JSON export (no "entries" array).');
  if (entries.length === 0) throw new Error("That Day One export has no entries.");
  return entries;
}

/**
 * Accepts Day One's "Export → JSON" .zip (containing a top-level Journal.json plus a photos/
 * folder Mi does not import) or a bare *.json export file directly. Caps at MAX_ENTRIES,
 * matching importPersonalRecords' own hard limit -- Day One's own export lets you choose a
 * narrower date range if a journal has more entries than that.
 */
export async function previewDayOneExport(file: { name: string; data: ArrayBuffer }): Promise<DayOneImportPreview[]> {
  const lowerName = file.name.toLowerCase();
  let journalText: string;
  if (lowerName.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file.data);
    const journalEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".json") && !entry.name.includes("/"),
    );
    if (!journalEntry) throw new Error("No Journal.json was found in that Day One export.");
    journalText = await journalEntry.async("text");
  } else if (lowerName.endsWith(".json")) {
    journalText = new TextDecoder().decode(file.data);
  } else {
    throw new Error("Choose a Day One JSON export (.zip or .json).");
  }

  const entries = parseJournalEntries(journalText);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(
      `That export has ${entries.length} entries -- import no more than ${MAX_ENTRIES} at a time. ` +
        "Day One's export screen lets you choose a narrower date range.",
    );
  }

  const previews = entries
    .map((entry, index) => previewDayOneEntry(entry, `Entry ${index + 1}`))
    .filter((preview): preview is DayOneImportPreview => preview !== null);
  if (previews.length === 0) throw new Error("Every entry in that export was empty.");
  return previews;
}
