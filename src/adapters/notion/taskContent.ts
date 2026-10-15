import { notionFetch } from "./client";
import { normalizeNotionId } from "./ids";

const TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "callout",
  "toggle",
  "to_do",
]);
const MAX_BLOCKS = 500;
const MAX_DEPTH = 8;
const RICH_TEXT_CHUNK = 1_900;

export interface NotionTaskPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, unknown>;
}

export interface NotionTaskBlock {
  id: string;
  type: string;
  has_children?: boolean;
  archived?: boolean;
  in_trash?: boolean;
  [key: string]: unknown;
}

export interface NotionTaskDocument {
  page: NotionTaskPage;
  topLevelBlocks: NotionTaskBlock[];
  allBlocks: NotionTaskBlock[];
  projectPageIds: string[];
}

interface BlockListResponse {
  results: NotionTaskBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

function compactId(value: string): string {
  return normalizeNotionId(value, "Notion page ID");
}

function relationProperty(page: NotionTaskPage): Record<string, unknown> | null {
  const value = page.properties.Projects;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function relationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const id = (item as Record<string, unknown>).id;
    return typeof id === "string" ? [compactId(id)] : [];
  });
}

async function completeProjectRelation(page: NotionTaskPage): Promise<string[]> {
  const property = relationProperty(page);
  if (!property) return [];
  const initial = relationIds(property.relation);
  if (property.has_more !== true) return initial;
  const propertyId = typeof property.id === "string" ? property.id : "";
  if (!propertyId) throw new Error("Notion returned a truncated Projects relation without a property ID.");
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const response = await notionFetch<{
      results?: Array<{ relation?: { id?: string } }>;
      has_more?: boolean;
      next_cursor?: string | null;
      relation?: { id?: string };
    }>(`/pages/${compactId(page.id)}/properties/${encodeURIComponent(propertyId)}?${query}`);
    if (Array.isArray(response.results)) {
      for (const item of response.results) {
        if (typeof item.relation?.id === "string") ids.push(compactId(item.relation.id));
      }
    } else if (typeof response.relation?.id === "string") {
      ids.push(compactId(response.relation.id));
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return [...new Set(ids)];
}

async function children(parentId: string): Promise<NotionTaskBlock[]> {
  const blocks: NotionTaskBlock[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const response = await notionFetch<BlockListResponse>(
      `/blocks/${compactId(parentId)}/children?${query}`,
    );
    blocks.push(...response.results);
    if (blocks.length > MAX_BLOCKS) throw new Error(`Notion task body exceeds Mi's ${MAX_BLOCKS}-block safety limit.`);
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return blocks;
}

async function flattenDescendants(blocks: NotionTaskBlock[], depth = 0): Promise<NotionTaskBlock[]> {
  if (depth > MAX_DEPTH) throw new Error(`Notion task body exceeds Mi's ${MAX_DEPTH}-level nesting limit.`);
  const result: NotionTaskBlock[] = [];
  for (const block of blocks) {
    result.push(block);
    if (block.has_children) {
      const nested = await children(block.id);
      result.push(...await flattenDescendants(nested, depth + 1));
    }
    if (result.length > MAX_BLOCKS) throw new Error(`Notion task body exceeds Mi's ${MAX_BLOCKS}-block safety limit.`);
  }
  return result;
}

export async function getNotionTaskDocument(taskPageId: string): Promise<NotionTaskDocument> {
  const pageId = compactId(taskPageId);
  const page = await notionFetch<NotionTaskPage>(`/pages/${pageId}`);
  const topLevelBlocks = await children(pageId);
  return {
    page,
    topLevelBlocks,
    allBlocks: await flattenDescendants(topLevelBlocks),
    projectPageIds: await completeProjectRelation(page),
  };
}

function richTextArray(block: NotionTaskBlock): Array<Record<string, unknown>> {
  const payload = block[block.type];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const richText = (payload as Record<string, unknown>).rich_text;
  return Array.isArray(richText) ? richText as Array<Record<string, unknown>> : [];
}

export function blockPlainText(block: NotionTaskBlock): string | null {
  if (!TEXT_BLOCK_TYPES.has(block.type)) return null;
  return richTextArray(block).map((item) => {
    const plain = item.plain_text;
    if (typeof plain === "string") return plain;
    const text = item.text;
    return text && typeof text === "object" && !Array.isArray(text)
      && typeof (text as Record<string, unknown>).content === "string"
      ? String((text as Record<string, unknown>).content)
      : "";
  }).join("");
}

export function blockSupportsExactTextReplacement(block: NotionTaskBlock): boolean {
  const richText = richTextArray(block);
  return richText.length <= 1 && richText.every((item) => item.type === "text" && item.text && typeof item.text === "object");
}

export function documentPlainText(document: NotionTaskDocument): string {
  return document.allBlocks
    .map(blockPlainText)
    .filter((value): value is string => value !== null)
    .join("\n");
}

function plainRichText(content: string): Array<Record<string, unknown>> {
  const chunks = content.match(new RegExp(`[\\s\\S]{1,${RICH_TEXT_CHUNK}}`, "g")) ?? [];
  return chunks.map((chunk) => ({ type: "text", text: { content: chunk } }));
}

export async function replaceNotionTextBlock(block: NotionTaskBlock, content: string): Promise<void> {
  if (!TEXT_BLOCK_TYPES.has(block.type)) throw new Error(`Notion block type "${block.type}" is not text-editable.`);
  const current = block[block.type];
  const source = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  const existingRichText = richTextArray(block);
  if (!blockSupportsExactTextReplacement(block)) {
    throw new Error("The exact block contains multiple formatted spans and cannot be safely replaced by this content-only helper.");
  }
  const richText = existingRichText.length === 1
    ? [{
      ...existingRichText[0],
      plain_text: undefined,
      text: { ...(existingRichText[0].text as Record<string, unknown>), content },
    }]
    : plainRichText(content);
  const next: Record<string, unknown> = { rich_text: richText };
  if (typeof source.color === "string") next.color = source.color;
  if (block.type === "to_do" && typeof source.checked === "boolean") next.checked = source.checked;
  await notionFetch(`/blocks/${compactId(block.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ [block.type]: next }),
  });
}

function blockForLine(line: string): Record<string, unknown> {
  const heading = /^(#{1,3})\s+(.+)$/.exec(line);
  if (heading) {
    const type = `heading_${heading[1].length}`;
    return { object: "block", type, [type]: { rich_text: plainRichText(heading[2]) } };
  }
  const bullet = /^[-*]\s+(.+)$/.exec(line);
  if (bullet) {
    return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: plainRichText(bullet[1]) } };
  }
  const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
  if (numbered) {
    return { object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: plainRichText(numbered[1]) } };
  }
  return { object: "block", type: "paragraph", paragraph: { rich_text: plainRichText(line) } };
}

export function contentToNotionBlocks(content: string, sectionTitle?: string | null): Record<string, unknown>[] {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks = [
    ...(sectionTitle ? [{ object: "block", type: "heading_2", heading_2: { rich_text: plainRichText(sectionTitle) } }] : []),
    ...lines.map(blockForLine),
  ];
  if (blocks.length > 100) throw new Error("A single task update may append at most 100 Notion blocks.");
  return blocks;
}

export async function appendNotionTaskContent(
  taskPageId: string,
  content: string,
  sectionTitle?: string | null,
): Promise<void> {
  await notionFetch(`/blocks/${compactId(taskPageId)}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children: contentToNotionBlocks(content, sectionTitle) }),
  });
}

export async function archiveNotionBlock(blockId: string): Promise<void> {
  await notionFetch(`/blocks/${compactId(blockId)}`, {
    method: "DELETE",
  });
}
