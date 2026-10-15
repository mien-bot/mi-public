import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProjectSlugs, mirrorProjectKnowledge } from "@/lib/content";
import { PROJECTS_DIR } from "@/lib/content/paths";

function validUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { urls?: unknown[]; url?: unknown } | null;
  const rawUrls: unknown[] = Array.isArray(body?.urls) ? body.urls : [body?.url];
  const urls = rawUrls
    .map(validUrl)
    .filter((url): url is string => url !== null)
    .slice(0, 10);
  if (urls.length === 0) return NextResponse.json({ error: "No valid web links supplied." }, { status: 400 });

  const filePath = path.join(PROJECTS_DIR, slug, "references", "links.md");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : `---\nlast_updated: "${today}"\n---\n\n## Project links\n`;
  let added = 0;
  for (const url of urls) {
    if (content.includes(url)) continue;
    const label = new URL(url).hostname.replace(/^www\./, "");
    content = `${content.trimEnd()}\n- [${label}](${url}) — saved from Mi chat\n`;
    added++;
  }
  fs.writeFileSync(filePath, content, "utf8");
  try { mirrorProjectKnowledge(slug); } catch (error) { console.error(error); }
  return NextResponse.json({ added });
}
