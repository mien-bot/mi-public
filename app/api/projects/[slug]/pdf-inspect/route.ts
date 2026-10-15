import { NextResponse } from "next/server";
import { getProjectSlugs } from "@/lib/content";
import { inspectProjectPdf } from "@/lib/content/projectPdf";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.relativePath !== "string" || body.relativePath.length > 1_000) {
    return NextResponse.json({ error: "Send one project-relative PDF path." }, { status: 400 });
  }
  const page = (value: unknown) => (value === undefined || value === null ? null : Number(value));
  try {
    return NextResponse.json(await inspectProjectPdf(slug, body.relativePath, {
      firstPage: page(body.firstPage),
      lastPage: page(body.lastPage),
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The PDF could not be inspected." },
      { status: 400 },
    );
  }
}
