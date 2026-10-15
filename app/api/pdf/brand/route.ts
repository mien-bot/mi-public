import { brandPdfWithMi } from "@/src/services/pdfBranding";

const MAX_BYTES = 20 * 1024 * 1024;

/** Pure byte transformation. No path access, credentials, Notion writes, or publishing. */
export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/pdf") {
    return Response.json({ error: "Send the PDF bytes with Content-Type: application/pdf." }, { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_BYTES) {
    return Response.json({ error: "PDFs must be 20 MB or smaller." }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A PDF is required." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "PDFs must be 20 MB or smaller." }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const result = await brandPdfWithMi(Buffer.concat(chunks));
    if ((!result.applied && !result.alreadyBranded) || result.pagesSkipped) {
      return Response.json({ error: result.reason }, { status: 422 });
    }
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "X-Mi-Branding": result.alreadyBranded ? "already-branded" : "applied",
        "X-Mi-Pages-Stamped": String(result.pagesStamped),
      },
    });
  } catch {
    return Response.json({ error: "The PDF could not be read or branded." }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
}
