import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PICKUP } from "@/lib/call-stats";

/**
 * How likely each of our numbers is to be flagged as spam (2026-10-03).
 *
 * Carriers label a number "Spam Likely" and nothing in the CRM or Telnyx
 * exposes that label, so this reads the symptom instead: calls from a flagged
 * number stop reaching anybody. **Reach** is the share of calls that got to a
 * person or to a voicemail, out of every call that was a real attempt:
 * `(pickups + voicemails) / (calls - bad numbers)`. A wrong number says
 * nothing about the line it was dialled from, so it is left out.
 *
 * It is reach and not pickup rate on purpose. On 2026-10-03 the two numbers
 * that looked worst had pickup rates of 31 to 34%, the same as healthy ones,
 * while their voicemails had collapsed (141 to 3 in a week) and their no
 * answers had doubled: a flagged call rings out or is declined and never
 * reaches a mailbox. The healthy numbers reached 90% or more.
 *
 * What it cannot see: the outcomes are logged by hand, and list quality and the
 * hour of day move them too. It is a warning to look at a number, not proof.
 *
 * The number a call came from is `call.dialled_from`, and for older calls with
 * none, its caller's current number, which is right until that number is
 * swapped.
 */
export type NumberHealthStatus = "healthy" | "watch" | "flagged" | "few";

export type NumberHealth = {
  status: NumberHealthStatus;
  /** Calls in the last 7 days that counted toward the verdict: ones logged
   *  with an outcome (wrong numbers left out). */
  calls: number;
  /** Every call placed from this number in the last 7 days, however it was
   *  made: logged leads, Keypad dials, and recorded demos and follow-ups. A
   *  founder's number does most of its work outside the logged calls. */
  total: number;
  /** 0 to 100, or null with too few calls to say. */
  reach: number | null;
  /** The 7 days before that, when there were enough calls to compare. */
  reachBefore: number | null;
  /** Share (0 to 100) of timed calls that ended within 8 seconds with no
   *  answer. The strongest sign: a normal unanswered call rings for 20 seconds
   *  or more, and one the carrier refuses is gone in a few. Null with too few. */
  fastFail: number | null;
  fastFailBefore: number | null;
  /** Share (0 to 100) of its recorded calls that were followed within 3
   *  minutes by another call to the same business from the same number: the
   *  "I have to call three times before they pick up" a flagged number causes.
   *  Null with too few recorded calls. */
  redial: number | null;
  /** Share (0 to 100) of this week's calls Telnyx reported as refused
   *  (`call_rejected`), once there are 100 of them on record. Null before then. */
  refused: number | null;
  perDay: number;
  /** Of `perDay`, how many a day are cold dials (a logged call from a list).
   *  The rest are meeting and follow-up calls and Keypad dials, which are few
   *  and long, so a count that lumps them in reads far too busy. */
  coldPerDay: number;
  /** The last 24 hours against the 7 days before them (2026-10-03), so a
   *  number that falls off a cliff is seen in a day and not at the end of the
   *  week. Null with too few calls on either side. */
  daily: DailyReach | null;
  /** When a call was first placed from this number. */
  inUseSince: string | null;
  /** Set when a founder started the check over: calls from before this are
   *  ignored everywhere in this file. Null when nothing has been reset. */
  resetAt: string | null;
  /** How long its recorded calls last, when there are enough to say. The
   *  second signal, for a number whose calls mostly carry no logged outcome. */
  lengths: CallLengths | null;
  /** What the status was worked out from. */
  basis: "outcomes" | "lengths" | null;
  /** The cutoffs this was judged by, so the words on the page cannot drift
   *  from the rules (the page cannot import this file's constants: it reaches
   *  the database). */
  limits: { minCalls: number; healthyAt: number; fastWatch: number; dropPoints: number; longOk: number; redialWatch: number; dailyFallWatch: number };
};

export type DailyReach = {
  /** Reach (0 to 100) over the last 24 hours. */
  today: number;
  /** Reach over the 7 days before that. */
  usual: number;
  todayCalls: number;
  /** How far today sits under the usual, as a share of the usual (0 to 100,
   *  0 when it is at or above it). 25 means a quarter of the connections lost. */
  fellPct: number;
};

/** The advice this follows: when the connect rate drops by 20 to 30% with the
 *  lists unchanged, retire the number. 25 is the middle of that, and 20 is
 *  where the panel starts saying so. */
export const DAILY_FALL_WATCH_PCT = 20;
export const DAILY_FALL_ALERT_PCT = 25;
/** Calls today and in the usual week before a fall means anything: ten calls
 *  swing 30% on luck alone. */
export const DAILY_MIN_TODAY = 25;
export const DAILY_MIN_USUAL = 60;

export type CallLengths = {
  /** Recorded calls in the last 7 days. */
  n: number;
  /** Share (0 to 100) that ran 30 seconds or more: a real conversation. */
  longPct: number;
  /** Share that ended within 10 seconds: picked up and dropped. */
  shortPct: number;
  medianSec: number;
  /** The week before, when there were enough to compare. */
  longPctBefore: number | null;
};

/** Recorded calls needed in a week before their lengths say anything. */
export const LENGTH_MIN_CALLS = 30;
/** Healthy numbers had 53 to 58% of their recorded calls pass 30 seconds, the
 *  worst had 32 to 34% (2026-10-03). Below this is worth a look. */
export const LONG_OK_PCT = 45;
/** A fall this big in the share of long calls, week on week. */
export const LONG_DROP_POINTS = 15;
/** Calibrated on a number known to be flagged (2026-10-03): a client's
 *  screenshot showed "Potential Spam" on the founders' number, whose recorded
 *  calls ran 33% past 30 seconds with 43% ended within 10. Both at once is
 *  flagged; Alex's healthy number was 39% and 37%. One known case, so treat the
 *  edges as soft. */
export const LONG_FLAG_PCT = 40;
export const SHORT_FLAG_PCT = 35;

/**
 * **Every cutoff in this file leans toward flagging** (2026-10-03, the founders:
 * "slightly over sensitive to flagging spam over it having false negatives").
 * A burned number costs a week of calls that nobody picks up; a false alarm
 * costs one look. Healthy numbers measured that day sat well inside these
 * (reach 90%+, fast drops 0 to 4%, 53 to 58% of recorded calls past 30
 * seconds), so the margin is spent on catching more, not on the healthy ones.
 */
/** Below this many calls in a week there is no verdict, only a count. */
export const HEALTH_MIN_CALLS = 60;
export const HEALTHY_AT = 75;
export const WATCH_AT = 50;
/** A fall this big from the week before is worth a look even when the number
 *  is still above the line. */
export const DROP_POINTS = 10;
/** A call that ends this fast with no answer was refused, not rung out. */
export const FAST_FAIL_SECONDS = 8;
/** Measured on prod 2026-10-03: the two numbers that looked flagged had 35 and
 *  41% of their calls end in under 8 seconds, healthy ones had 0 to 4%. */
export const FAST_WATCH_PCT = 5;
export const FAST_FLAG_PCT = 15;
/** Measured on prod 2026-10-03 over 7 days: the founders' number, confirmed
 *  flagged by a client's screenshot, had 24% of its calls redialled within three
 *  minutes ("I need to call them 3 times in a row for them to pick up"); every
 *  other number was 1 to 13%. One known case, so the edges are soft, and it
 *  leans toward flagging like the rest. */
export const REDIAL_WATCH_PCT = 15;
export const REDIAL_FLAG_PCT = 20;
/** Recorded calls needed in a week before the redial share counts. */
export const REDIAL_MIN_CALLS = 60;
/** Hangup records needed in a week before the refused share counts. */
export const HANGUP_MIN = 60;

/**
 * The verdict. The strong signal is how many calls end the moment they are
 * placed (fast drops, and calls Telnyx says were refused): that is what a
 * carrier does to a flagged number. Reach is the supporting one, because a low
 * reach alone also describes a bad list or a bad hour. A number that rings out
 * in full and is simply not answered is therefore "keep an eye on it", never
 * "probably flagged".
 */
export function judge(args: {
  calls: number;
  reach: number | null;
  reachBefore: number | null;
  fastFail: number | null;
  fastFailBefore: number | null;
  refused: number | null;
}): NumberHealthStatus {
  const { calls, reach, reachBefore, fastFail, fastFailBefore, refused } = args;
  const enough = calls >= HEALTH_MIN_CALLS && reach !== null;
  if (!enough && refused === null) return "few";
  const strong = Math.max(fastFail ?? 0, refused ?? 0);
  if (strong >= FAST_FLAG_PCT) return "flagged";
  // Reach under the watch line is flagged on its own now, even if the calls
  // ring out in full: leaning toward flagging means a bad list gets looked at
  // too, which is a fair price.
  if (reach !== null && reach < WATCH_AT) return "flagged";
  if (strong >= FAST_WATCH_PCT && reach !== null && reach < HEALTHY_AT) return "flagged";
  if (strong >= FAST_WATCH_PCT) return "watch";
  if (reach !== null && reach < HEALTHY_AT) return "watch";
  if (reach !== null && reachBefore !== null && reachBefore - reach >= DROP_POINTS)
    return "watch";
  if (
    fastFail !== null &&
    fastFailBefore !== null &&
    fastFail - fastFailBefore >= DROP_POINTS
  )
    return "watch";
  return "healthy";
}

async function getDailyReach(): Promise<Map<string, DailyReach>> {
  const rows = (await db.execute(sql`
    select coalesce(c.dialled_from, u.telnyx_did) as num,
      count(*) filter (where c.called_at > now() - interval '24 hours')::int as t_calls,
      count(*) filter (where c.called_at > now() - interval '24 hours'
        and (c.outcome in ${PICKUP} or c.outcome = 'voicemail'))::int as t_reached,
      count(*) filter (where c.called_at <= now() - interval '24 hours')::int as u_calls,
      count(*) filter (where c.called_at <= now() - interval '24 hours'
        and (c.outcome in ${PICKUP} or c.outcome = 'voicemail'))::int as u_reached
    from "call" c
    join app_user u on u.id = c.user_id
    left join call_number rn on rn.phone_number = coalesce(c.dialled_from, u.telnyx_did)
    where c.called_at > now() - interval '8 days'
      and c.outcome <> 'bad_number'
      and coalesce(c.dialled_from, u.telnyx_did) is not null
      and (rn.health_reset_at is null or c.called_at >= rn.health_reset_at)
    group by 1
  `)) as { num: string; t_calls: number; t_reached: number; u_calls: number; u_reached: number }[];
  const out = new Map<string, DailyReach>();
  for (const r of rows) {
    if (r.t_calls < DAILY_MIN_TODAY || r.u_calls < DAILY_MIN_USUAL) continue;
    const today = Math.round((r.t_reached / r.t_calls) * 100);
    const usual = Math.round((r.u_reached / r.u_calls) * 100);
    const fellPct = usual > 0 ? Math.max(0, Math.round(((usual - today) / usual) * 100)) : 0;
    out.set(r.num, { today, usual, todayCalls: r.t_calls, fellPct });
  }
  return out;
}

export async function getNumberHealth(): Promise<Record<string, NumberHealth>> {
  const daily = await getDailyReach();
  const rows = (await db.execute(sql`
    with c as (
      select coalesce(c.dialled_from, u.telnyx_did) as num,
        c.called_at, c.outcome::text as outcome, c.duration_seconds as secs
      from "call" c
      join app_user u on u.id = c.user_id
      left join call_number rn on rn.phone_number = coalesce(c.dialled_from, u.telnyx_did)
      where coalesce(c.dialled_from, u.telnyx_did) is not null
        and (rn.health_reset_at is null or c.called_at >= rn.health_reset_at)
    )
    select num,
      count(*) filter (where called_at > now() - interval '7 days'
        and outcome <> 'bad_number')::int as calls,
      count(*) filter (where called_at > now() - interval '7 days'
        and (outcome in ${PICKUP} or outcome = 'voicemail'))::int as reached,
      count(*) filter (where called_at <= now() - interval '7 days'
        and called_at > now() - interval '14 days'
        and outcome <> 'bad_number')::int as calls_before,
      count(*) filter (where called_at <= now() - interval '7 days'
        and called_at > now() - interval '14 days'
        and (outcome in ${PICKUP} or outcome = 'voicemail'))::int as reached_before,
      count(*) filter (where called_at > now() - interval '7 days'
        and outcome <> 'bad_number' and secs is not null)::int as timed,
      count(*) filter (where called_at > now() - interval '7 days'
        and outcome = 'no_answer' and secs < ${FAST_FAIL_SECONDS})::int as fast,
      count(*) filter (where called_at <= now() - interval '7 days'
        and called_at > now() - interval '14 days'
        and outcome <> 'bad_number' and secs is not null)::int as timed_before,
      count(*) filter (where called_at <= now() - interval '7 days'
        and called_at > now() - interval '14 days'
        and outcome = 'no_answer' and secs < ${FAST_FAIL_SECONDS})::int as fast_before,
      min(called_at) as first_at
    from c group by num
  `)) as {
    num: string;
    calls: number;
    reached: number;
    calls_before: number;
    reached_before: number;
    timed: number;
    fast: number;
    timed_before: number;
    fast_before: number;
    first_at: string | null;
  }[];

  // Why calls ended, as Telnyx reports it (call_hangup, from 2026-10-03). The
  // table only fills from the day it was added, so it says nothing for the
  // first days and takes over from the fast-drop estimate as it grows.
  const hangups = (await db.execute(sql`
    select h.from_number as num,
      count(*)::int as n,
      count(*) filter (where h.hangup_cause = 'call_rejected')::int as refused
    from call_hangup h
    left join call_number rn on rn.phone_number = h.from_number
    where h.created_at > now() - interval '7 days'
      and (rn.health_reset_at is null or h.created_at >= rn.health_reset_at)
    group by 1
  `)) as { num: string; n: number; refused: number }[];
  const hangupOf = new Map(hangups.map((h) => [h.num, h]));

  // Every call from each number, whichever way it was made (2026-10-03). The
  // verdict above can only use calls that carry an outcome, but the volume and
  // the age are facts about the number and have to count the demos, follow-ups
  // and Keypad dials too: the founders' number showed "2 calls a day" while it
  // placed about 170 in a week. One call is counted once, by its Telnyx
  // session where it has one.
  const volume = (await db.execute(sql`
    with t as (
      select coalesce(c.dialled_from, u.telnyx_did) as num,
        coalesce(c.telnyx_session_id, 'call:' || c.id) as k, c.called_at as at,
        'cold' as kind
      from "call" c join app_user u on u.id = c.user_id
      left join call_number rn on rn.phone_number = coalesce(c.dialled_from, u.telnyx_did)
      where coalesce(c.dialled_from, u.telnyx_did) is not null
        and (rn.health_reset_at is null or c.called_at >= rn.health_reset_at)
      union all
      select k.from_did, coalesce(k.telnyx_session_id, 'keypad:' || k.id), k.called_at,
        'other'
      from keypad_call k
      left join call_number rn on rn.phone_number = k.from_did
      where k.from_did is not null
        and (rn.health_reset_at is null or k.called_at >= rn.health_reset_at)
      union all
      select cr.from_number, cr.call_session_id, cr.started_at, 'other'
      from call_recording cr
      left join call_number rn on rn.phone_number = cr.from_number
      where cr.from_number is not null and cr.started_at is not null
        and (rn.health_reset_at is null or cr.started_at >= rn.health_reset_at)
    ),
    -- A call is cold if any source says so: the same session also appears as a
    -- logged cold call, so it must not be counted again as a meeting call.
    u as (
      select num, k, min(at) as at,
        bool_or(kind = 'cold') as cold
      from t group by num, k
    )
    select num,
      count(*) filter (where at > now() - interval '7 days')::int as total,
      count(*) filter (where at > now() - interval '7 days' and cold)::int as cold_n,
      min(at) as first_at
    from u group by num
  `)) as { num: string; total: number; cold_n: number; first_at: string | null }[];
  const vol = new Map(volume.map((v) => [v.num, v]));
  // A number that has been reset and not dialled from since has no calls to
  // group, so it would vanish from the panel with its undo button. Give it an
  // empty row: it reads "too few calls to tell", which is true.
  const resets = (await db.execute(sql`
    select phone_number as num, health_reset_at as at
    from call_number where health_reset_at is not null
  `)) as { num: string; at: string }[];
  const resetOf = new Map(resets.map((r) => [r.num, new Date(r.at).toISOString()]));
  for (const r of resets) {
    if (!volume.some((v) => v.num === r.num)) {
      volume.push({ num: r.num, total: 0, cold_n: 0, first_at: null });
    }
  }
  for (const v of volume) {
    if (!rows.some((r) => r.num === v.num)) {
      rows.push({
        num: v.num,
        calls: 0,
        reached: 0,
        calls_before: 0,
        reached_before: 0,
        timed: 0,
        fast: 0,
        timed_before: 0,
        fast_before: 0,
        first_at: v.first_at,
      });
    }
  }

  // How long its recorded calls last (2026-10-03). A call picked up by a
  // person who sees "Spam Likely" ends in seconds, so a number whose calls
  // suddenly get shorter is suspect even when nobody logged an outcome on
  // them, which is how the founders' number is used. Weaker evidence than
  // reach, and it is not calibrated against a known-burned number: Omar's
  // healthy number had 27% of calls under ten seconds. So it can raise a
  // "keep an eye on it" and never "probably flagged", and it decides only
  // where there are too few logged outcomes to use reach.
  const lenRows = (await db.execute(sql`
    select cr.from_number as num,
      count(*) filter (where cr.started_at > now() - interval '7 days')::int as n,
      count(*) filter (where cr.started_at > now() - interval '7 days'
        and cr.duration_ms >= 30000)::int as long_n,
      count(*) filter (where cr.started_at > now() - interval '7 days'
        and cr.duration_ms < 10000)::int as short_n,
      count(*) filter (where cr.started_at <= now() - interval '7 days'
        and cr.started_at > now() - interval '14 days')::int as n_before,
      count(*) filter (where cr.started_at <= now() - interval '7 days'
        and cr.started_at > now() - interval '14 days'
        and cr.duration_ms >= 30000)::int as long_before,
      coalesce((percentile_cont(0.5) within group (order by cr.duration_ms)
        filter (where cr.started_at > now() - interval '7 days'))::int, 0) as med_ms
    from call_recording cr
    left join call_number rn on rn.phone_number = cr.from_number
    where cr.from_number is not null and cr.duration_ms is not null
      and cr.started_at > now() - interval '14 days'
      and (rn.health_reset_at is null or cr.started_at >= rn.health_reset_at)
    group by 1
  `)) as {
    num: string;
    n: number;
    long_n: number;
    short_n: number;
    n_before: number;
    long_before: number;
    med_ms: number;
  }[];
  // Redials: a call followed within three minutes by another to the same
  // business from the same number.
  const redialRows = (await db.execute(sql`
    with r as (
      select cr.from_number, cr.to_number, cr.started_at from call_recording cr
      left join call_number rn on rn.phone_number = cr.from_number
      where cr.from_number is not null and cr.to_number is not null
        and cr.started_at > now() - interval '7 days'
        and (rn.health_reset_at is null or cr.started_at >= rn.health_reset_at)
    )
    select from_number as num,
      count(*)::int as n,
      count(*) filter (where exists (
        select 1 from r r2
        where r2.from_number = r.from_number and r2.to_number = r.to_number
          and r2.started_at > r.started_at
          and r2.started_at <= r.started_at + interval '3 minutes'
      ))::int as redialed
    from r group by 1
  `)) as { num: string; n: number; redialed: number }[];
  const redialOf = new Map(
    redialRows
      .filter((x) => x.n >= REDIAL_MIN_CALLS)
      .map((x) => [x.num, Math.round((100 * x.redialed) / x.n)]),
  );

  const lengthsOf = new Map<string, CallLengths>();
  for (const l of lenRows) {
    if (l.n < LENGTH_MIN_CALLS) continue;
    lengthsOf.set(l.num, {
      n: l.n,
      longPct: Math.round((100 * l.long_n) / l.n),
      shortPct: Math.round((100 * l.short_n) / l.n),
      medianSec: Math.round(l.med_ms / 1000),
      longPctBefore:
        l.n_before >= LENGTH_MIN_CALLS
          ? Math.round((100 * l.long_before) / l.n_before)
          : null,
    });
  }

  const out: Record<string, NumberHealth> = {};
  for (const r of rows) {
    const v = vol.get(r.num);
    const lengths = lengthsOf.get(r.num) ?? null;
    const reach =
      r.calls >= HEALTH_MIN_CALLS ? Math.round((100 * r.reached) / r.calls) : null;
    const reachBefore =
      r.calls_before >= HEALTH_MIN_CALLS
        ? Math.round((100 * r.reached_before) / r.calls_before)
        : null;
    const pct = (a: number, b: number) => Math.round((100 * a) / b);
    const fastFail = r.timed >= HEALTH_MIN_CALLS ? pct(r.fast, r.timed) : null;
    const fastFailBefore =
      r.timed_before >= HEALTH_MIN_CALLS ? pct(r.fast_before, r.timed_before) : null;
    const hang = hangupOf.get(r.num);
    const refused = hang && hang.n >= HANGUP_MIN ? pct(hang.refused, hang.n) : null;
    const byOutcomes = judge({
      calls: r.calls,
      reach,
      reachBefore,
      fastFail,
      fastFailBefore,
      refused,
    });
    // Too few logged outcomes to use reach: fall back to call lengths, which
    // can only ever say "healthy" or "keep an eye on it".
    let status = byOutcomes;
    let basis: NumberHealth["basis"] = byOutcomes === "few" ? null : "outcomes";
    if (byOutcomes === "few" && lengths) {
      const dropped =
        lengths.longPctBefore !== null &&
        lengths.longPctBefore - lengths.longPct >= LONG_DROP_POINTS;
      status =
        lengths.longPct < LONG_FLAG_PCT && lengths.shortPct >= SHORT_FLAG_PCT
          ? "flagged"
          : lengths.longPct < LONG_OK_PCT || dropped
            ? "watch"
            : "healthy";
      basis = "lengths";
    }
    // Redials only ever raise the verdict. A number people have to ring three
    // times is a number people are not picking up, whatever else it says.
    const redial = redialOf.get(r.num) ?? null;
    if (redial !== null) {
      if (redial >= REDIAL_FLAG_PCT) status = "flagged";
      else if (redial >= REDIAL_WATCH_PCT && (status === "healthy" || status === "few"))
        status = "watch";
    }
    out[r.num] = {
      status,
      redial,
      lengths,
      basis,
      limits: {
        minCalls: HEALTH_MIN_CALLS,
        healthyAt: HEALTHY_AT,
        fastWatch: FAST_WATCH_PCT,
        dropPoints: DROP_POINTS,
        longOk: LONG_OK_PCT,
        redialWatch: REDIAL_WATCH_PCT,
        dailyFallWatch: DAILY_FALL_WATCH_PCT,
      },
      calls: r.calls,
      total: Math.max(v?.total ?? 0, r.calls),
      reach,
      reachBefore,
      fastFail,
      fastFailBefore,
      refused,
      perDay: Math.round(Math.max(v?.total ?? 0, r.calls) / 7),
      coldPerDay: Math.round((v?.cold_n ?? 0) / 7),
      daily: daily.get(r.num) ?? null,
      resetAt: resetOf.get(r.num) ?? null,
      inUseSince: (() => {
        const first = [r.first_at, v?.first_at]
          .filter((x): x is string => !!x)
          .map((x) => new Date(x).getTime());
        return first.length ? new Date(Math.min(...first)).toISOString() : null;
      })(),
    };
  }
  return out;
}
