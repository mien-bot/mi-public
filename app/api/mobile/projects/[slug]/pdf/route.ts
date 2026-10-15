import { remoteFailure, remoteHeaders, requireRemoteReader } from "@/lib/remoteAccess/access";
import { remotePdf } from "@/lib/remoteAccess/projects";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const principal = await requireRemoteReader(request);
    const relative = new URL(request.url).searchParams.get("path") || "";
    const bytes = await remotePdf(principal, (await params).slug, relative);
    return new Response(bytes, { headers: { ...remoteHeaders, "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(relative.split("/").at(-1)!)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (error) { return remoteFailure(error); }
}
