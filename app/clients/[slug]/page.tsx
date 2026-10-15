import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, getClientProjects, getClientSlugs } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";

export function generateStaticParams() {
  return getClientSlugs().map((slug) => ({ slug }));
}

export default async function ClientDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getClientSlugs().includes(slug)) notFound();

  const { client } = getClient(slug);
  const projects = getClientProjects(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/clients" className="text-sm text-muted-foreground hover:underline">
          ← Clients
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl font-light tracking-wide">{client.name}</h1>
          <StatusBadge status={client.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[client.industry, client.first_engaged && `since ${client.first_engaged}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {client.short_summary && (
        <section>
          <h2 className="font-medium">Summary</h2>
          <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{client.short_summary}</p>
        </section>
      )}

      {(client.primary_contact_name || client.contact_email || client.contact_phone) && (
        <section>
          <h2 className="font-medium">Contact</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {[client.primary_contact_name, client.contact_email, client.contact_phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </section>
      )}

      <section>
        <h2 className="font-medium">Projects</h2>
        <div className="mt-2 flex flex-col gap-2">
          {projects.map((project) => (
            <Link
              key={project.slug}
              href={`/projects/${project.slug}`}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition-colors hover:border-accent"
            >
              <div>
                <div className="font-medium">{project.meta.name}</div>
                <div className="text-muted-foreground">{project.meta.address}</div>
              </div>
              <StatusBadge status={project.meta.status} />
            </Link>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects linked yet — set <code>client_id: {slug}</code> in a project&apos;s{" "}
              <code>project.yaml</code>.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
