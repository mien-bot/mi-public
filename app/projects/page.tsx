import { connection } from "next/server";
import Link from "next/link";
import { ProjectsBrowser } from "@/components/ProjectsBrowser";
import { NewProjectForm } from "@/components/NewProjectForm";
import { PortfolioOverview } from "@/components/PortfolioOverview";
import { AllProjectHarnessManager } from "@/components/AllProjectHarnessManager";
import { AllProjectsNotionSyncButton } from "@/components/AllProjectsNotionSyncButton";
import { buildPortfolioSnapshot } from "@/lib/content/portfolioAnalytics";
import { WorkspaceIntro } from "@/components/WorkspaceIntro";
import { AppIcon } from "@/components/AppIcon";
import { PendingApprovalsSummary } from "@/components/PendingApprovalsSummary";
import { listPendingApprovals } from "@/lib/content/pendingApprovals";

export default async function ProjectsPage() {
  await connection();
  const snapshot = buildPortfolioSnapshot();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WorkspaceIntro
        icon="projects"
        eyebrow="Project delivery"
        title="Projects"
        description="Review active work, factual risks, and management-record coverage. Open a project to plan phases, milestones, meetings, decisions, and delivery checks."
        actions={<>
          <Link href="/projects/analysis" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-accent">
            <AppIcon name="analysis" className="h-4 w-4" />
            Studio analysis
          </Link>
          <AllProjectsNotionSyncButton />
          <NewProjectForm />
        </>}
      />
      <PendingApprovalsSummary approvals={listPendingApprovals()} />
      <ProjectsBrowser projects={snapshot.projects} />
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Portfolio overview &amp; evidence</summary>
        <div className="mt-4"><PortfolioOverview snapshot={snapshot} /></div>
      </details>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Dropbox agent workspace maintenance</summary>
        <div className="mt-4"><AllProjectHarnessManager /></div>
      </details>
    </div>
  );
}
