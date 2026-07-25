import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign } from "@/db/schema";
import { isDemoMode } from "@/lib/demo";
import { demoCampaigns } from "@/lib/demo-data";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageShell } from "@/components/page-shell";
import { NewCampaignDialog } from "@/components/campaigns/new-campaign-dialog";
import { CAMPAIGN_STATUS_BADGE } from "@/components/campaigns/status";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function CampaignsPage() {
  const rows = (await isDemoMode())
    ? demoCampaigns()
    : await db
    .select({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      createdAt: campaign.createdAt,
      // Identifiers are spelled out rather than interpolated: drizzle renders
      // ${table.column} unqualified inside a select-field template, so
      // ${campaign.id} became a bare "id" that resolved to the subquery's own
      // table — every count came back wrong (0 enrolled on every campaign).
      stepCount: sql<number>`(select count(*) from "sequence_step" where "sequence_step"."campaign_id" = "campaign"."id")::int`,
      activeCount: sql<number>`(select count(*) from "enrollment" where "enrollment"."campaign_id" = "campaign"."id" and "enrollment"."status" = 'active')::int`,
      totalCount: sql<number>`(select count(*) from "enrollment" where "enrollment"."campaign_id" = "campaign"."id")::int`,
    })
    .from(campaign)
    .orderBy(desc(campaign.createdAt));

  return (
    <PageShell title="Campaigns" actions={<NewCampaignDialog />}>
      {rows.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-6 py-16">
          <h2 className="text-sm font-semibold tracking-[-0.01em]">
            No campaigns yet
          </h2>
          <p className="mt-1.5 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
            Create a campaign, write its sequence steps, then enroll contacts
            from the Leads screen.
          </p>
        </div>
      ) : (
        <div className="px-6 py-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Name", "Status", "Steps", "Enrolled (active / total)", "Created"].map(
                    (label) => (
                      <TableHead
                        key={label}
                        className="whitespace-nowrap text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-[13px] font-medium">
                      <Link href={`/campaigns/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={CAMPAIGN_STATUS_BADGE[c.status]}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[13px]">{c.stepCount}</TableCell>
                    <TableCell className="text-[13px]">
                      {c.activeCount}{" "}
                      <span className="text-muted-foreground">/ {c.totalCount}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">
                      {dateFormatter.format(c.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </PageShell>
  );
}
