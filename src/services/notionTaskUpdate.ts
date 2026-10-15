import crypto from "node:crypto";
import { z } from "zod";
import { normalizeNotionId } from "@/src/adapters/notion/ids";
import {
  appendNotionTaskContent,
  archiveNotionBlock,
  blockSupportsExactTextReplacement,
  blockPlainText,
  documentPlainText,
  getNotionTaskDocument,
  replaceNotionTextBlock,
  type NotionTaskBlock,
  type NotionTaskDocument,
} from "@/src/adapters/notion/taskContent";

const MAX_CONTENT_CHARS = 100_000;
const contentString = z.string().max(MAX_CONTENT_CHARS);
const contentUpdateSchema = z.object({
  old_str: z.string().min(1).max(MAX_CONTENT_CHARS),
  new_str: contentString,
  replace_all_matches: z.boolean().default(false),
}).strict();

export const notionTaskChangeSchema = z.object({
  version: z.literal(1),
  project_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  task_page_id: z.string().min(1),
  expected_last_edited_time: z.string().min(1),
  operation: z.enum(["update_content", "append_content", "replace_content"]),
  content_updates: z.array(contentUpdateSchema).max(20).optional(),
  append_content: z.object({
    section_title: z.string().min(1).max(500),
    content: contentString,
  }).strict().optional(),
  replacement_content: contentString.optional(),
  property_patch: z.record(z.string(), z.unknown()).default({}),
  pdf: z.object({
    source_path: z.string().min(1).max(2_000),
    output_path: z.string().min(1).max(2_000),
    overwrite: z.boolean().default(false),
    attach_to_task: z.boolean().default(false),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value.property_patch).length > 0) {
    context.addIssue({
      code: "custom",
      path: ["property_patch"],
      message: "This helper is content-only. Property changes require a separate preview and confirmation flow.",
    });
  }
  if (value.operation === "update_content" && !value.content_updates?.length) {
    context.addIssue({ code: "custom", path: ["content_updates"], message: "Provide at least one exact old/new replacement." });
  }
  if (value.operation === "append_content" && !value.append_content) {
    context.addIssue({ code: "custom", path: ["append_content"], message: "Provide the titled section to append." });
  }
  if (value.operation === "replace_content" && value.replacement_content === undefined) {
    context.addIssue({ code: "custom", path: ["replacement_content"], message: "Provide the full replacement body." });
  }
});

export type NotionTaskChange = z.infer<typeof notionTaskChangeSchema>;

export class NotionTaskUpdateError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 502 = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function verifyNotionTaskPreservedAfterAttachment(
  preview: NotionTaskPreview,
  projectNotionPageId: string,
  dependencies: NotionTaskUpdateDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ unspecifiedPropertiesUnchanged: boolean; projectRelationIntact: boolean; lastEditedTime: string }> {
  const document = await dependencies.fetchDocument(preview.task.id);
  const unspecifiedPropertiesUnchanged = sha256(protectedProperties(document)) === preview.protectedPropertiesHash;
  const projectRelationIntact = document.projectPageIds.includes(
    normalizeNotionId(projectNotionPageId, "project notion_page_id"),
  );
  if (!unspecifiedPropertiesUnchanged || !projectRelationIntact || !document.page.last_edited_time) {
    throw new NotionTaskUpdateError(
      `Notion attachment verification failed: properties_unchanged=${unspecifiedPropertiesUnchanged}, `
      + `project_relation_intact=${projectRelationIntact}.`,
      502,
    );
  }
  return {
    unspecifiedPropertiesUnchanged,
    projectRelationIntact,
    lastEditedTime: document.page.last_edited_time,
  };
}

interface ReplacementPlan {
  block: NotionTaskBlock;
  before: string;
  after: string;
}

export interface NotionTaskMutationPlan {
  operation: NotionTaskChange["operation"];
  beforeContent: string;
  afterContent: string;
  beforeHash: string;
  afterHash: string;
  replacements: ReplacementPlan[];
  append?: { sectionTitle: string; content: string };
  replace?: { content: string; topLevelBlockIds: string[] };
  changedFields: ["content"];
}

export interface NotionTaskPreview {
  change: NotionTaskChange;
  task: {
    id: string;
    url: string;
    name: string;
    lastEditedTime: string;
    projectPageIds: string[];
  };
  plan: NotionTaskMutationPlan;
  protectedPropertiesHash: string;
}

export interface NotionTaskApplyResult {
  pageId: string;
  pageUrl: string;
  changedFields: string[];
  operation: NotionTaskChange["operation"];
  beforeHash: string;
  afterHash: string;
  verification: {
    requestedContentPresent: boolean;
    unspecifiedPropertiesUnchanged: boolean;
    projectRelationIntact: boolean;
    verifiedLastEditedTime: string;
  };
}

export interface NotionTaskUpdateDependencies {
  fetchDocument: typeof getNotionTaskDocument;
  replaceBlock: typeof replaceNotionTextBlock;
  appendContent: typeof appendNotionTaskContent;
  archiveBlock: typeof archiveNotionBlock;
}

const DEFAULT_DEPENDENCIES: NotionTaskUpdateDependencies = {
  fetchDocument: getNotionTaskDocument,
  replaceBlock: replaceNotionTextBlock,
  appendContent: appendNotionTaskContent,
  archiveBlock: archiveNotionBlock,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(stableValue(value)),
  ).digest("hex");
}

function protectedProperties(document: NotionTaskDocument): Record<string, unknown> {
  return Object.fromEntries(Object.entries(document.page.properties).filter(([, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
    const type = (value as Record<string, unknown>).type;
    return !["created_time", "last_edited_time", "created_by", "last_edited_by", "formula", "rollup"].includes(String(type));
  }));
}

function titleFromDocument(document: NotionTaskDocument): string {
  const property = document.page.properties.Name;
  if (!property || typeof property !== "object" || Array.isArray(property)) return "(untitled)";
  const title = (property as Record<string, unknown>).title;
  if (!Array.isArray(title)) return "(untitled)";
  const text = title.map((item) => item && typeof item === "object" && !Array.isArray(item)
    ? String((item as Record<string, unknown>).plain_text ?? "")
    : "").join("");
  return text || "(untitled)";
}

function normalizedRenderedContent(content: string, sectionTitle?: string): string {
  const lines = content.replaceAll("\r\n", "\n").split("\n").map((line) =>
    line.replace(/^(?:#{1,3}|[-*]|\d+[.)])\s+/, ""));
  return [...(sectionTitle ? [sectionTitle] : []), ...lines].join("\n");
}

function assertTaskIdentity(
  document: NotionTaskDocument,
  change: NotionTaskChange,
  projectNotionPageId: string,
): void {
  if (document.page.archived || document.page.in_trash) {
    throw new NotionTaskUpdateError("The selected Notion task is archived or in trash and cannot be updated.", 409);
  }
  const actualTaskId = normalizeNotionId(document.page.id, "task_page_id");
  const requestedTaskId = normalizeNotionId(change.task_page_id, "task_page_id");
  if (actualTaskId !== requestedTaskId) throw new NotionTaskUpdateError("Notion returned a different task page.", 409);
  const linkedProjectId = normalizeNotionId(projectNotionPageId, "project notion_page_id");
  if (!document.projectPageIds.includes(linkedProjectId)) {
    throw new NotionTaskUpdateError(
      "The Notion task is not linked to this Mi project's exact Notion page through Projects.",
      403,
    );
  }
  if (!document.page.last_edited_time) {
    throw new NotionTaskUpdateError("Notion did not return last_edited_time for this task.", 409);
  }
  if (document.page.last_edited_time !== change.expected_last_edited_time) {
    throw new NotionTaskUpdateError(
      `Conflict: the task was last edited ${document.page.last_edited_time}, not ${change.expected_last_edited_time}. Fetch it again and review a new diff.`,
      409,
    );
  }
}

export function buildNotionTaskMutationPlan(
  document: NotionTaskDocument,
  change: NotionTaskChange,
): NotionTaskMutationPlan {
  const beforeContent = documentPlainText(document);
  const replacements: ReplacementPlan[] = [];
  let afterContent = beforeContent;
  let append: NotionTaskMutationPlan["append"];
  let replace: NotionTaskMutationPlan["replace"];

  if (change.operation === "update_content") {
    const targeted = new Set<string>();
    for (const update of change.content_updates ?? []) {
      const matches = document.allBlocks.filter((block) => blockPlainText(block) === update.old_str);
      if (matches.length === 0) {
        throw new NotionTaskUpdateError(
          `Exact content was not found as a complete Notion text block: ${JSON.stringify(update.old_str)}`,
          409,
        );
      }
      if (!update.replace_all_matches && matches.length !== 1) {
        throw new NotionTaskUpdateError(
          `Exact content matched ${matches.length} blocks. Set replace_all_matches only if replacing every match is intended.`,
          409,
        );
      }
      for (const block of update.replace_all_matches ? matches : matches.slice(0, 1)) {
        if (!blockSupportsExactTextReplacement(block)) {
          throw new NotionTaskUpdateError(
            "The exact block contains multiple formatted spans. Refine the operation or explicitly approve replacing the entire body.",
            409,
          );
        }
        if (targeted.has(block.id)) throw new NotionTaskUpdateError(`Block ${block.id} is targeted more than once.`, 409);
        targeted.add(block.id);
        replacements.push({ block, before: update.old_str, after: update.new_str });
      }
    }
    const replacementById = new Map(replacements.map((item) => [item.block.id, item.after]));
    afterContent = document.allBlocks
      .map((block) => replacementById.get(block.id) ?? blockPlainText(block))
      .filter((value): value is string => value !== null)
      .join("\n");
  } else if (change.operation === "append_content") {
    append = {
      sectionTitle: change.append_content!.section_title,
      content: change.append_content!.content,
    };
    const rendered = normalizedRenderedContent(append.content, append.sectionTitle);
    afterContent = [beforeContent, rendered].filter(Boolean).join("\n");
  } else {
    replace = {
      content: change.replacement_content!,
      topLevelBlockIds: document.topLevelBlocks.map((block) => block.id),
    };
    afterContent = normalizedRenderedContent(replace.content);
  }

  return {
    operation: change.operation,
    beforeContent,
    afterContent,
    beforeHash: sha256(beforeContent),
    afterHash: sha256(afterContent),
    replacements,
    append,
    replace,
    changedFields: ["content"],
  };
}

export async function previewNotionTaskUpdate(
  input: unknown,
  projectNotionPageId: string,
  dependencies: NotionTaskUpdateDependencies = DEFAULT_DEPENDENCIES,
): Promise<NotionTaskPreview> {
  const parsed = notionTaskChangeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new NotionTaskUpdateError(`${issue.path.join(".") || "change"}: ${issue.message}`);
  }
  let document: NotionTaskDocument;
  try {
    document = await dependencies.fetchDocument(parsed.data.task_page_id);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Notion task fetch failed.";
    if (/NOTION_API_KEY not set/i.test(message)) {
      throw new NotionTaskUpdateError(
        "Notion is not connected on this computer. Open Mi Settings → Connections and save the Notion integration token, then retry.",
        401,
      );
    }
    throw new NotionTaskUpdateError(message, /404|not found|access/i.test(message) ? 404 : 502);
  }
  assertTaskIdentity(document, parsed.data, projectNotionPageId);
  const plan = buildNotionTaskMutationPlan(document, parsed.data);
  return {
    change: parsed.data,
    task: {
      id: normalizeNotionId(document.page.id, "task_page_id"),
      url: document.page.url ?? `https://www.notion.so/${normalizeNotionId(document.page.id)}`,
      name: titleFromDocument(document),
      lastEditedTime: document.page.last_edited_time!,
      projectPageIds: document.projectPageIds,
    },
    plan,
    protectedPropertiesHash: sha256(protectedProperties(document)),
  };
}

async function fetchVerifiedDocument(
  taskPageId: string,
  dependencies: NotionTaskUpdateDependencies,
): Promise<NotionTaskDocument> {
  let document = await dependencies.fetchDocument(taskPageId);
  // Notion content is normally immediately consistent, but one brief retry prevents a successful
  // write from being reported as failed solely because the first verification read lagged.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (document.page.last_edited_time) return document;
    await new Promise((resolve) => setTimeout(resolve, 100));
    document = await dependencies.fetchDocument(taskPageId);
  }
  return document;
}

export async function applyNotionTaskUpdate(
  preview: NotionTaskPreview,
  projectNotionPageId: string,
  dependencies: NotionTaskUpdateDependencies = DEFAULT_DEPENDENCIES,
): Promise<NotionTaskApplyResult> {
  const current = await previewNotionTaskUpdate(preview.change, projectNotionPageId, dependencies);
  if (current.plan.beforeHash !== preview.plan.beforeHash
    || current.protectedPropertiesHash !== preview.protectedPropertiesHash) {
    throw new NotionTaskUpdateError("Conflict: the task content or protected properties changed after preview. Review a new diff.", 409);
  }

  if (current.plan.operation === "update_content") {
    for (const replacement of current.plan.replacements) {
      await dependencies.replaceBlock(replacement.block, replacement.after);
    }
  } else if (current.plan.operation === "append_content") {
    await dependencies.appendContent(
      current.task.id,
      current.plan.append!.content,
      current.plan.append!.sectionTitle,
    );
  } else {
    for (const blockId of current.plan.replace!.topLevelBlockIds) await dependencies.archiveBlock(blockId);
    if (current.plan.replace!.content) {
      await dependencies.appendContent(current.task.id, current.plan.replace!.content);
    }
  }

  const after = await fetchVerifiedDocument(current.task.id, dependencies);
  const afterContent = documentPlainText(after);
  const afterPropertiesHash = sha256(protectedProperties(after));
  const projectId = normalizeNotionId(projectNotionPageId, "project notion_page_id");
  const projectRelationIntact = after.projectPageIds.includes(projectId);
  const unspecifiedPropertiesUnchanged = afterPropertiesHash === current.protectedPropertiesHash;
  let requestedContentPresent: boolean;
  if (current.plan.operation === "update_content") {
    const blocks = after.allBlocks.map(blockPlainText);
    requestedContentPresent = current.plan.replacements.every((replacement) => blocks.includes(replacement.after));
  } else {
    requestedContentPresent = afterContent.includes(current.plan.afterContent)
      || afterContent === current.plan.afterContent;
  }
  if (!requestedContentPresent || !unspecifiedPropertiesUnchanged || !projectRelationIntact) {
    throw new NotionTaskUpdateError(
      `Notion write verification failed: requested_content=${requestedContentPresent}, `
      + `properties_unchanged=${unspecifiedPropertiesUnchanged}, project_relation_intact=${projectRelationIntact}.`,
      502,
    );
  }
  if (!after.page.last_edited_time) {
    throw new NotionTaskUpdateError("Notion verification did not return last_edited_time.", 502);
  }

  return {
    pageId: current.task.id,
    pageUrl: after.page.url ?? current.task.url,
    changedFields: [...current.plan.changedFields],
    operation: current.plan.operation,
    beforeHash: current.plan.beforeHash,
    afterHash: sha256(afterContent),
    verification: {
      requestedContentPresent,
      unspecifiedPropertiesUnchanged,
      projectRelationIntact,
      verifiedLastEditedTime: after.page.last_edited_time,
    },
  };
}
