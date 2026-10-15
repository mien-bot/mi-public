import { NextResponse } from "next/server";
import { readProjectDiscovery } from "@/lib/content/projectDiscovery";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    return NextResponse.json(await readProjectDiscovery(slug, new URL(request.url).searchParams.get("refresh") === "1"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project files are unavailable.";
    return NextResponse.json({ error: /^(ENOENT|EACCES|EPERM)/.test(message) ? "Project files are unavailable on this computer. Check the confirmed folder and refresh." : message }, { status: 503 });
  }
}
