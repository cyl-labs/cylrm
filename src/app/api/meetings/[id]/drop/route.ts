import { logMeetingEvent } from "@/lib/meeting-log";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Take a follow-up, or everybody's follow-ups for a business, off Meetings
 * (2026-09-29). `{ everything?: boolean }`.
 *
 * Asked for as "why cant i mark him as not a real booking" on a follow-up,
 * then "just add a option to delete people who are wasting our time". Nothing
 * is deleted: the calls, recordings and the caller's pay all stay. A follow-up
 * is closed the way a ring back is, with a `cancelled` row in
 * `call_meeting_followup` against its current time, which `stillAhead` and the
 * "logged" tests already read. With `everything`, every open follow-up on the
 * business is closed too; the lost outcome that settles the sale is logged by
 * the row through `/api/calls`, the one route that writes calls.
 *
 * Cal.com is not told, so nothing reaches the prospect.
 *
 * Founders, and a closer on a meeting handed to them. `/api` is outside the
 * middleware matcher, so this check is the only guard.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    everything?: unknown;
  } | null;
  const everything = body?.everything === true;

  const [m] = (await db.execute(sql`
    select id, call_lead_id, closer_user_id from call_meeting where id = ${id}
  `)) as { id: number; call_lead_id: number | null; closer_user_id: number | null }[];
  if (!m) return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (me.role !== "admin" && Number(m.closer_user_id) !== me.id) {
    return Response.json(
      { error: "Only a founder, or the closer it was handed to, can do that." },
      { status: 403 },
    );
  }

  const note = everything
    ? "Taken off Meetings: not worth following up."
    : "Not a real booking.";

  // One follow-up alone, or every meeting on the business. A demo gets the
  // row too when the whole business goes: that is what clears a no-show's
  // ring back. It does not answer "did they turn up", which is what the
  // caller is paid on and stays a founder's honest answer.
  const closed = (await db.execute(sql`
    insert into call_meeting_followup
      (meeting_id, user_id, result, notes, for_start_at)
    select m.id, ${me.id}, 'cancelled', ${note}, m.start_at
    from call_meeting m
    where ${everything ? sql`true` : sql`m.kind = 'follow_up'`}
      and m.status = 'accepted'
      and ${
        everything && m.call_lead_id !== null
          ? sql`m.call_lead_id = ${m.call_lead_id}`
          : sql`m.id = ${id}`
      }
      and not exists (
        select 1 from call_meeting_followup fu
        where fu.meeting_id = m.id and fu.for_start_at = m.start_at
          and fu.result = 'cancelled'
      )
    returning meeting_id
  `)) as { meeting_id: number }[];

  // And any founders' call back still open on the business, which would
  // otherwise keep the row on the calendar at its call back time.
  if (everything && m.call_lead_id !== null) {
    await db.execute(sql`
      update founder_call set done_at = now()
      where done_at is null and meeting_id in (
        select id from call_meeting where call_lead_id = ${m.call_lead_id}
      )
    `);
  }

  for (const c of closed) {
    await logMeetingEvent({
      meetingId: Number(c.meeting_id),
      userId: me.id,
      action: "taken_off",
      detail: note,
    });
  }

  return Response.json({ closed: closed.length });
}
