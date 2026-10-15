import { NextResponse } from "next/server";
import { DROPBOX_ROOT } from "@/lib/content/paths";
import {
  applyDropboxLibraryPlan,
  previewDropboxLibraryPlan,
} from "@/lib/content/dropboxLibraryPlan";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!DROPBOX_ROOT) {
    return NextResponse.json({ error: "DROPBOX_ROOT is not configured on this machine." }, { status: 409 });
  }
  try {
    return NextResponse.json(previewDropboxLibraryPlan(DROPBOX_ROOT, body?.parentPath, body?.folders));
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Folder plan is invalid." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!DROPBOX_ROOT) {
    return NextResponse.json({ error: "DROPBOX_ROOT is not configured on this machine." }, { status: 409 });
  }
  try {
    return NextResponse.json(
      applyDropboxLibraryPlan(DROPBOX_ROOT, body?.parentPath, body?.folders, body?.confirmed),
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Folder plan could not be applied.";
    return NextResponse.json(
      { error: message },
      { status: message === "Explicit confirmation is required." ? 409 : 400 },
    );
  }
}
