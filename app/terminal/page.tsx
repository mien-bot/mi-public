import { TerminalWorkspace } from "@/components/TerminalWorkspace";
import { getAllLeads } from "@/lib/content/leads";
import { getAllProjects } from "@/lib/content/projects";
import {
  isActiveProjectStatus,
  isPortfolioProject,
} from "@/lib/content/projectVisibility";

export default function GlobalTerminalPage() {
  const projects = getAllProjects()
    .filter((project) =>
      isPortfolioProject({ slug: project.slug, name: project.meta.name })
      && isActiveProjectStatus(project.meta.status),
    )
    .map((project) => ({
      slug: project.slug,
      name: project.meta.name,
      status: project.meta.status ?? null,
      dropboxLinked: Boolean(project.meta.dropbox_path),
    }));

  // Excludes leads already converted to a project -- that lead's real workspace is the
  // project entry above, not a second, stale entry here.
  const leads = getAllLeads()
    .filter(({ lead }) => !lead.converted_project_slug)
    .map(({ slug, lead }) => ({
      slug,
      name: lead.name,
      status: lead.status,
      dropboxLinked: Boolean(lead.dropbox_path),
    }));

  return <TerminalWorkspace projects={projects} leads={leads} />;
}
