import { getSearchIndex } from "@/lib/content";
import { SearchBrowser } from "@/components/SearchBrowser";
import { ProjectFileSearch } from "@/components/ProjectFileSearch";
import { getAllProjects } from "@/lib/content/projects";
import { connection } from "next/server";

export default async function SearchPage() {
  await connection();
  const entries = getSearchIndex();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-wide">Search</h1>
      <SearchBrowser entries={entries} />
      <ProjectFileSearch projects={getAllProjects().map(project => ({ slug: project.slug, name: project.meta.name }))} />
    </div>
  );
}
