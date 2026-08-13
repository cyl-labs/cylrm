import { Fragment } from "react";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { campaign, leadList } from "@/db/schema";
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

const CARD = "rounded-[14px] border bg-card shadow-[0_1px_3px_rgba(41,47,76,0.05)]";
const GRID_COLS = "grid grid-cols-[minmax(0,1fr)_90px_90px_110px_90px] items-center";

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
    <div className={CARD}>
      <div className="border-b border-border/60 px-5 py-[18px]">
        <p className="truncate text-sm font-extrabold tracking-[-0.01em]">{name}</p>
        <p className="mt-2.5 text-[34px] font-extrabold leading-none tracking-[-0.02em] text-primary tabular-nums">
          {per100(stats.demos, stats.sent)}
        </p>
        <p className="mt-1.5 text-xs font-semibold text-muted-foreground/75">
          demos per 100 sends
        </p>
      </div>
      <dl className="space-y-[9px] px-5 py-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[13px] font-semibold text-muted-foreground">
              {label}
            </dt>
            <dd className="text-[13px] font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {steps && steps.length > 0 && (
        <div className="border-t border-border/60 px-5 pb-[18px] pt-3.5">
          <p className="mb-2.5 text-xs font-bold text-muted-foreground/75">
            Step attribution
          </p>
          <div className="space-y-[7px]">
            {steps.map((s) => (
              <div
                key={s.step}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-[11.5px] font-bold text-primary">
                  Step {s.step}
                </span>
                <span className="text-[12.5px] font-semibold text-muted-foreground tabular-nums">
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

  const numCell = "px-3.5 py-[11px] text-right text-[13px] tabular-nums";
  const headNum = "px-3.5 py-2.5 text-right text-xs font-bold text-muted-foreground";

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
      <div className="mx-auto flex max-w-[920px] flex-col gap-[18px] px-4 pb-10 pt-6 sm:px-7">
        <p className="text-[12.5px] font-semibold leading-normal text-muted-foreground/75">
          Live comparison over the selected range. Differences under roughly 2×
          at low volume are noise — keep at most 2 active approach tests running
          and change one variable between them.
        </p>
        {panelA || panelB ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {panelA ? (
              <ComparisonPanel {...panelA} />
            ) : (
              <div className="rounded-[14px] border border-dashed p-6 text-center text-[13px] font-semibold text-muted-foreground">
                Pick something to compare.
              </div>
            )}
            {panelB ? (
              <ComparisonPanel {...panelB} />
            ) : (
              <div className="rounded-[14px] border border-dashed p-6 text-center text-[13px] font-semibold text-muted-foreground">
                Pick a second {by === "campaign" ? "campaign" : "lead list"} to
                compare.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed px-6 py-12 text-center text-[13px] font-semibold text-muted-foreground">
            Nothing to compare yet — create a campaign and enroll contacts
            first.
          </div>
        )}

        <div className={CARD}>
          <div className="border-b border-border/60 px-5 py-4">
            <p className="text-sm font-extrabold tracking-[-0.01em]">
              Accounts &amp; domains
            </p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground/75">
              Bounce alarm at &gt;2% per domain — display-only, sending is not
              auto-paused.
            </p>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className={`${GRID_COLS} border-b border-border/60`}>
                <div className="py-2.5 pl-5 pr-3.5 text-xs font-bold text-muted-foreground">
                  Account
                </div>
                <div className={headNum}>Sent</div>
                <div className={headNum}>Bounces</div>
                <div className={headNum}>Bounce rate</div>
                <div className={`${headNum} pr-5`}>Replies</div>
              </div>
              {[...domains.entries()].map(([domainName, d]) => (
                <Fragment key={domainName}>
                  <div className={`${GRID_COLS} border-b border-border/40 bg-[#fbfbfe] dark:bg-muted/30`}>
                    <div className="truncate py-[11px] pl-5 pr-3.5 text-[13.5px] font-extrabold">
                      <span className="inline-flex items-center gap-2">
                        {domainName}
                        {d.sent > 0 && d.bounces / d.sent > BOUNCE_ALARM && (
                          <span className="inline-flex rounded-full bg-destructive px-2.5 py-0.5 text-[10.5px] font-bold text-white">
                            bounce alarm
                          </span>
                        )}
                      </span>
                    </div>
                    <div className={numCell}>{d.sent}</div>
                    <div className={numCell}>{d.bounces}</div>
                    <div className={numCell}>{pct(d.bounces, d.sent)}</div>
                    <div className={`${numCell} pr-5`}>{d.replies}</div>
                  </div>
                  {accountStats
                    .filter((acct) => acct.domain === domainName)
                    .map((acct) => (
                      <div
                        key={acct.accountId}
                        className={`${GRID_COLS} border-b border-border/40 last:border-b-0`}
                      >
                        <div className="truncate py-[11px] pl-[38px] pr-3.5 text-[13px] font-semibold text-muted-foreground">
                          {acct.email}
                        </div>
                        <div className={numCell}>{acct.sent}</div>
                        <div className={numCell}>{acct.bounces}</div>
                        <div className={numCell}>{pct(acct.bounces, acct.sent)}</div>
                        <div className={`${numCell} pr-5`}>{acct.replies}</div>
                      </div>
                    ))}
                </Fragment>
              ))}
              {domains.size === 0 && (
                <div className="px-5 py-8 text-center text-[13px] font-semibold text-muted-foreground">
                  No sending accounts connected.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
