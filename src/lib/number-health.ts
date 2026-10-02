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
  /** Calls in the last 7 days that counted (wrong numbers left out). */
  calls: number;
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

  const out: Record<string, NumberHealth> = {};
  for (const r of rows) {
    const reach =
      r.calls >= HEALTH_MIN_CALLS ? Math.round((100 * r.reached) / r.calls) : null;
    const reachBefore =
      r.calls_before >= HEALTH_MIN_CALLS
        ? Math.round((100 * r.reached_before) / r.calls_before)
        : null;
    out[r.num] = {
      status: judge(r.calls, reach, reachBefore),
      calls: r.calls,
      reach,
      reachBefore,
      perDay: Math.round(r.calls / 7),
      inUseSince: r.first_at ? new Date(r.first_at).toISOString() : null,
    };
  }
  return out;
}
