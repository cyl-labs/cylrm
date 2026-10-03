/**
 * What works, measured on our own calls (2026-10-03).
 *
 * Asked for after the mentor's "Gong Files" PDF, whose cold calling tips (call
 * 9 to 11 AM, stop after about five tries, voicemails lower later pickups) come
 * from software companies. The point is to answer the same questions with this
 * floor's calls instead of borrowing the answer.
 *
 * Three questions, each over the calls in the window:
 * - By the hour in the prospect's own day, does anyone pick up more often?
 * - Does the first try pick up more than the second, third, fifth?
 * - After a voicemail or a no answer, does the next call to that business fare
 *   differently?
 *
 * Counted the way Stats counts: a **pickup** is `PICKUP` (a person was spoken
 * to, a gatekeeper included), wrong numbers are left out of every denominator,
 * and only calls where a phone really rang count (`RANG`, see call-stats.ts:
 * outcomes saved while clearing a missed call are not dials). The hour is read
 * in the lead's own zone through `leadZone`, never the caller's; calls to a lead
 * with no zone (toll-free) are left out of the hour table only.
 *
 * Correlation, not proof: list quality and who was dialling move these too.
 * The screen says so.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PICKUP } from "@/lib/call-stats";
import { leadZone } from "@/lib/calls";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

/** A phone rang for this row; expects `app_user` joined as `u`. */
const RANG = sql`(c.telnyx_session_id is not null or u.dial_method is distinct from 'browser')`;

export type Bucket = {
  /** Hour 0-23, attempt 1-5, or a label key. */
  key: string;
  calls: number;
  pickups: number;
  demos: number;
};

export type WhatWorks = {
  days: number;
  /** Every counted call in the window. */
  calls: number;
  byHour: Bucket[];
  byAttempt: Bucket[];
  /** Next call after a voicemail ("voicemail") or a no answer ("no_answer"). */
  afterMiss: Bucket[];
};

const bucket = (r: Row): Bucket => ({
  key: String(r.k),
  calls: n(r.calls),
  pickups: n(r.pickups),
  demos: n(r.demos),
});

export async function getWhatWorks(days: number): Promise<WhatWorks> {
  const window = `${days} days`;

  const [hours, attempts, misses] = await Promise.all([
    db.execute(sql`
      select extract(hour from c.called_at at time zone z.tz)::int as k,
        count(*) as calls,
        count(*) filter (where c.outcome in ${PICKUP}) as pickups,
        count(*) filter (where c.outcome = 'demo_booked') as demos
      from call c
      join call_lead l on l.id = c.call_lead_id
      ${leadZone}
      left join app_user u on u.id = c.user_id
      where c.called_at >= now() - ${window}::interval
        and c.outcome <> 'bad_number'
        and z.tz is not null
        and ${RANG}
      group by 1 order by 1
    `),
    // The try number counts every earlier call to that business, not only the
    // ones in the window, so a business first rung last month is on its third.
    db.execute(sql`
      with ranked as (
        select c.called_at, c.outcome,
          row_number() over (partition by c.call_lead_id order by c.called_at, c.id) as rn
        from call c
        left join app_user u on u.id = c.user_id
        where c.outcome <> 'bad_number' and ${RANG}
      )
      select least(rn, 5) as k,
        count(*) as calls,
        count(*) filter (where outcome in ${PICKUP}) as pickups,
        count(*) filter (where outcome = 'demo_booked') as demos
      from ranked
      where called_at >= now() - ${window}::interval
      group by 1 order by 1
    `),
    // The call that followed a voicemail or a no answer, if it came within two
    // weeks: further apart and it is a fresh attempt, not a follow-up.
    db.execute(sql`
      with seq as (
        select c.called_at, c.outcome,
          lag(c.outcome) over w as prev, lag(c.called_at) over w as prev_at
        from call c
        left join app_user u on u.id = c.user_id
        where c.outcome <> 'bad_number' and ${RANG}
        window w as (partition by c.call_lead_id order by c.called_at, c.id)
      )
      select prev::text as k,
        count(*) as calls,
        count(*) filter (where outcome in ${PICKUP}) as pickups,
        count(*) filter (where outcome = 'demo_booked') as demos
      from seq
      where prev in ('voicemail', 'no_answer')
        and called_at - prev_at <= interval '14 days'
        and called_at >= now() - ${window}::interval
      group by 1 order by 1
    `),
  ]);

  const byAttempt = (attempts as unknown as Row[]).map(bucket);
  return {
    days,
    calls: byAttempt.reduce((a, b) => a + b.calls, 0),
    byHour: (hours as unknown as Row[]).map(bucket),
    byAttempt,
    afterMiss: (misses as unknown as Row[]).map(bucket),
  };
}
