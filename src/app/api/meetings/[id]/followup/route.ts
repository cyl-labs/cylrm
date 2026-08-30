import { sql } from "drizzle-orm";
import { db } from "@/db";
import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting, type MeetingFollowupResult } from "@/lib/meetings";

const RESULTS = [
  "confirmed",
  "no_answer",
  "rescheduled",
  "cancelled",
] as const;

const isResult = (v: unknown): v is MeetingFollowupResult =>
  typeof v === "string" && (RESULTS as readonly string[]).includes(v);

/**
 * Log the chase call made before a meeting.
 *
 * Writes no `call` row, and that is deliberate: another `demo_booked` call
 * would put the lead on payroll's confirm list a second time for one meeting,
 * where the partial unique index on `showed_up` would refuse the duplicate an
 * answer — and it would re-date the lead's state, which every board derives
 * from the latest call.
 *
 * The consequence to know: a chase does not count toward the caller's pickups
 * or appear in the Stats call counts. It is a confirmation of work already
 * paid for on attendance, not a new dial.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    result?: unknown;
    notes?: unknown;
  } | null;
  if (!body || !isResult(body.result)) {
    return Response.json({ error: "Unknown follow-up result." }, { status: 400 });
  }

  // Scoped read: a caller naming a meeting on somebody else's niche gets the
  // same not-found as one that never existed, rather than a permission error
  // that confirms it is there.
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }

  await db.execute(sql`
    insert into call_meeting_followup
      (meeting_id, user_id, result, notes, for_start_at)
    -- for_start_at is copied straight off the row rather than sent back from
    -- the browser, and this is not tidiness: a timestamp that has been through
    -- JavaScript carries milliseconds, the column carries microseconds, and
    -- the equality the chase state is decided by then never matches. Every
    -- meeting would sit there asking to be confirmed however many times it
    -- had been. Reading it here also means a reschedule landing between the
    -- render and this request stamps the slot that is really booked.
    select ${id}, ${me.id}, ${body.result},
      ${typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null},
      m.start_at
    from call_meeting m
    where m.id = ${id}
  `);

  return Response.json({ ok: true });
}
