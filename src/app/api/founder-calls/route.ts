import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/**
 * Put a call on the Meetings calendar for the founders to make themselves —
 * see `lib/founder-calls.ts`. `{ meetingId, at, notes }`.
 *
 * Founders only, and enforced here: `/api` is outside the middleware matcher.
 * Nothing is sent to the prospect and nothing touches the callers' callbacks.
 *
 * One open call back per meeting: setting it again moves the one already
 * there, so a founder changing their mind never ends up with two.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only a founder can set a founders' call back." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    meetingId?: unknown;
    at?: unknown;
    notes?: unknown;
  } | null;
  const meetingId = Number(body?.meetingId);
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const [m] = (await db.execute(sql`
    select m.id, m.call_lead_id, m.attendee_tz,
      coalesce(l.company, m.attendee_name, l.name) as name,
      coalesce(m.attendee_phone, l.phone) as phone
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    where m.id = ${meetingId}
  `)) as {
    id: number;
    call_lead_id: number | null;
    attendee_tz: string | null;
    name: string | null;
    phone: string | null;
  }[];
  if (!m) return Response.json({ error: "Meeting not found." }, { status: 404 });

  // Read in the prospect's zone, the way every callback box in the app is: a
  // datetime-local field sends no offset, and "10am" means their morning. The
  // same order the row's label is built in, so what was typed is what is kept.
  const zone =
    prospectZone(
      m.call_lead_id === null ? null : await zoneForLead(m.call_lead_id),
      m.attendee_tz,
    ) ?? (await readerZone(me.id)).tz;
  const startAt = parseCallbackAt(body?.at, zone);
  if (!startAt) {
    return Response.json({ error: "Pick a day and a time." }, { status: 400 });
  }
  const notes =
    typeof body?.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 2000)
      : null;

  const [open] = (await db.execute(sql`
    select id from founder_call
    where meeting_id = ${meetingId} and done_at is null
    order by id desc limit 1
  `)) as { id: number }[];

  const [row] = open
    ? ((await db.execute(sql`
        update founder_call
        set start_at = ${startAt.toISOString()}, notes = ${notes}
        where id = ${open.id}
        returning id, start_at
      `)) as { id: number; start_at: string }[])
    : ((await db.execute(sql`
        insert into founder_call
          (meeting_id, call_lead_id, name, phone, start_at, notes, created_by)
        values (${meetingId}, ${m.call_lead_id}, ${m.name}, ${m.phone},
          ${startAt.toISOString()}, ${notes}, ${me.id})
        returning id, start_at
      `)) as { id: number; start_at: string }[]);

  return Response.json({
    id: Number(row.id),
    startAt: new Date(row.start_at).toISOString(),
    moved: Boolean(open),
  });
}
