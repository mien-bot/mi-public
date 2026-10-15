import { NextResponse } from "next/server";
import { getProjectSlugs } from "@/lib/content";
import { readProjectOrder, writeProjectOrder } from "@/lib/personal/projectOrder";

export async function GET() {
  return NextResponse.json({ order: readProjectOrder() });
}

/**
 * Replaces this person's project ordering. No confirmation gate and no expectedHash: it is a
 * local display preference on one machine, not firm data and not an external write, so the
 * usual review-before-write contract doesn't apply.
 */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.slugs)) {
    return NextResponse.json({ error: "An array of project slugs is required." }, { status: 400 });
  }
  if (body.slugs.some((slug: unknown) => typeof slug !== "string")) {
    return NextResponse.json({ error: "Every entry must be a project slug." }, { status: 400 });
  }
  // Only real projects may be stored, so a stale tab can't write junk into the preference file.
  const known = new Set(getProjectSlugs());
  const slugs = (body.slugs as string[]).filter((slug) => known.has(slug));
  return NextResponse.json({ order: writeProjectOrder(slugs) });
}
