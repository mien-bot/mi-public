import { remoteFailure, remoteHeaders, requireRemoteReader } from "@/lib/remoteAccess/access";
import { remoteProject, remoteProjects } from "@/lib/remoteAccess/projects";
import { remoteDocument } from "@/lib/remoteAccess/view";

export async function GET(request: Request) {
  try {
    const principal = await requireRemoteReader(request);
    const query = new URL(request.url).searchParams;
    const slug = query.get("project");
    const project = slug ? await remoteProject(principal, slug) : null;
    return new Response(remoteDocument(remoteProjects(principal), project, (query.get("q") || "").slice(0, 200)), {
      headers: { ...remoteHeaders, "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
    });
  } catch (error) { return remoteFailure(error); }
}
