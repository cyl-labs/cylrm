import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";

/** The scheduler ticks every 5 minutes and sends at most one email per
 * account per tick (see the pacing rule in `scheduler.ts`), so an account's
 * real ceiling is the lower of its daily cap and the number of ticks left in
 * the sending window. */
export const TICK_MINUTES = 5;

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
  /** OOO-paused enrollments. Counted in `remaining` — the scheduler resumes
   * them once their 7 days elapse, so the steps they owe are deferred work,
   * not cancelled work. */
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
    /** Needed by the live clock to work out when the window next opens. */
    weekdaysOnly: boolean;
  };
  /** Set when nothing can send at all; the ETA is null in that case. */
  blockedReason: string | null;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** Why a non-active campaign sends nothing. Shared so the demo twin and the
 *  real query can't drift apart in wording. */
export function notActiveReason(status: string): string {
  const described = status === "draft" ? "still a draft" : status;
  return `This campaign is ${described} — the scheduler skips it, so nothing will send.`;
}

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function zoneNow(tz: string): {
  minutes: number;
  isWeekend: boolean;
  weekdayIndex: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return {
    minutes: (get("hour") % 24) * 60 + get("minute"),
    isWeekend: weekday === "Sat" || weekday === "Sun",
    weekdayIndex: WEEKDAY_INDEX[weekday] ?? 0,
  };
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
  const { minutes: nowMin, isWeekend, weekdayIndex } = zoneNow(tz);
  const open =
    !(setting.sendWeekdaysOnly && isWeekend) &&
    nowMin >= startMin &&
    nowMin < endMin;
  const minutesRemaining = open ? endMin - nowMin : 0;
  const windowMinutes = Math.max(endMin - startMin, 0);
  const ticksPerDay = Math.floor(windowMinutes / TICK_MINUTES);
  const ticksLeftToday = Math.floor(minutesRemaining / TICK_MINUTES);

  const today = sql`(now() at time zone ${tz})::date`;

  const [campRow] = (await db.execute(sql`
    select c.status,
      (select count(distinct s.step_number) from sequence_step s where s.campaign_id = c.id) as step_count
    from campaign c where c.id = ${campaignId}
  `)) as Row[];

  const stepCount = n(campRow?.step_count);

  // Out-of-office pauses resume once their 7 days elapse, so the steps they
  // still owe are real work the estimate has to include — they are simply
  // deferred, not cancelled.
  const inPlay = sql`e.status in ('active', 'ooo_paused')`;
  const [counts] = (await db.execute(sql`
    select
      count(*) filter (where ${inPlay}) as active,
      count(*) filter (where ${inPlay} and e.current_step = 0) as not_started,
      count(*) filter (where e.status = 'active' and e.next_send_at <= now()) as due_now,
      count(*) filter (where e.status = 'ooo_paused') as ooo_paused,
      coalesce(sum(greatest(${stepCount} - e.current_step, 0))
        filter (where ${inPlay}), 0) as remaining
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
      coalesce(sum(greatest(sc.n - e.current_step, 0)), 0) as global_remaining
    from enrollment e
    join campaign c on c.id = e.campaign_id and c.status = 'active'
    join (select campaign_id, count(distinct step_number) as n from sequence_step group by campaign_id) sc
      on sc.campaign_id = e.campaign_id
    where ${inPlay}
  `)) as Row[];

  // Longest sequence tail already in flight: time until this enrollment's
  // next send, plus the wait days of every step after that one.
  // Inputs for the finish simulation: how much work each cohort still owes
  // and when its next send falls due.
  const backlog = (await db.execute(sql`
    select
      greatest(0, ceil(extract(epoch from (e.next_send_at - now())) / 86400))::int as days_until,
      greatest(${stepCount} - e.current_step, 0) as steps_left,
      count(*)::int as n
    from enrollment e
    where e.campaign_id = ${campaignId} and ${inPlay}
      and greatest(${stepCount} - e.current_step, 0) > 0
    group by 1, 2
  `)) as Row[];

  const waitRows = (await db.execute(sql`
    select step_number, wait_days_after_previous
    from sequence_step
    where campaign_id = ${campaignId} and variant = 'a'
    order by step_number
  `)) as Row[];
  const waitBeforeStep = new Map<number, number>(
    waitRows.map((r) => [n(r.step_number), n(r.wait_days_after_previous)]),
  );

  const remaining = n(counts?.remaining);
  const sent = n(sentRow?.sent);
  const notStarted = n(counts?.not_started);
  const globalRemaining = n(global?.global_remaining);

  let blockedReason: string | null = null;
  if (remaining === 0) blockedReason = null;
  else if (stepCount === 0) blockedReason = "This campaign has no steps yet.";
  else if (campRow?.status !== "active")
    blockedReason = notActiveReason(String(campRow?.status ?? "unknown"));
  else if (eligibleAccounts === 0)
    blockedReason =
      "No active Google-connected account — nothing can send until one is reconnected.";
  else if (capacityPerDay === 0)
    blockedReason = "Every eligible account has a daily cap of 0.";

  /**
   * Walk the queue forward a day at a time instead of dividing total work by
   * daily capacity.
   *
   * Division assumes capacity is always usable, but a sequence stalls itself:
   * once the first touches are out, nothing is due until their wait days
   * elapse, so whole days pass sending nothing. On a 1,300-contact two-step
   * campaign that gap made the old estimate about four days early.
   */
  let etaDays: number | null = null;
  if (remaining > 0 && blockedReason === null && capacityPerDay > 0) {
    // The pool is shared, so this campaign only gets its share of a day.
    const share =
      globalRemaining > 0 ? Math.min(1, remaining / globalRemaining) : 1;
    const perDay = Math.max(1, Math.floor(capacityPerDay * share));

    type Cohort = { due: number; stepsLeft: number; count: number };
    const cohorts: Cohort[] = backlog.map((r) => ({
      due: n(r.days_until),
      stepsLeft: n(r.steps_left),
      count: n(r.n),
    }));

    // Judged in the sending timezone, not the server's — a campaign on New
    // York hours read from a UTC box on a Sunday evening would otherwise
    // shift the whole weekend pattern by a day.
    const todayIndex = weekdayIndex;
    const isSendingDay = (day: number) => {
      if (!setting.sendWeekdaysOnly) return true;
      const wd = (todayIndex + day) % 7;
      return wd !== 0 && wd !== 6;
    };

    const MAX_DAYS = 400;
    let day = 0;
    let outstanding = cohorts.reduce((acc, c) => acc + c.count * c.stepsLeft, 0);
    while (outstanding > 0 && day < MAX_DAYS) {
      if (isSendingDay(day)) {
        let budget = perDay;
        // Follow-ups first, matching the scheduler's ordering, then by due
        // date so the longest-waiting cohort goes next.
        const ready = cohorts
          .filter((c) => c.count > 0 && c.due <= day)
          .sort((a, b) =>
            a.stepsLeft === b.stepsLeft
              ? a.due - b.due
              : a.stepsLeft - b.stepsLeft,
          );
        for (const c of ready) {
          if (budget <= 0) break;
          const take = Math.min(c.count, budget);
          budget -= take;
          c.count -= take;
          outstanding -= take;
          const stepJustSent = stepCount - c.stepsLeft + 1;
          if (c.stepsLeft > 1) {
            const wait = waitBeforeStep.get(stepJustSent + 1) ?? 0;
            cohorts.push({
              due: day + wait,
              stepsLeft: c.stepsLeft - 1,
              count: take,
            });
          }
        }
      }
      if (outstanding > 0) day++;
    }
    etaDays = outstanding > 0 ? null : day;
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
      weekdaysOnly: setting.sendWeekdaysOnly,
    },
    blockedReason,
  };
}
