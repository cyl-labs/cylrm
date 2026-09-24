import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { leadZone } from "@/lib/calls";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";

/**
 * Calls a founder has put on the Meetings calendar for themselves (2026-09-24).
 *
 * Asked for as a way to say "I'll ring this one back myself" from a meeting,
 * with two constraints that ruled out everything already built: it must not
 * be a callback, which is the floor's work order and lands in a caller's queue
 * and morning reminder, and it must not be a reschedule, because moving a
 * Cal.com booking emails the prospect. So it is its own entry in its own
 * table (`founder_call`), shown only to founders, sent nowhere.
 *
 * Open until a founder marks it done; removing one deletes it.
 */

export type FounderCall = {
  id: number;
  meetingId: number | null;
  leadId: number | null;
  /** The lead's niche, for "Open lead" into its dial card. */
  listId: number | null;
  name: string;
  phone: string | null;
  startAt: string;
  notes: string | null;
  /** The prospect's clock: the lead's zone first, then the booking's. */
  theirTz: string | null;
  /** Its time has come. Worked out by the database so the server render and
   *  the browser cannot disagree about a call due within the minute. */
  due: boolean;
  /** Due within the hour, which is how the calendar picks its strong colour —
   *  the same rule `startingSoon` follows for meetings. */
  soon: boolean;
  /** Why the number may not be rung, the same block every calling screen
   *  applies. */
  dncBlock: string | null;
  /** Tries that went unanswered, and when the last one was. */
  tries: number;
  lastTriedAt: string | null;
};

type Row = Record<string, unknown>;

/** Every open one, soonest first. A handful at most, so no paging. */
export async function getFounderCalls(): Promise<FounderCall[]> {
  const rows = (await db.execute(sql`
    select fc.id, fc.meeting_id, fc.call_lead_id, fc.name, fc.phone,
      fc.start_at, fc.notes, fc.tries, fc.last_tried_at,
      l.call_list_id as list_id, l.dnc_status, l.dnc_checked_at,
      z.tz as lead_tz, m.attendee_tz,
      (fc.start_at <= now()) as due,
      (fc.start_at <= now() + interval '1 hour') as soon
    from founder_call fc
    left join call_meeting m on m.id = fc.meeting_id
    left join call_lead l on l.id = fc.call_lead_id
    ${leadZone}
    where fc.done_at is null
    order by fc.start_at asc
    limit 200
  `)) as Row[];

  return rows.map((r) => {
    const phone = (r.phone as string | null) ?? null;
    return {
      id: Number(r.id),
      meetingId: r.meeting_id === null ? null : Number(r.meeting_id),
      leadId: r.call_lead_id === null ? null : Number(r.call_lead_id),
      listId: r.list_id === null || r.list_id === undefined ? null : Number(r.list_id),
      name: String(r.name ?? "") || "This prospect",
      phone,
      startAt: new Date(r.start_at as string).toISOString(),
      notes: (r.notes as string | null) ?? null,
      theirTz:
        ((r.lead_tz as string | null) || (r.attendee_tz as string | null)) ??
        null,
      due: r.due === true,
      soon: r.soon === true,
      tries: Number(r.tries ?? 0),
      lastTriedAt: r.last_tried_at
        ? new Date(r.last_tried_at as string).toISOString()
        : null,
      dncBlock:
        r.call_lead_id === null || !phone
          ? null
          : dncBlockReason(
              {
                dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
                dncCheckedAt: r.dnc_checked_at
                  ? new Date(r.dnc_checked_at as string).toISOString()
                  : null,
              },
              dialCountry(phone),
            ),
    };
  });
}

/** How many are due now, for the founders' Meetings badge. One small indexed
 *  count, run only for founders. */
export async function countFounderCallsDue(): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n from founder_call
    where done_at is null and start_at <= now()
  `)) as { n: number }[];
  return row?.n ?? 0;
}
