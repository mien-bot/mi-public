import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ContentConflictError,
  hashContent,
  readCurrentHash,
  writeFileAtomically,
} from "@/lib/content/atomicContentWrite";
import { REPO_ROOT } from "@/lib/content/paths";
import {
  personalDatabaseSchema,
  personalRecordSchema,
  personalRecordDraftSchema,
  personalRecordPatchSchema,
  type PersonalDatabase,
  type PersonalConversation,
  type PersonalMessage,
  type PersonalRecord,
  type PersonalRecordDraft,
  type PersonalRecordPatch,
} from "./schema";

export interface PersonalStoreOptions {
  root?: string;
}

export interface LoadedPersonalDatabase {
  database: PersonalDatabase;
  hash: string | null;
  filePath: string;
}

function now(): string {
  return new Date().toISOString();
}

export function personalDataRoot(options: PersonalStoreOptions = {}): string {
  if (options.root) return path.resolve(options.root);
  if (process.env.MI_PERSONAL_DATA_ROOT) return path.resolve(process.env.MI_PERSONAL_DATA_ROOT);
  return path.join(REPO_ROOT, ".mi", "personal");
}

export function personalDatabasePath(options: PersonalStoreOptions = {}): string {
  return path.join(personalDataRoot(options), "records.json");
}

function emptyDatabase(): PersonalDatabase {
  return {
    schemaVersion: 1,
    records: [],
    conversation: [],
    conversations: [],
    updatedAt: now(),
  };
}

function serialize(database: PersonalDatabase): string {
  return `${JSON.stringify(personalDatabaseSchema.parse(database), null, 2)}\n`;
}

export function loadPersonalDatabase(options: PersonalStoreOptions = {}): LoadedPersonalDatabase {
  const filePath = personalDatabasePath(options);
  if (!fs.existsSync(filePath)) {
    return { database: emptyDatabase(), hash: null, filePath };
  }
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = personalDatabaseSchema.parse(JSON.parse(content));
  const database = parsed.conversations.length === 0 && parsed.conversation.length > 0
    ? {
        ...parsed,
        conversations: [{
          id: "legacy-personal-conversation",
          title: conversationTitle(parsed.conversation),
          messages: parsed.conversation,
          sessionId: null,
          engine: "codex" as const,
          model: "",
          createdAt: parsed.conversation[0]?.createdAt ?? parsed.updatedAt,
          updatedAt: parsed.conversation.at(-1)?.createdAt ?? parsed.updatedAt,
        }],
      }
    : parsed;
  return {
    database,
    hash: hashContent(content),
    filePath,
  };
}

function conversationTitle(messages: PersonalMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.text.trim();
  return firstUserMessage
    ? firstUserMessage.replace(/\s+/g, " ").slice(0, 60)
    : "New chat";
}

function savePersonalDatabase(
  database: PersonalDatabase,
  expectedHash: string | null,
  options: PersonalStoreOptions,
): LoadedPersonalDatabase {
  const filePath = personalDatabasePath(options);
  const next = personalDatabaseSchema.parse({ ...database, updatedAt: now() });
  const content = serialize(next);
  const backupDirectory = path.join(personalDataRoot(options), "backups");
  writeFileAtomically(filePath, content, {
    expectedHash,
    backupDirectory,
  });
  if (fs.existsSync(backupDirectory)) {
    const backups = fs.readdirSync(backupDirectory)
      .map((name) => ({ name, modified: fs.statSync(path.join(backupDirectory, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    for (const backup of backups.slice(25)) {
      fs.rmSync(path.join(backupDirectory, backup.name));
    }
  }
  return { database: next, hash: hashContent(content), filePath };
}

function assertExpectedHash(actual: string | null, expected: string | null, filePath: string): void {
  if (actual !== expected) throw new ContentConflictError(filePath, expected, actual);
}

export function createPersonalRecord(
  draft: PersonalRecordDraft,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const parsed = personalRecordDraftSchema.parse(draft);
  const timestamp = now();
  const record = {
    ...parsed,
    id: crypto.randomUUID(),
    share: { status: "local" as const },
    personalCalendarShare: { status: "local" as const },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const saved = savePersonalDatabase(
    { ...loaded.database, records: [record, ...loaded.database.records] },
    loaded.hash,
    options,
  );
  return { ...saved, record };
}

export function importPersonalRecords(
  drafts: PersonalRecordDraft[],
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { records: PersonalRecord[] } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const parsed = personalRecordDraftSchema.array().min(1).max(100).parse(drafts);
  const timestamp = now();
  const records = parsed.map((draft) => personalRecordSchema.parse({
    ...draft,
    id: crypto.randomUUID(),
    share: { status: "local" },
    personalCalendarShare: { status: "local" },
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const saved = savePersonalDatabase(
    { ...loaded.database, records: [...records, ...loaded.database.records] },
    loaded.hash,
    options,
  );
  return { ...saved, records };
}

export function updatePersonalRecord(
  id: string,
  patch: PersonalRecordPatch,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const index = loaded.database.records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Personal record not found.");
  const current = loaded.database.records[index];
  const parsedPatch = personalRecordPatchSchema.parse(patch);
  if (
    (current.share.status === "shared" || current.personalCalendarShare?.status === "shared")
    && parsedPatch.schedule !== undefined
    && JSON.stringify(parsedPatch.schedule) !== JSON.stringify(current.schedule)
  ) {
    throw new Error("A shared schedule item cannot be silently changed. Create a new plan instead.");
  }
  const record = personalRecordSchema.parse({
    ...current,
    ...parsedPatch,
    id: current.id,
    share: current.share,
    personalCalendarShare: current.personalCalendarShare,
    createdAt: current.createdAt,
    updatedAt: now(),
  });
  const records = [...loaded.database.records];
  records[index] = record;
  const saved = savePersonalDatabase({ ...loaded.database, records }, loaded.hash, options);
  return { ...saved, record };
}

export function deletePersonalRecord(
  id: string,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { deletedId: string } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const record = loaded.database.records.find((entry) => entry.id === id);
  if (!record) throw new Error("Personal record not found.");
  if (record.share.status === "pending" || record.share.status === "needs-review") {
    throw new Error("Resolve the pending STUDIO share review before deleting this record.");
  }
  if (record.personalCalendarShare?.status === "pending" || record.personalCalendarShare?.status === "needs-review") {
    throw new Error("Resolve the pending personal calendar share review before deleting this record.");
  }
  const saved = savePersonalDatabase(
    {
      ...loaded.database,
      records: loaded.database.records.filter((entry) => entry.id !== id),
    },
    loaded.hash,
    options,
  );
  return { ...saved, deletedId: id };
}

export function appendPersonalConversation(
  messages: Array<Pick<PersonalMessage, "role" | "text">>,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
  conversation: {
    id?: string;
    sessionId?: string | null;
    engine?: PersonalConversation["engine"];
    model?: string;
  } = {},
): LoadedPersonalDatabase {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const timestamp = now();
  const additions = messages.map((message) => ({
    ...message,
    id: crypto.randomUUID(),
    createdAt: timestamp,
  }));
  const conversationId = conversation.id || "personal-default";
  const index = loaded.database.conversations.findIndex((entry) => entry.id === conversationId);
  const current = index >= 0 ? loaded.database.conversations[index] : null;
  const nextMessages = [...(current?.messages ?? []), ...additions].slice(-200);
  const nextConversation = {
    id: conversationId,
    title: current?.title === "New chat" || !current
      ? conversationTitle(nextMessages)
      : current.title,
    messages: nextMessages,
    sessionId: conversation.sessionId ?? current?.sessionId ?? null,
    engine: conversation.engine ?? current?.engine ?? "codex",
    model: conversation.model ?? current?.model ?? "",
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
  } satisfies PersonalConversation;
  const conversations = [
    nextConversation,
    ...loaded.database.conversations.filter((entry) => entry.id !== conversationId),
  ].slice(0, 50);
  return savePersonalDatabase({
    ...loaded.database,
    conversation: [],
    conversations,
  }, loaded.hash, options);
}

export interface PreparedPersonalShare {
  record: PersonalRecord;
  syncKey: string;
  hash: string;
}

type PersonalShareField = "share" | "personalCalendarShare";

function prepareShare(
  id: string,
  expectedHash: string | null,
  field: PersonalShareField,
  options: PersonalStoreOptions = {},
): PreparedPersonalShare {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const index = loaded.database.records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Personal record not found.");
  const current = loaded.database.records[index];
  if (!current.schedule) throw new Error("Add and review schedule details before sharing.");
  const shareState = current[field] ?? { status: "local" as const };
  if (shareState.status === "shared") throw new Error("This plan is already shared to that calendar.");
  if (shareState.status === "pending" || shareState.status === "needs-review") {
    throw new Error("This share attempt needs review before another Notion write.");
  }
  const syncKey = crypto.randomUUID();
  const record = personalRecordSchema.parse({
    ...current,
    [field]: { status: "pending", syncKey, startedAt: now() },
    updatedAt: now(),
  });
  const records = [...loaded.database.records];
  records[index] = record;
  const saved = savePersonalDatabase({ ...loaded.database, records }, loaded.hash, options);
  if (!saved.hash) throw new Error("Personal database write did not produce a hash.");
  return { record, syncKey, hash: saved.hash };
}

export function preparePersonalShare(
  id: string,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): PreparedPersonalShare {
  return prepareShare(id, expectedHash, "share", options);
}

export function preparePersonalCalendarShare(
  id: string,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): PreparedPersonalShare {
  return prepareShare(id, expectedHash, "personalCalendarShare", options);
}

function finishShare(
  id: string,
  syncKey: string,
  expectedHash: string,
  result:
    | { status: "shared"; notionPageId: string; notionUrl: string }
    | { status: "needs-review"; message: string },
  field: PersonalShareField,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const index = loaded.database.records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Personal record not found.");
  const current = loaded.database.records[index];
  const shareState = current[field] ?? { status: "local" as const };
  if (shareState.status !== "pending" || shareState.syncKey !== syncKey) {
    throw new Error("Personal share state changed unexpectedly.");
  }
  const record = personalRecordSchema.parse({
    ...current,
    [field]: result.status === "shared"
      ? {
          status: "shared",
          syncKey,
          notionPageId: result.notionPageId,
          notionUrl: result.notionUrl,
          sharedAt: now(),
        }
      : {
          status: "needs-review",
          syncKey,
          attemptedAt: now(),
          message: result.message.slice(0, 500),
        },
    updatedAt: now(),
  });
  const records = [...loaded.database.records];
  records[index] = record;
  const saved = savePersonalDatabase({ ...loaded.database, records }, loaded.hash, options);
  return { ...saved, record };
}

export function finishPersonalShare(
  id: string,
  syncKey: string,
  expectedHash: string,
  result:
    | { status: "shared"; notionPageId: string; notionUrl: string }
    | { status: "needs-review"; message: string },
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  return finishShare(id, syncKey, expectedHash, result, "share", options);
}

export function finishPersonalCalendarShare(
  id: string,
  syncKey: string,
  expectedHash: string,
  result:
    | { status: "shared"; notionPageId: string; notionUrl: string }
    | { status: "needs-review"; message: string },
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  return finishShare(id, syncKey, expectedHash, result, "personalCalendarShare", options);
}

function clearShareReview(
  id: string,
  expectedHash: string | null,
  field: PersonalShareField,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  const loaded = loadPersonalDatabase(options);
  assertExpectedHash(loaded.hash, expectedHash, loaded.filePath);
  const index = loaded.database.records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Personal record not found.");
  const current = loaded.database.records[index];
  const shareState = current[field] ?? { status: "local" as const };
  if (shareState.status !== "needs-review" && shareState.status !== "pending") {
    throw new Error("This personal plan does not have a share attempt awaiting review.");
  }
  const record = personalRecordSchema.parse({
    ...current,
    [field]: { status: "local" },
    updatedAt: now(),
  });
  const records = [...loaded.database.records];
  records[index] = record;
  const saved = savePersonalDatabase({ ...loaded.database, records }, loaded.hash, options);
  return { ...saved, record };
}

/**
 * The user has manually checked STUDIO after an ambiguous request and confirmed
 * that no item exists. This explicit reconciliation is the only way to allow a
 * retry; Mi never guesses from title/date matching.
 */
export function clearPersonalShareReview(
  id: string,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  return clearShareReview(id, expectedHash, "share", options);
}

export function clearPersonalCalendarShareReview(
  id: string,
  expectedHash: string | null,
  options: PersonalStoreOptions = {},
): LoadedPersonalDatabase & { record: PersonalRecord } {
  return clearShareReview(id, expectedHash, "personalCalendarShare", options);
}

export function currentPersonalDatabaseHash(options: PersonalStoreOptions = {}): string | null {
  return readCurrentHash(personalDatabasePath(options));
}
