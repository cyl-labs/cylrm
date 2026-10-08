import { sql } from "drizzle-orm";

/**
 * When the window of calls that belong to a meeting opens (2026-10-08).
 *
 * It used to be twelve hours before `start_at`. Moving a meeting later (a quiet
 * move, or Cal.com rescheduling it) pushed that forward with it, so every call
 * made at the first slot fell out of the row: Navarre Handyman, moved two days
 * on, lost the founders' attempts at the original time and showed none. The
 * calls were never deleted, they just stopped matching.
 *
 * So the window opens from the **earliest time the meeting ever had**: its own
 * `start_at`, Cal.com's time (`cal_start_at`, which a quiet move leaves alone),
 * and the start of a booking this one replaced (a Cal.com reschedule is a new
 * row, created within half an hour of the old one being cancelled, the same
 * rule `REPLACED_BY` in `meetings.ts` uses).
 *
 * Expects `call_meeting` aliased as `m`. One fragment, shared by the meeting
 * row and by who may play a recording, because two copies of "which calls are
 * this meeting's" is how a row ends up offering a button that answers 404.
 */
export const DEMO_WINDOW_OPENS = sql`
  least(
    m.start_at,
    coalesce(m.cal_start_at, m.start_at),
    coalesce((
      select min(o.start_at) from call_meeting o
      where o.call_lead_id = m.call_lead_id
        and o.id <> m.id
        and o.kind = m.kind
        and o.status = 'cancelled'
        and o.start_at < m.start_at
        and abs(extract(epoch from (m.created_at - o.synced_at))) < 1800
    ), m.start_at)
  ) - interval '12 hours'
`;
