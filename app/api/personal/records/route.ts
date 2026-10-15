import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import {
  appendPersonalConversation,
  createPersonalRecord,
  deletePersonalRecord,
  importPersonalRecords,
  loadPersonalDatabase,
  updatePersonalRecord,
} from "@/lib/personal/store";
import {
  personalMessageSchema,
  personalRecordDraftSchema,
  personalRecordPatchSchema,
} from "@/lib/personal/schema";

function response() {
  const loaded = loadPersonalDatabase();
  return NextResponse.json({ database: loaded.database, hash: loaded.hash });
}

export async function GET() {
  return response();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  const expectedHash = typeof body.expectedHash === "string" || body.expectedHash === null
    ? body.expectedHash
    : undefined;
  if (expectedHash === undefined) {
    return NextResponse.json({ error: "The current personal database hash is required." }, { status: 400 });
  }

  try {
    if (body.operation === "create") {
      createPersonalRecord(personalRecordDraftSchema.parse(body.record), expectedHash);
      return response();
    }
    if (body.operation === "import-obsidian" || body.operation === "import-dayone") {
      importPersonalRecords(personalRecordDraftSchema.array().min(1).max(100).parse(body.records), expectedHash);
      return response();
    }
    if (body.operation === "update") {
      if (typeof body.id !== "string" || !body.id) {
        return NextResponse.json({ error: "A personal record id is required." }, { status: 400 });
      }
      updatePersonalRecord(body.id, personalRecordPatchSchema.parse(body.patch), expectedHash);
      return response();
    }
    if (body.operation === "delete") {
      if (typeof body.id !== "string" || !body.id) {
        return NextResponse.json({ error: "A personal record id is required." }, { status: 400 });
      }
      deletePersonalRecord(body.id, expectedHash);
      return response();
    }
    if (body.operation === "append-conversation") {
      const messages = personalMessageSchema
        .pick({ role: true, text: true })
        .array()
        .min(1)
        .max(2)
        .parse(body.messages);
      appendPersonalConversation(messages, expectedHash, {}, {
        id: typeof body.conversationId === "string" && body.conversationId
          ? body.conversationId
          : undefined,
        sessionId: typeof body.sessionId === "string" && body.sessionId
          ? body.sessionId
          : null,
        engine: body.engine === "claude" ? "claude" : "codex",
        model: typeof body.model === "string" ? body.model : "",
      });
      return response();
    }
    return NextResponse.json({ error: "Unknown personal-record operation." }, { status: 400 });
  } catch (error) {
    if (error instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "Personal data changed in another window. Refresh and try again." },
        { status: 409 },
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid personal record." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Personal record update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
