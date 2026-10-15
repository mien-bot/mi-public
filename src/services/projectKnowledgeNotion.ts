import { createHash } from "node:crypto";
import { notionFetch, notionFetchOnce } from "@/src/adapters/notion/client";
import { normalizeNotionId } from "@/src/adapters/notion/ids";

export interface KnowledgePublishEntry { title: string; body: string }
export interface KnowledgePublishPlan {
  pageId: string;
  pageUrl: string;
  sectionId: string | null;
  sourceHash: string;
  remoteHash: string;
  entries: KnowledgePublishEntry[];
  alreadyPublished: number;
  remaining: number;
}
interface Block {
  id: string; type: string; has_children?: boolean;
  [key: string]: unknown;
}
const SECTION = "Knowledge · Mi";
const MAX_BLOCKS = 2000;
const BATCH = 20;
const activePages = new Set<string>();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function text(block: Block): string {
  const value = block[block.type] as { rich_text?: Array<{ plain_text?: string; text?: { content?: string } }> } | undefined;
  return (value?.rich_text ?? []).map(item => item.plain_text ?? item.text?.content ?? "").join("");
}
async function children(id: string): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const result: { results: Block[]; has_more: boolean; next_cursor: string | null } =
      await notionFetch(`/blocks/${normalizeNotionId(id, "Notion block ID")}/children?${query}`);
    blocks.push(...result.results);
    if (blocks.length > MAX_BLOCKS) throw new Error("The Notion knowledge section is too large to verify safely.");
    cursor = result.has_more ? result.next_cursor : null;
    if (result.has_more && (!cursor || seen.has(cursor))) throw new Error("Notion returned incomplete pagination. Preview again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return blocks;
}
function richText(content: string) { return [{ type: "text", text: { content } }]; }
function entryBlock(entry: KnowledgePublishEntry) {
  return { object: "block", type: "toggle", toggle: {
    rich_text: richText(entry.title),
    children: (entry.body.match(/[\s\S]{1,1800}/gu) ?? [""]).map(part => ({
      object: "block", type: "paragraph", paragraph: { rich_text: richText(part) },
    })),
  } };
}

/** Read-only, exact linked page. Plain headings with the same name are never commandeered. */
export async function previewKnowledgePublish(pageId: string, source: KnowledgePublishEntry[]): Promise<KnowledgePublishPlan> {
  const id = normalizeNotionId(pageId, "Linked Notion project page ID");
  const page = await notionFetch<{ id: string; archived?: boolean; in_trash?: boolean }>(`/pages/${id}`);
  if (normalizeNotionId(page.id, "Notion page ID") !== id || page.archived || page.in_trash) throw new Error("The linked Notion project page is unavailable.");
  const top = await children(id);
  const sections = top.filter(block => block.type === "heading_2" && text(block) === SECTION
    && (block.heading_2 as { is_toggleable?: boolean }).is_toggleable === true);
  if (sections.length > 1) throw new Error("More than one Mi Knowledge section exists. Resolve that in Notion before publishing.");
  const sectionId = sections[0]?.id ?? null;
  const existing = sectionId ? await children(sectionId) : [];
  const unique = [...new Map(source.filter(entry => entry.title.trim() && entry.body.trim()).map(entry => [digest(entry), entry])).values()];
  const published = new Set<string>();
  const remote: unknown[] = existing.map(block => [block.id, block.type, text(block)]);
  // Only read bodies with a matching title. Unrelated page content stays outside this operation.
  const titles = new Set(unique.map(entry => entry.title));
  for (const block of existing) {
    if (block.type !== "toggle" || !titles.has(text(block))) continue;
    const nested = block.has_children ? await children(block.id) : [];
    remote.push(nested);
    if (nested.every(item => item.type === "paragraph" && !item.has_children)) {
      published.add(digest({ title: text(block), body: nested.map(text).join("") }));
    }
  }
  const pending = unique.filter(entry => !published.has(digest(entry)));
  const entries: KnowledgePublishEntry[] = [];
  let bytes = 0;
  for (const entry of pending.slice(0, BATCH)) {
    if (entry.title.length > 1900 || entry.body.length > 50_000) throw new Error(`“${entry.title.slice(0, 80)}” is too large. Split it into smaller knowledge notes before publishing.`);
    const size = Buffer.byteLength(JSON.stringify(entryBlock(entry)));
    if (bytes + size > 350_000) break;
    entries.push(entry); bytes += size;
  }
  return { pageId: id, pageUrl: `https://www.notion.so/${id.replaceAll("-", "")}`, sectionId,
    sourceHash: digest(source), remoteHash: digest(remote), entries,
    alreadyPublished: unique.length - pending.length, remaining: pending.length - entries.length };
}

/** Rebuilds and compares the exact preview, then only appends. Never rewrites project properties. */
export async function publishProjectKnowledge(pageId: string, source: KnowledgePublishEntry[], expected: KnowledgePublishPlan) {
  const id = normalizeNotionId(pageId, "Linked Notion project page ID");
  if (activePages.has(id)) throw new Error("This project is already publishing. Wait, then preview again.");
  activePages.add(id);
  try {
    const plan = await previewKnowledgePublish(id, source);
    if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error("Project knowledge or its Notion destination changed. Preview again before publishing.");
    if (!plan.entries.length) return { published: 0, pageUrl: plan.pageUrl, remaining: plan.remaining };
    let sectionId = plan.sectionId;
    if (!sectionId) {
      const created = await notionFetchOnce<{ results: Block[] }>(`/blocks/${id}/children`, {
        method: "PATCH", body: JSON.stringify({ children: [{ object: "block", type: "heading_2",
          heading_2: { rich_text: richText(SECTION), is_toggleable: true } }] }),
      });
      sectionId = created.results[0]?.id;
      if (!sectionId) throw new Error("Notion may have created the Knowledge section. Preview again to check it.");
    }
    try {
      await notionFetchOnce(`/blocks/${normalizeNotionId(sectionId, "Knowledge section ID")}/children`, {
        method: "PATCH", body: JSON.stringify({ children: plan.entries.map(entryBlock) }),
      });
    } catch {
      throw new Error("Notion did not confirm the result. Some knowledge may already be published. Preview again; Mi checks existing entries before adding more.");
    }
    return { published: plan.entries.length, pageUrl: plan.pageUrl, remaining: plan.remaining };
  } finally { activePages.delete(id); }
}
