import { NextResponse } from "next/server";
import { previewProjectHandoff, previewProjectPdf, saveProjectHandoff, saveProjectPdf } from "@/lib/content/projectSharing";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const origin = request.headers.get("origin");
  // Next's internal request URL may use localhost while the browser uses 127.0.0.1.
  // Compare the browser's Origin with the actual Host header, retaining the port.
  if (origin) {
    try {
      const source = new URL(origin);
      if (source.host !== request.headers.get("host") || source.protocol !== new URL(request.url).protocol) throw new Error("Origin mismatch");
    } catch { return NextResponse.json({ error: "Cross-origin writes are not allowed." }, { status: 403 }); }
  }
  try {
    const { slug } = await params;
    // Bound streamed input too, rather than trusting Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("No request body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 21 * 1024 * 1024) { await reader.cancel(); throw new Error("The upload is too large (20 MB maximum)."); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Choose a PDF.");
      const name = String(form.get("name") || file.name);
      const pdf = Buffer.from(await file.arrayBuffer());
      const value = form.get("action") === "apply"
        ? saveProjectPdf(slug, name, pdf, String(form.get("fingerprint") || ""), form.get("confirmed") === "true")
        : previewProjectPdf(slug, name, pdf);
      return NextResponse.json(value);
    }
    if (size > 100_000) throw new Error("Handoff is too large.");
    const body = JSON.parse(bytes.toString("utf8"));
    if (body.action !== "preview" && body.action !== "apply") throw new Error("Choose preview or apply.");
    return NextResponse.json(body.action === "apply"
      ? saveProjectHandoff(slug, body.draft, body.fingerprint, body.confirmed === true)
      : previewProjectHandoff(slug, body.draft));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The reviewed save failed.";
    // Filesystem and schema errors may contain machine-local paths. Keep those local.
    return NextResponse.json({ error: /^(ENOENT|EACCES|EPERM|EEXIST)|\[\s*\{/.test(message) ? "The file is unavailable, already exists, or the handoff fields are invalid. Refresh and review again." : message }, { status: 400 });
  }
}
