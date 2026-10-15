import { getAllClients, getClientProjects } from "@/lib/content";
import { detectFirmDataConflicts } from "@/lib/content/paths";
import { ClientsBrowser, type ClientListEntry } from "@/components/ClientsBrowser";
import { DataConflictBanner } from "@/components/DataConflictBanner";

export default function ClientsPage() {
  const clients: ClientListEntry[] = getAllClients().map(({ slug, client }) => ({
    slug,
    name: client.name,
    status: client.status,
    industry: client.industry || null,
    summary: client.short_summary || null,
    contactName: client.primary_contact_name || null,
    contactEmail: client.contact_email || null,
    firstEngaged: client.first_engaged,
    projectCount: getClientProjects(slug).length,
  }));
  const { clients: conflicts } = detectFirmDataConflicts();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-wide">Clients</h1>
      <DataConflictBanner conflicts={conflicts} />
      <ClientsBrowser clients={clients} />
    </div>
  );
}
