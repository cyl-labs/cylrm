import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaign, contact, deal, dealStageChange, message } from "@/db/schema";
import { isDemoMode } from "@/lib/demo";
import { demoDeals, demoPipelineTiles } from "@/lib/demo-data";
import { PageShell } from "@/components/page-shell";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { RangeSelect } from "@/components/pipeline/range-select";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range = rawRange && rawRange in RANGES ? rawRange : "30";

  if (await isDemoMode()) {
    const t = demoPipelineTiles;
    const demoTiles = [
      { label: "Sent", value: t.sent },
      { label: "Replies", value: t.replies },
      { label: "Demos booked", value: t.demos },
      { label: "Won", value: t.won },
    ];
    return (
      <PageShell title="Pipeline" actions={<RangeSelect value={range} />}>
        <div className="flex h-full flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
            {demoTiles.map((tile) => (
              <div key={tile.label} className="rounded-lg border px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {tile.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">
                  {tile.value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <PipelineBoard deals={demoDeals()} />
        </div>
      </PageShell>
    );
  }

  const days = RANGES[range];
  const since =
    days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sentWhere = since
    ? and(eq(message.kind, "sent"), gte(message.sentAt, since))
    : eq(message.kind, "sent");
  const replyWhere = since
    ? and(
        eq(message.direction, "in"),
        eq(message.kind, "reply"),
        gte(message.sentAt, since),
      )
    : and(eq(message.direction, "in"), eq(message.kind, "reply"));

  // A transition only counts if the deal is still at (or past) that stage —
  // otherwise a drag that was undone seconds later inflates the tile forever.
  const stageCount = (stage: "demo_booked" | "won") => {
    const stillThere =
      stage === "won"
        ? eq(deal.stage, "won")
        : sql`${deal.stage} in ('demo_booked', 'won', 'lost')`;
    const base = and(eq(dealStageChange.toStage, stage), stillThere);
    return db
      .select({ n: sql<number>`count(distinct ${dealStageChange.dealId})::int` })
      .from(dealStageChange)
      .innerJoin(deal, eq(dealStageChange.dealId, deal.id))
      .where(since ? and(base, gte(dealStageChange.changedAt, since)) : base);
  };

  const [[sent], [replies], [demos], [won], deals] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(message).where(sentWhere),
    db.select({ n: sql<number>`count(*)::int` }).from(message).where(replyWhere),
    stageCount("demo_booked"),
    stageCount("won"),
    db
      .select({
        id: deal.id,
        stage: deal.stage,
        createdAt: deal.createdAt,
        contactName: sql<
          string | null
        >`nullif(trim(concat(${contact.firstName}, ' ', ${contact.lastName})), '')`,
        contactEmail: contact.email,
        company: contact.company,
        campaignName: campaign.name,
        // Identifiers spelled out on purpose — drizzle renders
        // ${table.column} unqualified in a select-field template, so the
        // correlation read "deal_id" = "id" against deal_stage_change's own
        // columns and every card fell back to the deal's creation date.
        stageSince: sql<string>`coalesce((select max("changed_at") from "deal_stage_change" where "deal_stage_change"."deal_id" = "deal"."id"), "deal"."created_at")`,
        // Surfaced on the card so a removal request is not missed behind a
        // click, which is the whole point of flagging it.
        asksToBeRemoved: sql<boolean>`exists (select 1 from "message" m
          join "enrollment" e on e.id = m."enrollment_id"
          where e."contact_id" = "deal"."contact_id"
            and e."campaign_id" = "deal"."campaign_id"
            and m."unsubscribe_intent")`,
      })
      .from(deal)
      .innerJoin(contact, eq(deal.contactId, contact.id))
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .orderBy(desc(deal.createdAt)),
  ]);

  const tiles = [
    { label: "Sent", value: sent.n },
    { label: "Replies", value: replies.n },
    { label: "Demos booked", value: demos.n },
    { label: "Won", value: won.n },
  ];

  return (
    <PageShell title="Pipeline" actions={<RangeSelect value={range} />}>
      <div className="flex h-full flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t.label}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]">
                {t.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
        <PipelineBoard
          deals={deals.map((d) => ({
            id: d.id,
            stage: d.stage,
            contactName: d.contactName,
            contactEmail: d.contactEmail,
            company: d.company,
            campaignName: d.campaignName,
            stageSince: new Date(d.stageSince).toISOString(),
          }))}
        />
      </div>
    </PageShell>
  );
}
