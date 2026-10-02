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
  perDay: number;
  /** When a call was first placed from this number. */
  inUseSince: string | null;
};

/** Below this many calls in a week there is no verdict, only a count. */
export const HEALTH_MIN_CALLS = 100;
export const HEALTHY_AT = 70;
export const WATCH_AT = 50;
/** A fall this big from the week before is worth a look even when the number
 *  is still above the line. */
export const DROP_POINTS = 15;

export function judge(
  calls: number,
  reach: number | null,
  reachBefore: number | null,
): NumberHealthStatus {
  if (calls < HEALTH_MIN_CALLS || reach === null) return "few";
  if (reach < WATCH_AT) return "flagged";
  if (reach < HEALTHY_AT) return "watch";
  if (reachBefore !== null && reachBefore - reach >= DROP_POINTS) return "watch";
  return "healthy";
}

export async function getNumberHealth(): Promise<Record<string, NumberHealth>> {
  const rows = (await db.execute(sql`
    with c as (
      select coalesce(c.dialled_from, u.telnyx_did) as num,
        c.called_at, c.outcome::text as outcome
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
      min(called_at) as first_at
    from c group by num
  `)) as {
    num: string;
    calls: number;
    reached: number;
    calls_before: number;
    reached_before: number;
    first_at: string | null;
  }[];

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
        first_at: v.first_at,
      });
    }
  }

  const out: Record<string, NumberHealth> = {};
  for (const r of rows) {
    const v = vol.get(r.num);
    const reach =
      r.calls >= HEALTH_MIN_CALLS ? Math.round((100 * r.reached) / r.calls) : null;
    const reachBefore =
      r.calls_before >= HEALTH_MIN_CALLS
        ? Math.round((100 * r.reached_before) / r.calls_before)
        : null;
    out[r.num] = {
      status: judge(r.calls, reach, reachBefore),
      calls: r.calls,
      total: Math.max(v?.total ?? 0, r.calls),
      reach,
      reachBefore,
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
