import path from "node:path";
import { clientSchema, type Client } from "@/lib/schema";
import { listFiles, readYamlFile } from "./fsUtils";
import { resolveFirmDataDir } from "./paths";
import { getAllProjects, type Project } from "./projects";

export interface ClientRecord {
  slug: string;
  client: Client;
}

/** clients/<slug>.yaml — one file per client, a top-level entity like a project (not a child list). */
export function getClientSlugs(): string[] {
  return listFiles(resolveFirmDataDir("clients").dir, ".yaml").map((file) => file.replace(/\.yaml$/, ""));
}

export function getClient(slug: string): ClientRecord {
  const filePath = path.join(resolveFirmDataDir("clients").dir, `${slug}.yaml`);
  return { slug, client: readYamlFile(filePath, (data) => clientSchema.parse(data)) };
}

export function getAllClients(): ClientRecord[] {
  return getClientSlugs().map(getClient);
}

/** Derived by scanning projects for a matching client_id — not stored on the client record, same "derive don't duplicate" principle as getProjectUrgency. */
export function getClientProjects(clientSlug: string): Project[] {
  return getAllProjects().filter((project) => project.meta.client_id === clientSlug);
}
