import { z } from "zod";
import { dropboxWorkspaceRoot } from "@/lib/content/dropboxWorkspace";
import { applyDropboxReview, downloadDropboxReview, readDropboxHealth, reviewDropboxFile } from "@/lib/content/dropboxHealth";
import { isLoopbackHostname } from "@/lib/remoteAccess/config";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ kind: string; slug: string }> };
function localRequest(request: Request, mutation = false) {
  const host = request.headers.get("host") || new URL(request.url).host;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { throw new Error("Local access required."); }
  if (!isLoopbackHostname(hostname) || request.headers.has("cf-access-jwt-assertion") || request.headers.has("cf-connecting-ip")) throw new Error("Open Dropbox recovery on the local Mi host.");
  if (mutation) {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== host || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Use the local Mi review controls to confirm this write.");
  }
}
export async function GET(request: Request, context: Context) {
  try {
    localRequest(request);
    const { kind, slug } = await context.params;
    const root = await dropboxWorkspaceRoot(kind, slug);
    const query = new URL(request.url).searchParams;
    if (query.get("review")) {
      const review = z.enum(["recovery", "conflict"]).parse(query.get("review"));
      const reviewed = await reviewDropboxFile(root, review, query.get("path") || "");
      if (query.has("download")) {
        const side = z.enum(["current", "proposed"]).parse(query.get("download"));
        return new Response(new Uint8Array(await downloadDropboxReview(root, reviewed, side)), { headers: { ...headers,
          "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${side}-${reviewed.target.split("/").at(-1)}`)}` } });
      }
      return Response.json(reviewed, { headers });
    }
    return Response.json(await readDropboxHealth(root, query.get("refresh") === "1"), { headers });
  } catch { return Response.json({ error: "Dropbox folder or review is unavailable. Check the confirmed folder and refresh; linked paths and files over 20 MB cannot be reviewed here." }, { status: 400, headers }); }
}
const confirmation = z.object({
  confirmed: z.literal(true), kind: z.enum(["recovery", "conflict"]), path: z.string().max(1000), target: z.string().max(1000),
  currentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), proposedHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export async function POST(request: Request, context: Context) {
  try {
    localRequest(request, true);
    if (Number(request.headers.get("content-length")) > 5000) throw new Error("Request too large.");
    const text = await request.text();
    if (text.length > 5000) throw new Error("Request too large.");
    const reviewed = confirmation.parse(JSON.parse(text));
    const { kind, slug } = await context.params;
    const root = await dropboxWorkspaceRoot(kind, slug);
    await applyDropboxReview(root, { ...reviewed, currentText: "", proposedText: "", currentSize: 0, proposedSize: 0, canApply: true, reason: "" });
    return Response.json({ message: "Saved locally. Previous content is backed up; the other copy is retained. Dropbox cloud synchronization is not verified." }, { headers });
  } catch { return Response.json({ error: "Save was not completed. The files may have changed or remain locked. Refresh and review again; recovery content and conflict copies are retained." }, { status: 409, headers }); }
}
