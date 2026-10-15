import fs from "node:fs";
import path from "node:path";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import {
  ContentConflictError,
  readCurrentHash,
  writeFileAtomically,
} from "@/lib/content/atomicContentWrite";
import { isPathInside, normalizeSafeRelativePath } from "@/lib/content/leadLibraryPathSafety";
import { getLeadWithHash, leadDir } from "@/lib/content/leads";
import { updateLead } from "@/lib/content/leadMutations";
import { DROPBOX_ROOT } from "@/lib/content/paths";
import type { Lead } from "@/lib/schema";
import { getNotionLead, type NotionLeadEntry } from "@/src/adapters/notion/leads";
import { isWriteAllowed } from "@/src/policies/approvals";

const INVENTORY_VERSION = 1;
const INVENTORY_MAX_DEPTH = 5;
const INVENTORY_MAX_ITEMS = 2_000;

export interface LeadSyncChange {
  field: string;
  from: unknown;
  to: unknown;
  allowed: boolean;
}

export interface LeadDropboxInventoryItem {
  path: string;
  kind: "file" | "folder";
  size_bytes: number | null;
  modified_at: string;
}

interface StoredDropboxInventory {
  version: 1;
  generated_at: string;
  source_path: string;
  truncated: boolean;
  items: LeadDropboxInventoryItem[];
}

export interface LeadSyncPlan {
  slug: string;
  applied: boolean;
  notion: {
    linked: boolean;
    changes: LeadSyncChange[];
    error: string | null;
  };
  dropbox: {
    linked: boolean;
    reachable: boolean;
    itemCount: number;
    truncated: boolean;
    inventoryChanged: boolean;
    added: string[];
    removed: string[];
    changed: string[];
    error: string | null;
  };
}

function comparable(value: unknown): unknown {
  return value === undefined || value === "" ? null : value;
}

function addChange(
  changes: LeadSyncChange[],
  field: string,
  from: unknown,
  to: unknown,
  allowed = isWriteAllowed("lead", field),
): void {
  if (JSON.stringify(comparable(from)) === JSON.stringify(comparable(to))) return;
  changes.push({ field, from, to, allowed });
}

export function planLeadNotionChanges(lead: Lead, notion: NotionLeadEntry): {
  changes: LeadSyncChange[];
  nextLead: Lead;
} {
  const changes: LeadSyncChange[] = [];
  let nextLead = { ...lead };

  function writable<K extends keyof Lead>(field: K, from: Lead[K], to: Lead[K]): void {
    const previousLength = changes.length;
    addChange(changes, String(field), from, to);
    if (changes.length > previousLength && changes.at(-1)?.allowed) {
      nextLead = { ...nextLead, [field]: to };
    }
  }

  if (notion.name !== "(untitled)") writable("name", lead.name, notion.name);
  if (notion.source) writable("source", lead.source, notion.source);
  if (notion.status) writable("status", lead.status, notion.status);
  if (notion.dateReceived) {
    writable("date_received", lead.date_received, notion.dateReceived.slice(0, 10));
  }
  writable("contact_name", lead.contact_name ?? "", notion.contactName);
  writable("contact_email", lead.contact_email ?? "", notion.contactEmail ?? "");
  writable("contact_phone", lead.contact_phone ?? "", notion.contactPhone ?? "");
  writable("referrer_name", lead.referrer_name, notion.referrerName);
  writable("estimated_value", lead.estimated_value, notion.estimatedValue);
  writable("notes", lead.notes ?? "", notion.notes);
  writable("lost_reason", lead.lost_reason, notion.lostReason || null);
  if (notion.contractStage) writable("contract_stage", lead.contract_stage, notion.contractStage);
  writable("contract_notes", lead.contract_notes, notion.contractNotes);

  // These values are useful evidence, but their identities cannot be translated into
  // local links without a person explicitly confirming the mapping.
  addChange(changes, "dropbox_path", lead.dropbox_path, notion.dropboxPath || null, false);
  if (notion.convertedDate || notion.convertedProjectPageIds.length > 0) {
    addChange(
      changes,
      "converted_project",
      {
        slug: lead.converted_project_slug,
        date: lead.converted_date,
      },
      {
        notion_page_ids: notion.convertedProjectPageIds,
        date: notion.convertedDate,
      },
      false,
    );
  }
  if (notion.meetingNotes) {
    addChange(changes, "meeting_notes", "Mi meeting files remain authoritative", notion.meetingNotes, false);
  }

  return { changes, nextLead };
}

function inventoryPath(slug: string): string {
  return path.join(leadDir(slug), "dropbox-inventory.yaml");
}

function readInventory(filePath: string): StoredDropboxInventory | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const value = loadYaml(fs.readFileSync(filePath, "utf8")) as StoredDropboxInventory;
    if (
      value?.version !== INVENTORY_VERSION
      || !Array.isArray(value.items)
      || typeof value.source_path !== "string"
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function resolveLeadDropboxFolder(lead: Lead): { dir: string | null; error: string | null } {
  if (!lead.dropbox_path) return { dir: null, error: null };
  if (!DROPBOX_ROOT) return { dir: null, error: "Dropbox is not configured on this computer." };
  try {
    const relative = normalizeSafeRelativePath(lead.dropbox_path, "Confirmed lead Dropbox path");
    if (!fs.existsSync(DROPBOX_ROOT) || !fs.statSync(DROPBOX_ROOT).isDirectory()) {
      return { dir: null, error: "The configured Dropbox root is not reachable." };
    }
    const root = fs.realpathSync(DROPBOX_ROOT);
    const candidate = path.resolve(root, ...relative.split("/"));
    if (!isPathInside(root, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      return { dir: null, error: "The confirmed lead Dropbox folder is not reachable." };
    }
    const resolved = fs.realpathSync(candidate);
    if (!isPathInside(root, resolved)) {
      return { dir: null, error: "The confirmed lead Dropbox folder escapes the Dropbox root." };
    }
    return { dir: resolved, error: null };
  } catch (cause) {
    return {
      dir: null,
      error: cause instanceof Error ? cause.message : "The confirmed lead Dropbox folder is invalid.",
    };
  }
}

export function scanLeadDropboxInventory(root: string): {
  items: LeadDropboxInventoryItem[];
  truncated: boolean;
} {
  const items: LeadDropboxInventoryItem[] = [];
  let truncated = false;

  function walk(directory: string, relativeDirectory: string, depth: number): void {
    if (depth > INVENTORY_MAX_DEPTH || truncated) {
      if (depth > INVENTORY_MAX_DEPTH) truncated = true;
      return;
    }
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (items.length >= INVENTORY_MAX_ITEMS) {
        truncated = true;
        return;
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        items.push({
          path: relativePath,
          kind: "folder",
          size_bytes: null,
          modified_at: stat.mtime.toISOString(),
        });
        walk(target, relativePath, depth + 1);
      } else if (entry.isFile()) {
        items.push({
          path: relativePath,
          kind: "file",
          size_bytes: stat.size,
          modified_at: stat.mtime.toISOString(),
        });
      }
    }
  }

  walk(root, "", 0);
  return { items, truncated };
}

function inventoryDiff(
  previous: StoredDropboxInventory | null,
  nextItems: LeadDropboxInventoryItem[],
): { added: string[]; removed: string[]; changed: string[] } {
  const before = new Map((previous?.items ?? []).map((item) => [item.path, item]));
  const after = new Map(nextItems.map((item) => [item.path, item]));
  const added = [...after.keys()].filter((itemPath) => !before.has(itemPath));
  const removed = [...before.keys()].filter((itemPath) => !after.has(itemPath));
  const changed = [...after.keys()].filter((itemPath) => {
    const prior = before.get(itemPath);
    const current = after.get(itemPath);
    return prior && current && JSON.stringify(prior) !== JSON.stringify(current);
  });
  return { added, removed, changed };
}

export async function pullLeadSources(slug: string, options: { apply: boolean }): Promise<LeadSyncPlan> {
  const current = getLeadWithHash(slug);
  let nextLead = current.lead;
  let notionChanges: LeadSyncChange[] = [];
  let notionError: string | null = null;

  if (current.lead.notion_page_id) {
    try {
      const notion = await getNotionLead(current.lead.notion_page_id);
      const planned = planLeadNotionChanges(current.lead, notion);
      notionChanges = planned.changes;
      nextLead = planned.nextLead;
    } catch (cause) {
      notionError = cause instanceof Error ? cause.message : "Notion refresh failed.";
    }
  }

  const storedPath = inventoryPath(slug);
  const storedHash = readCurrentHash(storedPath);
  const priorInventory = readInventory(storedPath);
  const resolvedDropbox = resolveLeadDropboxFolder(current.lead);
  let inventory: LeadDropboxInventoryItem[] = [];
  let inventoryTruncated = false;
  let dropboxError = resolvedDropbox.error;
  if (resolvedDropbox.dir) {
    try {
      const scanned = scanLeadDropboxInventory(resolvedDropbox.dir);
      inventory = scanned.items;
      inventoryTruncated = scanned.truncated;
    } catch (cause) {
      dropboxError = cause instanceof Error ? cause.message : "Dropbox inventory refresh failed.";
    }
  }
  const diff = inventoryDiff(priorInventory, inventory);
  const sourceChanged = priorInventory?.source_path !== (current.lead.dropbox_path ?? "");
  const inventoryChanged = Boolean(
    resolvedDropbox.dir
    && (!priorInventory || sourceChanged || diff.added.length || diff.removed.length || diff.changed.length),
  );

  if (options.apply) {
    const leadPath = path.join(leadDir(slug), "lead.yaml");
    const leadHashBeforeApply = readCurrentHash(leadPath);
    if (leadHashBeforeApply !== current.hash) {
      throw new ContentConflictError(leadPath, current.hash, leadHashBeforeApply);
    }
    if (notionChanges.some((change) => change.allowed)) {
      updateLead(slug, nextLead, { expectedHash: current.hash });
    }
    if (resolvedDropbox.dir && inventoryChanged) {
      const document: StoredDropboxInventory = {
        version: INVENTORY_VERSION,
        generated_at: new Date().toISOString(),
        source_path: current.lead.dropbox_path ?? "",
        truncated: inventoryTruncated,
        items: inventory,
      };
      writeFileAtomically(storedPath, dumpYaml(document, { lineWidth: 120, noRefs: true }), {
        expectedHash: storedHash,
      });
    }
  }

  return {
    slug,
    applied: options.apply,
    notion: {
      linked: Boolean(current.lead.notion_page_id),
      changes: notionChanges,
      error: notionError,
    },
    dropbox: {
      linked: Boolean(current.lead.dropbox_path),
      reachable: Boolean(resolvedDropbox.dir),
      itemCount: inventory.length,
      truncated: inventoryTruncated,
      inventoryChanged,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      error: dropboxError,
    },
  };
}
