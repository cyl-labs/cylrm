import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, enrollment, sequenceStep } from "@/db/schema";
import { isDemoMode } from "@/lib/demo";
import { demoCampaignDetail } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { CampaignStatusControl } from "@/components/campaigns/campaign-status-control";
import { StepsEditor } from "@/components/campaigns/steps-editor";

export const dynamic = "force-dynamic";

const ENROLLMENT_STATUSES = [
  "active",
  "completed",
  "replied",
  "bounced",
  "ooo_paused",
  "failed",
  "unsubscribed",
] as const;

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) notFound();

  if (await isDemoMode()) {
    const demo = demoCampaignDetail(campaignId);
    if (!demo) notFound();
    return (
      <PageShell
        title={demo.campaign.name}
        actions={
          <CampaignStatusControl
            campaignId={demo.campaign.id}
            status={demo.campaign.status}
          />
        }
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {ENROLLMENT_STATUSES.map((s) => (
              <span key={s}>
                <span className="font-medium text-foreground">
                  {demo.countByStatus.get(s) ?? 0}
                </span>{" "}
                {s.replace("_", " ")}
              </span>
            ))}
          </div>
          <StepsEditor campaignId={demo.campaign.id} steps={demo.steps} />
        </div>
      </PageShell>
    );
  }

  const [camp] = await db
    .select()
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  if (!camp) notFound();

  const [steps, counts] = await Promise.all([
    db
      .select()
      .from(sequenceStep)
      .where(eq(sequenceStep.campaignId, campaignId))
      .orderBy(asc(sequenceStep.stepNumber)),
    db
      .select({
        status: enrollment.status,
        count: sql<number>`count(*)::int`,
      })
      .from(enrollment)
      .where(eq(enrollment.campaignId, campaignId))
      .groupBy(enrollment.status),
  ]);
  const countByStatus = new Map(counts.map((c) => [c.status, c.count]));

  return (
    <PageShell
      title={camp.name}
      actions={<CampaignStatusControl campaignId={camp.id} status={camp.status} />}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {ENROLLMENT_STATUSES.map((s) => (
            <span key={s}>
              <span className="font-medium text-foreground">
                {countByStatus.get(s) ?? 0}
              </span>{" "}
              {s.replace("_", " ")}
            </span>
          ))}
        </div>
        <StepsEditor
          campaignId={camp.id}
          steps={steps.map((s) => ({
            id: s.id,
            stepNumber: s.stepNumber,
            waitDaysAfterPrevious: s.waitDaysAfterPrevious,
            subjectTemplate: s.subjectTemplate,
            bodyTemplate: s.bodyTemplate,
          }))}
        />
      </div>
    </PageShell>
  );
}
