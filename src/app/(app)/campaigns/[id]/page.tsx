import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, contact, enrollment, sendingAccount, sequenceStep } from "@/db/schema";
import { getCampaignProgress } from "@/lib/campaign-progress";
import { isDemoMode } from "@/lib/demo";
import {
  demoCampaignDetail,
  demoCampaignEnrollments,
  demoCampaignProgress,
} from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { CampaignProgressCard } from "@/components/campaigns/campaign-progress-card";
import { CampaignStatusControl } from "@/components/campaigns/campaign-status-control";
import {
  EnrollmentsTable,
  type EnrollmentRow,
} from "@/components/campaigns/enrollments-table";
import { StepsEditor, type StepData } from "@/components/campaigns/steps-editor";
import { ENROLLMENT_STATUSES, enrollmentStatusLabel } from "@/components/campaigns/status";
import type { CampaignProgress } from "@/lib/campaign-progress";

export const dynamic = "force-dynamic";

function CampaignDetail({
  campaignId,
  name,
  status,
  progress,
  countByStatus,
  steps,
  enrollments,
}: {
  campaignId: number;
  name: string;
  status: "draft" | "active" | "paused";
  progress: CampaignProgress;
  countByStatus: Map<string, number>;
  steps: StepData[];
  enrollments: EnrollmentRow[];
}) {
  return (
    <PageShell
      title={name}
      actions={<CampaignStatusControl campaignId={campaignId} status={status} />}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-4">
        <CampaignProgressCard p={progress} />

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {ENROLLMENT_STATUSES.map((s) => (
              <span key={s}>
                <span className="font-medium text-foreground">
                  {countByStatus.get(s) ?? 0}
                </span>{" "}
                {enrollmentStatusLabel(s)}
              </span>
            ))}
          </div>
          <EnrollmentsTable
            rows={enrollments}
            stepCount={progress.stepCount}
            sendingTimezone={progress.window.timezone}
          />
        </section>

        <section className="flex max-w-3xl flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-[-0.01em]">Sequence</h2>
          <StepsEditor campaignId={campaignId} steps={steps} />
        </section>
      </div>
    </PageShell>
  );
}

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
    const progress = demoCampaignProgress(campaignId);
    if (!demo || !progress) notFound();
    return (
      <CampaignDetail
        campaignId={demo.campaign.id}
        name={demo.campaign.name}
        status={demo.campaign.status}
        progress={progress}
        countByStatus={demo.countByStatus}
        steps={demo.steps}
        enrollments={demoCampaignEnrollments(campaignId)}
      />
    );
  }

  const [camp] = await db
    .select()
    .from(campaign)
    .where(eq(campaign.id, campaignId));
  if (!camp) notFound();

  const [steps, counts, enrollmentRows, progress] = await Promise.all([
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
    // Soonest send first so whoever is up next sits at the top; terminal
    // enrollments (no next send) fall to the bottom.
    db
      .select({
        id: enrollment.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        contactEmail: contact.email,
        company: contact.company,
        currentStep: enrollment.currentStep,
        status: enrollment.status,
        accountEmail: sendingAccount.email,
        nextSendAt: enrollment.nextSendAt,
        // Evaluated in the database so the flag can't drift between the
        // server render and hydration.
        due: sql<boolean>`${enrollment.nextSendAt} <= now()`,
      })
      .from(enrollment)
      .innerJoin(contact, eq(enrollment.contactId, contact.id))
      .leftJoin(sendingAccount, eq(enrollment.assignedAccountId, sendingAccount.id))
      .where(eq(enrollment.campaignId, campaignId))
      .orderBy(
        sql`${enrollment.nextSendAt} is null`,
        asc(enrollment.nextSendAt),
        asc(enrollment.id),
      ),
    getCampaignProgress(campaignId),
  ]);

  return (
    <CampaignDetail
      campaignId={camp.id}
      name={camp.name}
      status={camp.status}
      progress={progress}
      countByStatus={new Map(counts.map((c) => [c.status, c.count]))}
      steps={steps.map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        waitDaysAfterPrevious: s.waitDaysAfterPrevious,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
      }))}
      enrollments={enrollmentRows.map((r) => ({
        id: r.id,
        contactName:
          [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        contactEmail: r.contactEmail,
        company: r.company,
        currentStep: r.currentStep,
        status: r.status,
        accountEmail: r.accountEmail,
        nextSendAt: r.nextSendAt?.toISOString() ?? null,
        due: r.status === "active" && r.due === true,
      }))}
    />
  );
}
