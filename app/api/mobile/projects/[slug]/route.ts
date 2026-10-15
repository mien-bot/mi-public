import { remoteFailure, remoteHeaders, requireRemoteReader } from "@/lib/remoteAccess/access";
import { remoteProject } from "@/lib/remoteAccess/projects";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const principal = await requireRemoteReader(request);
    return Response.json(await remoteProject(principal, (await params).slug), { headers: remoteHeaders });
  } catch (error) { return remoteFailure(error); }
}
