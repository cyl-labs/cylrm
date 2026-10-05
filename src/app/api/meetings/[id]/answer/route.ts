import { logMeetingEvent } from "@/lib/meeting-log";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { answersMeeting } from "@/lib/attendance-sql";

/**
 * Take back "did they turn up" on a meeting, so it is waiting for an answer
 * again (2026-10-03).
 *
 * Asked for after a No show was logged on the wrong meeting. The answer route
 * is an upsert, so an answer could be changed but never withdrawn, and a
 * meeting that had been answered by mistake stayed answered: off the list of
 * work owed, and (for a no show) on the ring back list.
 *
 * It removes the one row the Meetings list reads for this meeting (the same
 * `answersMeeting` rule and ordering as the `attendance` column), so what
 * disappears is exactly what the row showed.
 *
 * **Refused once a payout has claimed it.** That money is out of the door, and
 * the fix for a wrong payment is a correcting payout, not a quiet edit of the
 * evidence: the attendance route holds the same line.
 *
 * Marking "not a real booking" closed any founders' call back on the meeting.
 * Taking that answer back opens the ones it closed (those closed in the same
 * moment), so the meeting is not left with its call back silently gone.
 *
 * Founders, and a closer on a meeting handed to them. `/api` is outside the
 * middleware matcher, so this check is the only guard.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const [m] = (await db.execute(sql`
    select id, call_lead_id, closer_user_id from call_meeting where id = ${id}
  `)) as { id: number; call_lead_id: number | null; closer_user_id: number | null }[];
  if (!m) return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (me.role !== "admin" && Number(m.closer_user_id) !== me.id) {
    return Response.json(
      { error: "Only a founder, or the closer it was handed to, can undo that." },
      { status: 403 },
    );
  }
  if (m.call_lead_id === null) {
    return Response.json({ error: "Nothing was recorded for this meeting." }, { status: 404 });
  }

  const [row] = (await db.execute(sql`
    select a.id, a.status, a.payout_id, a.marked_at
    from call_demo_attendance a
    join call_meeting mm on mm.id = ${id}
    where a.call_lead_id = ${m.call_lead_id} and ${answersMeeting("a", "mm")}
    order by a.marked_at desc limit 1
  `)) as {
    id: number;
    status: string;
    payout_id: number | null;
    marked_at: string;
  }[];
  if (!row) {
    return Response.json(
      { error: "Nobody has said what happened at this meeting." },
      { status: 404 },
    );
  }
  if (row.payout_id !== null) {
    return Response.json(
      {
        error:
          "This one has already been paid for, so it cannot be undone here. Record a correcting payout instead.",
      },
      { status: 409 },
    );
  }

  await db.execute(sql`delete from call_demo_attendance where id = ${row.id}`);

  if (row.status === "invalid") {
    await db.execute(sql`
      update founder_call set done_at = null
      where meeting_id = ${id} and done_at is not null
        and done_at between ${row.marked_at}::timestamptz - interval '30 seconds'
                        and ${row.marked_at}::timestamptz + interval '30 seconds'
    `);
  }

  await logMeetingEvent({
    meetingId: id,
    userId: me.id,
    action: "undone",
    detail: `Took back: ${row.status}`,
  });

  return Response.json({ ok: true, was: row.status });
}
