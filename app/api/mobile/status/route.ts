import { NextResponse } from "next/server";
import { requireRemoteReader, remoteFailure } from "@/lib/remoteAccess/access";

export async function GET(request: Request) {
  try {
    const principal = await requireRemoteReader(request);
    return NextResponse.json(
      {
        status: "ready",
        user: { email: principal.email },
        capabilities: {
          claudeApi: Boolean(process.env.ANTHROPIC_API_KEY),
          notion: Boolean(process.env.NOTION_API_KEY),
          dropbox: Boolean(process.env.DROPBOX_ROOT),
          mutations: false,
          projectViewer: true,
          projectAccess: "explicit-grants",
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return remoteFailure(error);
  }
}
