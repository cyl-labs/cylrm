import { Fragment } from "react";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { campaign, leadList } from "@/db/schema";
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
import { StatsControls } from "@/components/stats/stats-controls";
import {
  getAccountStats,
  getEntityStats,
  getStepStats,
  type EntityStats,
  type StatsBy,
  type StepStat,
} from "@/lib/stats";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number | null> = { "7": 7, "30": 30, "90": 90, all: null };
const BOUNCE_ALARM = 0.02;

const pct = (num: number, den: number) =>
  den === 0 ? "—" : `${((num / den) * 100).toFixed(1)}%`;
const per100 = (num: number, den: number) =>
  den === 0 ? "—" : ((num / den) * 100).toFixed(1);

function humanizeSeconds(secs: number | null): string {
  if (secs === null) return "—";
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86_400).toFixed(1)}d`;
}

const EMPTY: Omit<EntityStats, "id"> = {
  sent: 0,
  bounces: 0,
  replies: 0,
  ooo: 0,
  completion: 0,
  deals: 0,
  positive: 0,
  demos: 0,
  won: 0,
  avgSecondsToDemo: null,
};

function ComparisonPanel({
  name,
  stats,
  steps,
}: {
  name: string;
  stats: Omit<EntityStats, "id">;
  steps: StepStat[] | null;
}) {
  const rows: [string, string][] = [
    ["Sent", String(stats.sent)],
    ["Bounces", `${stats.bounces} (${pct(stats.bounces, stats.sent)})`],
    ["Replies (human)", `${stats.replies} (${pct(stats.replies, stats.sent)})`],
    ["OOO / auto-replies", String(stats.ooo)],
    ["Completed, no reply", String(stats.completion)],
    ["Positive replies", String(stats.positive)],
    ["Win rate", `${stats.won} won (${pct(stats.won, stats.deals)})`],
    ["Time to demo (avg)", humanizeSeconds(stats.avgSecondsToDemo)],
  ];
  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <p className="truncate text-sm font-semibold tracking-[-0.01em]">{name}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums tracking-[-0.02em]">
          {per100(stats.demos, stats.sent)}
        </p>
        <p className="text-xs text-muted-foreground">demos per 100 sends</p>
      </div>
      <dl className="space-y-2 px-4 py-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {steps && steps.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Step attribution
          </p>
          <div className="space-y-1.5">
            {steps.map((s) => (
              <div
                key={s.step}
                className="flex items-baseline justify-between gap-3 text-[13px]"
              >
                <span className="text-muted-foreground">Step {s.step}</span>
                <span className="tabular-nums">
                  {s.sent} sent · {s.replies} repl{s.replies === 1 ? "y" : "ies"} (
                  {pct(s.replies, s.sent)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; a?: string; b?: string; range?: string }>;
}) {
  const params = await searchParams;
  const by: StatsBy = params.by === "leadlist" ? "leadlist" : "campaign";
  const range = params.range && params.range in RANGES ? params.range : "30";
  const days = RANGES[range];
  const since =
    days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [campaigns, leadLists, entityStats, stepStats, accountStats] =
    await Promise.all([
      db
        .select({ id: campaign.id, name: campaign.name })
        .from(campaign)
        .orderBy(desc(campaign.createdAt)),
      db
        .select({ id: leadList.id, name: leadList.name, niche: leadList.niche })
        .from(leadList)
        .orderBy(asc(leadList.name)),
      getEntityStats(by, since),
      getStepStats(since),
      getAccountStats(since),
    ]);

  const entities =
    by === "campaign"
      ? campaigns
      : leadLists.map((l) => ({
          id: l.id,
          name: l.niche ? `${l.name} (${l.niche})` : l.name,
        }));
  const parseId = (raw: string | undefined, fallback: number | null) => {
    const v = Number(raw);
    return Number.isInteger(v) && entities.some((e) => e.id === v) ? v : fallback;
  };
  const a = parseId(params.a, entities[0]?.id ?? null);
  const b = parseId(params.b, entities[1]?.id ?? null);

  const panel = (id: number | null) => {
    if (id === null) return null;
    const entity = entities.find((e) => e.id === id);
    if (!entity) return null;
    return {
      name: entity.name,
      stats: entityStats.get(id) ?? EMPTY,
      steps: by === "campaign" ? stepStats.filter((s) => s.campaignId === id) : null,
    };
  };
  const panelA = panel(a);
  const panelB = panel(b);

  const domains = new Map<
    string,
    { sent: number; bounces: number; replies: number }
  >();
  for (const acct of accountStats) {
    const d = domains.get(acct.domain) ?? { sent: 0, bounces: 0, replies: 0 };
    d.sent += acct.sent;
    d.bounces += acct.bounces;
    d.replies += acct.replies;
    domains.set(acct.domain, d);
  }

  return (
    <PageShell
      title="Stats"
      actions={
        <StatsControls
          by={by}
          a={a}
          b={b}
          range={range}
          campaigns={campaigns}
          leadLists={entities === campaigns ? [] : entities}
        />
      }
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-4">
        <p className="text-xs text-muted-foreground">
          Live comparison over the selected range. Differences under roughly 2×
          at low volume are noise — keep at most 2 active approach tests running
          and change one variable between them.
        </p>
        {panelA || panelB ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {panelA ? (
              <ComparisonPanel {...panelA} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">
                Pick something to compare.
              </div>
            )}
            {panelB ? (
              <ComparisonPanel {...panelB} />
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-[13px] text-muted-foreground">
                Pick a second {by === "campaign" ? "campaign" : "lead list"} to
                compare.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed px-6 py-12 text-center text-[13px] text-muted-foreground">
            Nothing to compare yet — create a campaign and enroll contacts
            first.
          </div>
        )}

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold tracking-[-0.01em]">
              Accounts &amp; domains
            </p>
            <p className="text-xs text-muted-foreground">
              Bounce alarm at &gt;2% per domain — display-only, sending is not
              auto-paused.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {["Account", "Sent", "Bounces", "Bounce rate", "Replies"].map(
                  (h) => (
                    <TableHead
                      key={h}
                      className="whitespace-nowrap text-xs font-medium text-muted-foreground"
                    >
                      {h}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...domains.entries()].map(([domainName, d]) => (
                <Fragment key={domainName}>
                  <TableRow className="bg-muted/40">
                    <TableCell className="text-[13px] font-medium">
                      {domainName}
                      {d.sent > 0 && d.bounces / d.sent > BOUNCE_ALARM && (
                        <Badge className="ml-2 bg-destructive/10 text-[11px] text-destructive">
                          bounce alarm
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">{d.sent}</TableCell>
                    <TableCell className="text-[13px] tabular-nums">
                      {d.bounces}
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">
                      {pct(d.bounces, d.sent)}
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">
                      {d.replies}
                    </TableCell>
                  </TableRow>
                  {accountStats
                    .filter((acct) => acct.domain === domainName)
                    .map((acct) => (
                      <TableRow key={acct.accountId}>
                        <TableCell className="pl-8 text-[13px] text-muted-foreground">
                          {acct.email}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums">
                          {acct.sent}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums">
                          {acct.bounces}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums">
                          {pct(acct.bounces, acct.sent)}
                        </TableCell>
                        <TableCell className="text-[13px] tabular-nums">
                          {acct.replies}
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              ))}
              {domains.size === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-16 text-center text-[13px] text-muted-foreground"
                  >
                    No sending accounts connected.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageShell>
  );
}
