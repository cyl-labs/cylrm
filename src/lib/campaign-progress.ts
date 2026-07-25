import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";

/** The scheduler ticks every 5 minutes and sends at most one email per
 * account per tick (see the pacing rule in `scheduler.ts`), so an account's
 * real ceiling is the lower of its daily cap and the number of ticks left in
 * the sending window. */
const TICK_MINUTES = 5;

export type CampaignProgress = {
  campaignStatus: string;
  stepCount: number;
  /** Outbound sends already made for this campaign, all time. */
  sent: number;
  sentToday: number;
  /** Sends still owed to this campaign's active enrollments. */
  remaining: number;
  /** Active enrollments that have not received step 1 yet. */
  notStarted: number;
  /** Due right now and waiting on the next tick. */
  dueNow: number;
  /** OOO-paused enrollments. They are excluded from `remaining` because the
   * scheduler only picks up `active` rows and nothing moves them back. */
  oooPaused: number;
  percentComplete: number;
  /** Sends per day the whole system can make, across every eligible account. */
  capacityPerDay: number;
  capacityLeftToday: number;
  eligibleAccounts: number;
  /** Active campaigns sharing that capacity, including this one. */
  activeCampaigns: number;
  /** Sends owed across every active campaign — what the shared capacity has
   * to chew through, not just this campaign's share. */
  globalRemaining: number;
  etaDays: number | null;
  etaDate: string | null;
  window: {
    start: string;
    end: string;
    timezone: string;
    open: boolean;
    minutesRemaining: number;
  };
  /** Set when nothing can send at all; the ETA is null in that case. */
  blockedReason: string | null;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

function zoneMinutes(tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/**
 * Live progress and a finish estimate for one campaign.
 *
 * The estimate is the later of two independent bounds:
 *  - **capacity** — total sends owed across all active campaigns divided by
 *    the daily ceiling of every eligible account. Capacity is global (step-1
 *    account assignment ignores which campaign an enrollment belongs to), so
 *    a second running campaign genuinely pushes this one's finish date out.
 *  - **schedule** — the wait days still baked into the sequence. Even with
 *    unlimited capacity a 3+4-day follow-up sequence cannot finish sooner
 *    than 7 days after its last first-touch goes out.
 *
 * It assumes caps, accounts, and the window stay as they are, and it will
 * drift early as replies and bounces cancel remaining steps.
 */
export async function getCampaignProgress(
  campaignId: number,
): Promise<CampaignProgress> {
  let [setting] = await db.select().from(appSetting).limit(1);
  if (!setting) [setting] = await db.insert(appSetting).values({}).returning();
  const tz = setting.sendingTimezone;
  const startMin = timeToMinutes(setting.sendingWindowStart);
  const endMin = timeToMinutes(setting.sendingWindowEnd);
  const nowMin = zoneMinutes(tz);
  const open = nowMin >= startMin && nowMin < endMin;
  const minutesRemaining = open ? endMin - nowMin : 0;
  const windowMinutes = Math.max(endMin - startMin, 0);
  const ticksPerDay = Math.floor(windowMinutes / TICK_MINUTES);
  const ticksLeftToday = Math.floor(minutesRemaining / TICK_MINUTES);

  const today = sql`(now() at time zone ${tz})::date`;

  const [campRow] = (await db.execute(sql`
    select c.status,
      (select count(*) from sequence_step s where s.campaign_id = c.id) as step_count,
      (select coalesce(sum(s.wait_days_after_previous), 0) from sequence_step s
        where s.campaign_id = c.id and s.step_number >= 2) as full_sequence_days
    from campaign c where c.id = ${campaignId}
  `)) as Row[];

  const stepCount = n(campRow?.step_count);
  const fullSequenceDays = n(campRow?.full_sequence_days);

  const [counts] = (await db.execute(sql`
    select
      count(*) filter (where e.status = 'active') as active,
      count(*) filter (where e.status = 'active' and e.current_step = 0) as not_started,
      count(*) filter (where e.status = 'active' and e.next_send_at <= now()) as due_now,
      count(*) filter (where e.status = 'ooo_paused') as ooo_paused,
      coalesce(sum(greatest(${stepCount} - e.current_step, 0))
        filter (where e.status = 'active'), 0) as remaining
    from enrollment e where e.campaign_id = ${campaignId}
  `)) as Row[];

  const [sentRow] = (await db.execute(sql`
    select count(*) as sent,
      count(*) filter (where (m.sent_at at time zone ${tz})::date = ${today}) as sent_today
    from message m
    join enrollment e on e.id = m.enrollment_id
    where e.campaign_id = ${campaignId} and m.kind = 'sent'
  `)) as Row[];

  // Capacity is a property of the account pool, not of this campaign.
  const accountRows = (await db.execute(sql`
    select a.daily_cap,
      coalesce((select count(*) from message m
        where m.account_id = a.id and m.kind = 'sent'
          and (m.sent_at at time zone ${tz})::date = ${today}), 0) as sent_today
    from sending_account a
    where a.active and a.google_refresh_token is not null and not a.needs_reconnect
  `)) as Row[];

  const eligibleAccounts = accountRows.length;
  let capacityPerDay = 0;
  let capacityLeftToday = 0;
  for (const a of accountRows) {
    const cap = n(a.daily_cap);
    capacityPerDay += ticksPerDay > 0 ? Math.min(cap, ticksPerDay) : cap;
    capacityLeftToday += Math.max(
      0,
      Math.min(cap - n(a.sent_today), ticksLeftToday),
    );
  }

  // Everything the shared pool still owes, across active campaigns.
  const [global] = (await db.execute(sql`
    select count(distinct c.id) as active_campaigns,
      coalesce(sum(greatest(sc.n - e.current_step, 0)), 0) as global_remaining,
      count(*) filter (where e.current_step = 0) as global_not_started
    from enrollment e
    join campaign c on c.id = e.campaign_id and c.status = 'active'
    join (select campaign_id, count(*) as n from sequence_step group by campaign_id) sc
      on sc.campaign_id = e.campaign_id
    where e.status = 'active'
  `)) as Row[];

  // Longest sequence tail already in flight: time until this enrollment's
  // next send, plus the wait days of every step after that one.
  const [inFlight] = (await db.execute(sql`
    select coalesce(max(
      greatest(extract(epoch from (e.next_send_at - now())) / 86400, 0) + w.wait_after
    ), 0) as days
    from enrollment e
    join lateral (
      select coalesce(sum(s.wait_days_after_previous), 0) as wait_after
      from sequence_step s
      where s.campaign_id = e.campaign_id and s.step_number >= e.current_step + 2
    ) w on true
    where e.campaign_id = ${campaignId} and e.status = 'active' and e.current_step >= 1
  `)) as Row[];

  const remaining = n(counts?.remaining);
  const sent = n(sentRow?.sent);
  const notStarted = n(counts?.not_started);
  const globalRemaining = n(global?.global_remaining);
  const globalNotStarted = n(global?.global_not_started);

  let blockedReason: string | null = null;
  if (remaining === 0) blockedReason = null;
  else if (stepCount === 0) blockedReason = "This campaign has no steps yet.";
  else if (campRow?.status !== "active")
    blockedReason = `Campaign is ${String(campRow?.status ?? "unknown")} — the scheduler skips it.`;
  else if (eligibleAccounts === 0)
    blockedReason =
      "No active Google-connected account — nothing can send until one is reconnected.";
  else if (capacityPerDay === 0)
    blockedReason = "Every eligible account has a daily cap of 0.";

  let etaDays: number | null = null;
  if (remaining > 0 && blockedReason === null && capacityPerDay > 0) {
    const capacityDays = Math.ceil(globalRemaining / capacityPerDay);
    // The last contact to receive a first touch still owes the full follow-up
    // sequence after that, so a step-1 backlog stretches the tail.
    const step1Days = Math.ceil(globalNotStarted / capacityPerDay);
    const tailDays = notStarted > 0 ? step1Days + fullSequenceDays : 0;
    etaDays = Math.max(capacityDays, tailDays, Math.ceil(n(inFlight?.days)));
  }

  const etaDate =
    etaDays === null
      ? null
      : new Date(Date.now() + etaDays * 86_400_000).toISOString();

  const total = sent + remaining;

  return {
    campaignStatus: String(campRow?.status ?? "unknown"),
    stepCount,
    sent,
    sentToday: n(sentRow?.sent_today),
    remaining,
    notStarted,
    dueNow: n(counts?.due_now),
    oooPaused: n(counts?.ooo_paused),
    percentComplete: total === 0 ? 0 : Math.round((sent / total) * 100),
    capacityPerDay,
    capacityLeftToday,
    eligibleAccounts,
    activeCampaigns: n(global?.active_campaigns),
    globalRemaining,
    etaDays,
    etaDate,
    window: {
      start: setting.sendingWindowStart,
      end: setting.sendingWindowEnd,
      timezone: tz,
      open,
      minutesRemaining,
    },
    blockedReason,
  };
}
