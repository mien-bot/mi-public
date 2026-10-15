import { NextResponse } from "next/server";
import { listNotionWorkspacePeople } from "@/src/adapters/notion/people";

export async function GET() {
  try {
    return NextResponse.json({ people: await listNotionWorkspacePeople() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mi could not load Notion people." },
      { status: 502 },
    );
  }
}
