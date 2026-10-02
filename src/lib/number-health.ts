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
  /** Share (0 to 100) of this week's calls Telnyx reported as refused
   *  (`call_rejected`), once there are 100 of them on record. Null before then. */
  refused: number | null;
  perDay: number;
  /** When a call was first placed from this number. */
  inUseSince: string | null;
  /** How long its recorded calls last, when there are enough to say. The
   *  second signal, for a number whose calls mostly carry no logged outcome. */
  lengths: CallLengths | null;
  /** What the status was worked out from. */
  basis: "outcomes" | "lengths" | null;
};

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
export const LENGTH_MIN_CALLS = 50;
/** Healthy numbers had 53 to 58% of their recorded calls pass 30 seconds, the
 *  worst had 32 to 34% (2026-10-03). Below this is worth a look. */
export const LONG_OK_PCT = 40;
/** A fall this big in the share of long calls, week on week. */
export const LONG_DROP_POINTS = 20;
/** Calibrated on a number known to be flagged (2026-10-03): a client's
 *  screenshot showed "Potential Spam" on the founders' number, whose recorded
 *  calls ran 33% past 30 seconds with 43% ended within 10. Both at once is
 *  flagged; Alex's healthy number was 39% and 37%. One known case, so treat the
 *  edges as soft. */
export const LONG_FLAG_PCT = 35;
export const SHORT_FLAG_PCT = 40;

/** Below this many calls in a week there is no verdict, only a count. */
export const HEALTH_MIN_CALLS = 100;
export const HEALTHY_AT = 70;
export const WATCH_AT = 50;
/** A fall this big from the week before is worth a look even when the number
 *  is still above the line. */
export const DROP_POINTS = 15;
/** A call that ends this fast with no answer was refused, not rung out. */
export const FAST_FAIL_SECONDS = 8;
/** Measured on prod 2026-10-03: the two numbers that looked flagged had 35 and
 *  41% of their calls end in under 8 seconds, healthy ones had 0 to 4%. */
export const FAST_WATCH_PCT = 10;
export const FAST_FLAG_PCT = 25;
/** Hangup records needed in a week before the refused share counts. */
export const HANGUP_MIN = 100;

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
  if (strong >= FAST_WATCH_PCT && reach !== null && reach < WATCH_AT) return "flagged";
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

export async function getNumberHealth(): Promise<Record<string, NumberHealth>> {
  const rows = (await db.execute(sql`
    with c as (
      select coalesce(c.dialled_from, u.telnyx_did) as num,
        c.called_at, c.outcome::text as outcome, c.duration_seconds as secs
      from "call" c
      join app_user u on u.id = c.user_id
      where coalesce(c.dialled_from, u.telnyx_did) is not null
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
    select from_number as num,
      count(*) filter (where created_at > now() - interval '7 days')::int as n,
      count(*) filter (where created_at > now() - interval '7 days'
        and hangup_cause = 'call_rejected')::int as refused
    from call_hangup
    where created_at > now() - interval '7 days'
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
        coalesce(c.telnyx_session_id, 'call:' || c.id) as k, c.called_at as at
      from "call" c join app_user u on u.id = c.user_id
      where coalesce(c.dialled_from, u.telnyx_did) is not null
      union all
      select k.from_did, coalesce(k.telnyx_session_id, 'keypad:' || k.id), k.called_at
      from keypad_call k where k.from_did is not null
      union all
      select cr.from_number, cr.call_session_id, cr.started_at
      from call_recording cr
      where cr.from_number is not null and cr.started_at is not null
    )
    select num,
      count(distinct k) filter (where at > now() - interval '7 days')::int as total,
      min(at) as first_at
    from t group by num
  `)) as { num: string; total: number; first_at: string | null }[];
  const vol = new Map(volume.map((v) => [v.num, v]));
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
    where cr.from_number is not null and cr.duration_ms is not null
      and cr.started_at > now() - interval '14 days'
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
    out[r.num] = {
      status,
      lengths,
      basis,
      calls: r.calls,
      total: Math.max(v?.total ?? 0, r.calls),
      reach,
      reachBefore,
      fastFail,
      fastFailBefore,
      refused,
      perDay: Math.round(Math.max(v?.total ?? 0, r.calls) / 7),
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
