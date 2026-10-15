import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ContentConflictError,
  hashContent,
  writeFileAtomically,
} from "@/lib/content/atomicContentWrite";
import { REPO_ROOT } from "@/lib/content/paths";

export const chatArchiveScopeSchema = z.enum(["main", "leads", "permit-qaqc"]);
export type ChatArchiveScope = z.infer<typeof chatArchiveScopeSchema>;

const archivedMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant", "error"]),
  text: z.string().max(100_000),
  createdAt: z.number().finite(),
});

export const archivedConversationSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  engine: z.enum(["codex", "claude"]),
  model: z.string().max(200),
  projectSlug: z.string().max(300).optional(),
  entitySlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  sessionId: z.string().max(500).nullable(),
  messages: archivedMessageSchema.array().max(100),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});
export type ArchivedConversation = z.infer<typeof archivedConversationSchema>;

const chatArchiveSchema = z.object({
  schemaVersion: z.literal(1),
  scopes: z.object({
    main: archivedConversationSchema.array().default([]),
    leads: archivedConversationSchema.array().default([]),
    "permit-qaqc": archivedConversationSchema.array().default([]),
  }).default({ main: [], leads: [], "permit-qaqc": [] }),
  updatedAt: z.string(),
});
export type ChatArchive = z.infer<typeof chatArchiveSchema>;

export interface ChatArchiveOptions {
  root?: string;
}

const MAX_CONVERSATIONS_PER_SCOPE = 100;
const MAX_BACKUPS = 40;

function archiveRoot(options: ChatArchiveOptions = {}): string {
  if (options.root) return path.resolve(options.root);
  if (process.env.MI_CHAT_DATA_ROOT) return path.resolve(process.env.MI_CHAT_DATA_ROOT);
  return path.join(REPO_ROOT, ".mi", "chat");
}

export function chatArchivePath(options: ChatArchiveOptions = {}): string {
  return path.join(archiveRoot(options), "history.json");
}

function emptyArchive(): ChatArchive {
  return {
    schemaVersion: 1,
    scopes: { main: [], leads: [], "permit-qaqc": [] },
    updatedAt: new Date().toISOString(),
  };
}

export function loadChatArchive(options: ChatArchiveOptions = {}): {
  archive: ChatArchive;
  hash: string | null;
} {
  const filePath = chatArchivePath(options);
  if (!fs.existsSync(filePath)) return { archive: emptyArchive(), hash: null };
  const content = fs.readFileSync(filePath, "utf8");
  return {
    archive: chatArchiveSchema.parse(JSON.parse(content)),
    hash: hashContent(content),
  };
}

export function mergeArchivedConversations(
  current: ArchivedConversation[],
  incoming: ArchivedConversation[],
): ArchivedConversation[] {
  const byId = new Map<string, ArchivedConversation>();
  for (const conversation of [...current, ...incoming]) {
    const parsed = archivedConversationSchema.parse(conversation);
    const existing = byId.get(parsed.id);
    if (!existing || parsed.updatedAt >= existing.updatedAt) byId.set(parsed.id, parsed);
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS_PER_SCOPE);
}

function pruneBackups(root: string): void {
  const backupDirectory = path.join(root, "backups");
  if (!fs.existsSync(backupDirectory)) return;
  const backups = fs.readdirSync(backupDirectory)
    .map((name) => ({ name, modified: fs.statSync(path.join(backupDirectory, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
  for (const backup of backups.slice(MAX_BACKUPS)) {
    fs.rmSync(path.join(backupDirectory, backup.name));
  }
}

export function saveChatConversations(
  scope: ChatArchiveScope,
  incoming: ArchivedConversation[],
  options: ChatArchiveOptions = {},
): ArchivedConversation[] {
  const parsedScope = chatArchiveScopeSchema.parse(scope);
  const parsedIncoming = archivedConversationSchema.array().max(MAX_CONVERSATIONS_PER_SCOPE).parse(incoming);
  const root = archiveRoot(options);
  const filePath = chatArchivePath(options);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loaded = loadChatArchive(options);
    const conversations = mergeArchivedConversations(
      loaded.archive.scopes[parsedScope] ?? [],
      parsedIncoming,
    );
    const next = chatArchiveSchema.parse({
      ...loaded.archive,
      scopes: { ...loaded.archive.scopes, [parsedScope]: conversations },
      updatedAt: new Date().toISOString(),
    });
    const content = `${JSON.stringify(next, null, 2)}\n`;
    try {
      writeFileAtomically(filePath, content, {
        expectedHash: loaded.hash,
        backupDirectory: path.join(root, "backups"),
      });
      pruneBackups(root);
      return conversations;
    } catch (error) {
      if (!(error instanceof ContentConflictError) || attempt === 2) throw error;
    }
  }
  return [];
}
