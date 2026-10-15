import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  archivedConversationSchema,
  chatArchiveScopeSchema,
  loadChatArchive,
  saveChatConversations,
} from "@/lib/chat/archive";

export async function GET(request: Request) {
  const scope = chatArchiveScopeSchema.safeParse(new URL(request.url).searchParams.get("scope"));
  if (!scope.success) {
    return NextResponse.json({ error: "A valid chat scope is required." }, { status: 400 });
  }
  const loaded = loadChatArchive();
  return NextResponse.json({ conversations: loaded.archive.scopes[scope.data] ?? [] });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const scope = chatArchiveScopeSchema.parse(body?.scope);
    const conversations = archivedConversationSchema.array().max(100).parse(body?.conversations);
    return NextResponse.json({ conversations: saveChatConversations(scope, conversations) });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid chat archive." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat archive update failed." },
      { status: 500 },
    );
  }
}
