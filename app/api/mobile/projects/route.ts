import { remoteFailure, remoteHeaders, requireRemoteReader } from "@/lib/remoteAccess/access";
import { remoteProjects } from "@/lib/remoteAccess/projects";

export async function GET(request: Request) {
  try { return Response.json({ projects: remoteProjects(await requireRemoteReader(request)) }, { headers: remoteHeaders }); }
  catch (error) { return remoteFailure(error); }
}
