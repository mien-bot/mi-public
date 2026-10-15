import { NextResponse } from "next/server";
import { readProjectPdfIndex } from "@/lib/content/projectDiscovery";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return NextResponse.json(await readProjectPdfIndex((await params).slug), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Project PDFs are unavailable. Check the confirmed project folder and local sync." }, { status: 503 });
  }
}
