import { PermitQaqcBrowser, type PermitQaqcListEntry } from "@/components/PermitQaqcBrowser";
import { getAllPermitQaqcEngagements } from "@/lib/content";
import { detectFirmDataConflicts } from "@/lib/content/paths";
import { DataConflictBanner } from "@/components/DataConflictBanner";
import { FirmScopeChat } from "@/components/FirmScopeChat";
import { WorkspaceIntro } from "@/components/WorkspaceIntro";

export default async function PermitQaqcPage({
  searchParams,
}: {
  searchParams: Promise<{ newChat?: string }>;
}) {
  const query = await searchParams;
  const entries: PermitQaqcListEntry[] = getAllPermitQaqcEngagements().map(({ slug, engagement }) => ({
    slug,
    name: engagement.name,
    submittingFirm: engagement.submitting_firm,
    status: engagement.status,
    engagementNumber: engagement.engagement_number,
    roundCount: engagement.rounds.length,
    latestReceivedDate: engagement.rounds.reduce<string | null>(
      (latest, round) => !latest || round.received_date > latest ? round.received_date : latest,
      null,
    ),
  }));
  const { permitQaqc: conflicts } = detectFirmDataConflicts();

  return (
    <div className="flex flex-col gap-6">
      <WorkspaceIntro
        icon="qaqc"
        eyebrow="Independent review"
        title="Permit QAQC"
        description="Review and stamp another firm’s drawing set before permit submission. This is a separate service line from STUDIO projects and is not tracked in Notion."
      />
      <DataConflictBanner conflicts={conflicts} />
      <FirmScopeChat scope="permit-qaqc" startFresh={query.newChat === "1"} />
      <PermitQaqcBrowser engagements={entries} />
    </div>
  );
}
