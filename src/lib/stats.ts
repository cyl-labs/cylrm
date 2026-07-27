import { sql } from "drizzle-orm";
import { db } from "@/db";

export type StatsBy = "campaign" | "leadlist";

export type EntityStats = {
  id: number;
  sent: number;
  bounces: number;
  replies: number;
  ooo: number;
  completion: number;
  deals: number;
  positive: number;
  demos: number;
  won: number;
  avgSecondsToDemo: number | null;
};

export type StepStat = { campaignId: number; step: number; sent: number; replies: number };

export type AccountStat = {
  accountId: number;
  email: string;
  domain: string;
  sent: number;
  bounces: number;
  replies: number;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** All Stats-screen metrics, computed live from enrollment/message/deal/
 * deal_stage_change (no analytics tables). `since` = null for all time. */
export async function getEntityStats(
  by: StatsBy,
  since: Date | null,
): Promise<Map<number, EntityStats>> {
  // Grouping key: campaign via enrollment, lead list via enrollment→contact.
  const groupMsg =
    by === "campaign" ? sql.raw("e.campaign_id") : sql.raw("c.lead_list_id");
  const contactJoinMsg =
    by === "campaign" ? sql.raw("") : sql.raw("join contact c on c.id = e.contact_id");
  const groupDeal =
    by === "campaign" ? sql.raw("d.campaign_id") : sql.raw("c.lead_list_id");
  const contactJoinDeal =
    by === "campaign" ? sql.raw("") : sql.raw("join contact c on c.id = d.contact_id");

  const msgRows = (await db.execute(sql`
    select ${groupMsg} as id,
      count(*) filter (where m.kind = 'sent') as sent,
      count(*) filter (where m.kind = 'bounce') as bounces,
      count(*) filter (where m.kind = 'reply' and m.direction = 'in') as replies,
      count(*) filter (where m.kind = 'auto_reply' and m.direction = 'in') as ooo
    from message m
    join enrollment e on e.id = m.enrollment_id
    ${contactJoinMsg}
    where ${since ? sql`m.sent_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    group by 1
  `)) as Row[];

  const completionRows = (await db.execute(sql`
    select ${groupMsg} as id, count(*) as completion
    from enrollment e
    ${contactJoinMsg}
    where e.status = 'completed'
      and ${
        since
          ? sql`exists (select 1 from message where enrollment_id = e.id and kind = 'sent' and sent_at >= ${since.toISOString()}::timestamptz)`
          : sql`true`
      }
    group by 1
  `)) as Row[];

  // Transitions only count while the deal remains at/past that stage, so an
  // undone drag doesn't inflate metrics (same rule as the Pipeline tiles).
  const dealRows = (await db.execute(sql`
    select ${groupDeal} as id,
      count(distinct d.id) as deals,
      count(distinct d.id) filter (where sc.to_stage in ('interested','demo_booked','won') and d.stage in ('interested','demo_booked','won','lost')) as positive,
      count(distinct d.id) filter (where sc.to_stage = 'demo_booked' and d.stage in ('demo_booked','won','lost')) as demos,
      count(distinct d.id) filter (where sc.to_stage = 'won' and d.stage = 'won') as won
    from deal d
    ${contactJoinDeal}
    left join deal_stage_change sc on sc.deal_id = d.id
      and ${since ? sql`sc.changed_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    where ${since ? sql`d.created_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    group by 1
  `)) as Row[];

  const demoTimeRows = (await db.execute(sql`
    select ${groupDeal} as id,
      avg(extract(epoch from dd.first_demo - fs.first_sent)) as avg_secs
    from deal d
    ${contactJoinDeal}
    join lateral (
      select min(changed_at) as first_demo from deal_stage_change
      where deal_id = d.id and to_stage = 'demo_booked'
        and ${since ? sql`changed_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    ) dd on dd.first_demo is not null and d.stage in ('demo_booked','won','lost')
    join lateral (
      select min(m.sent_at) as first_sent
      from message m join enrollment e2 on e2.id = m.enrollment_id
      where e2.contact_id = d.contact_id and e2.campaign_id = d.campaign_id
        and m.kind = 'sent'
    ) fs on fs.first_sent is not null
    group by 1
  `)) as Row[];

  const out = new Map<number, EntityStats>();
  const entry = (id: number): EntityStats => {
    const existing = out.get(id);
    if (existing) return existing;
    const created: EntityStats = {
      id,
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
    out.set(id, created);
    return created;
  };
  for (const r of msgRows) {
    if (r.id === null) continue;
    Object.assign(entry(n(r.id)), {
      sent: n(r.sent),
      bounces: n(r.bounces),
      replies: n(r.replies),
      ooo: n(r.ooo),
    });
  }
  for (const r of completionRows) {
    if (r.id !== null) entry(n(r.id)).completion = n(r.completion);
  }
  for (const r of dealRows) {
    if (r.id === null) continue;
    Object.assign(entry(n(r.id)), {
      deals: n(r.deals),
      positive: n(r.positive),
      demos: n(r.demos),
      won: n(r.won),
    });
  }
  for (const r of demoTimeRows) {
    if (r.id !== null && r.avg_secs !== null) {
      entry(n(r.id)).avgSecondsToDemo = Number(r.avg_secs);
    }
  }
  return out;
}

export type VariantStats = {
  variant: "a" | "b";
  contacts: number;
  sent: number;
  replies: number;
  demos: number;
};

/**
 * A vs B inside one campaign, all time.
 *
 * The unit is the enrollment, not the message: a contact is pinned to one arm
 * at enroll time and stays there for the whole thread, so replies and demos
 * attribute cleanly to the arm even though they arrive at the sequence level
 * rather than at any one step.
 */
export async function getVariantStats(
  campaignId: number,
): Promise<Record<"a" | "b", VariantStats>> {
  const msgRows = (await db.execute(sql`
    select e.variant as variant,
      count(distinct e.id) as contacts,
      count(m.id) filter (where m.kind = 'sent') as sent,
      count(m.id) filter (where m.kind = 'reply' and m.direction = 'in') as replies
    from enrollment e
    left join message m on m.enrollment_id = e.id
    where e.campaign_id = ${campaignId}
    group by 1
  `)) as Row[];

  // Same at/past-stage rule as the Pipeline tiles, so an undone drag doesn't
  // inflate one arm.
  const demoRows = (await db.execute(sql`
    select e.variant as variant,
      count(distinct d.id) filter (where sc.to_stage = 'demo_booked' and d.stage in ('demo_booked','won','lost')) as demos
    from deal d
    join enrollment e on e.contact_id = d.contact_id and e.campaign_id = d.campaign_id
    left join deal_stage_change sc on sc.deal_id = d.id
    where d.campaign_id = ${campaignId}
    group by 1
  `)) as Row[];

  const out: Record<"a" | "b", VariantStats> = {
    a: { variant: "a", contacts: 0, sent: 0, replies: 0, demos: 0 },
    b: { variant: "b", contacts: 0, sent: 0, replies: 0, demos: 0 },
  };
  for (const r of msgRows) {
    const v = r.variant === "b" ? "b" : "a";
    out[v].contacts = n(r.contacts);
    out[v].sent = n(r.sent);
    out[v].replies = n(r.replies);
  }
  for (const r of demoRows) {
    const v = r.variant === "b" ? "b" : "a";
    out[v].demos = n(r.demos);
  }
  return out;
}

/** Per-step sent counts and reply attribution (the step whose outbound
 * message most recently preceded each reply). Campaign dimension only. */
export async function getStepStats(since: Date | null): Promise<StepStat[]> {
  const sentRows = (await db.execute(sql`
    select e.campaign_id as cid, m.step_number as step, count(*) as sent
    from message m join enrollment e on e.id = m.enrollment_id
    where m.kind = 'sent' and m.step_number is not null
      and ${since ? sql`m.sent_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    group by 1, 2
  `)) as Row[];
  const replyRows = (await db.execute(sql`
    select e.campaign_id as cid, a.step as step, count(*) as replies
    from message r
    join enrollment e on e.id = r.enrollment_id
    join lateral (
      select max(o.step_number) as step from message o
      where o.enrollment_id = r.enrollment_id and o.kind = 'sent'
        and o.sent_at <= r.sent_at
    ) a on a.step is not null
    where r.kind = 'reply' and r.direction = 'in'
      and ${since ? sql`r.sent_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    group by 1, 2
  `)) as Row[];

  const byKey = new Map<string, StepStat>();
  const entry = (cid: number, step: number): StepStat => {
    const key = `${cid}:${step}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const created = { campaignId: cid, step, sent: 0, replies: 0 };
    byKey.set(key, created);
    return created;
  };
  for (const r of sentRows) entry(n(r.cid), n(r.step)).sent = n(r.sent);
  for (const r of replyRows) entry(n(r.cid), n(r.step)).replies = n(r.replies);
  return [...byKey.values()].sort(
    (a, b) => a.campaignId - b.campaignId || a.step - b.step,
  );
}

export async function getAccountStats(since: Date | null): Promise<AccountStat[]> {
  const rows = (await db.execute(sql`
    select sa.id as account_id, sa.email, dm.name as domain,
      count(m.id) filter (where m.kind = 'sent') as sent,
      count(m.id) filter (where m.kind = 'bounce') as bounces,
      count(m.id) filter (where m.kind = 'reply' and m.direction = 'in') as replies
    from sending_account sa
    join domain dm on dm.id = sa.domain_id
    left join message m on m.account_id = sa.id
      and ${since ? sql`m.sent_at >= ${since.toISOString()}::timestamptz` : sql`true`}
    group by 1, 2, 3
    order by dm.name, sa.email
  `)) as Row[];
  return rows.map((r) => ({
    accountId: n(r.account_id),
    email: String(r.email),
    domain: String(r.domain),
    sent: n(r.sent),
    bounces: n(r.bounces),
    replies: n(r.replies),
  }));
}
