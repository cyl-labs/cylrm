import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { canEditLead } from "@/lib/lead-access";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/** Cal.com's demo event is half an hour, which is also what the calendar
 *  assumes for a row with no end. */
const DEMO_MINUTES = 30;

/**
 * Put a demo on the Meetings tab without a Cal.com booking, `{ leadId, at }`
 * (2026-10-03).
 *
 * Asked for from the Spreadsheet: "just book the meeting silently, like just
 * add it to my meetings tab without making a calcom event. If I'm going in
 * spreadsheet it's like an emergency", and "schedule 4pm based on their local
 * time". Cal.com is not told, so the prospect gets no invite and no reminder
 * email, and the dialog says so.
 *
 * The row is an ordinary `call_meeting`, so the badge, the calendar, the
 * reminders, the recording window and "did they turn up" all follow with no
 * change of their own. Its `cal_booking_uid` is ours (`crm-<uuid>`), which
 * the Cal.com sync never asks about, and `matched_by = 'manual'` is the value
 * the sync already treats as "do not re-match".
 *
 * `at` is read on the prospect's clock, the way every time box is: a
 * datetime-local value carries no offset, and "4pm" means their afternoon.
 * `/api` is outside the middleware matcher, so the checks here are the only
 * guard.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    leadId?: unknown;
    at?: unknown;
  } | null;
  const leadId = Number(body?.leadId);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return Response.json({ error: "Invalid business." }, { status: 400 });
  }
  if (!(await canEditLead(me, leadId))) {
    return Response.json(
      { error: "This business is not on your lists." },
      { status: 403 },
    );
  }

  const [lead] = (await db.execute(sql`
    select id, company, name, email from call_lead where id = ${leadId}
  `)) as {
    id: number;
    company: string | null;
    name: string | null;
    email: string | null;
  }[];
  if (!lead) return Response.json({ error: "Business not found." }, { status: 404 });

  const leadZone = prospectZone(await zoneForLead(leadId), null);
  const zone = leadZone ?? (await readerZone(me.id)).tz;
  const startAt = parseCallbackAt(body?.at, zone);
  if (!startAt) {
    return Response.json({ error: "Pick a day and a time." }, { status: 400 });
  }
  if (startAt.getTime() < Date.now() - 15 * 60_000) {
    return Response.json(
      { error: "That time has already passed. Pick a time that is still ahead." },
      { status: 400 },
    );
  }

  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);

  // One live demo per business, so pressing twice (or booking on Cal.com and
  // then here) cannot put two on the screen: a second attendance fee is what
  // `call_demo_attendance`'s unique index exists to refuse.
  const [existing] = (await db.execute(sql`
    select start_at from call_meeting
    where call_lead_id = ${leadId} and kind = 'demo' and status = 'accepted'
      and start_at > now() - interval '12 hours'
    order by start_at limit 1
  `)) as { start_at: string }[];
  if (existing) {
    return Response.json(
      {
        error: `This business already has a demo on Meetings, ${when(new Date(existing.start_at))} their time. Move that one instead.`,
      },
      { status: 409 },
    );
  }

  // The demo call this booking belongs to, as the sync would have found it:
  // the lead's latest `demo_booked`. It is what names who booked the meeting.
  const [bc] = (await db.execute(sql`
    select id from "call"
    where call_lead_id = ${leadId} and outcome = 'demo_booked'
    order by called_at desc, id desc limit 1
  `)) as { id: number }[];

  const endAt = new Date(startAt.getTime() + DEMO_MINUTES * 60_000);
  const title = `Demo: ${lead.company ?? lead.name ?? "business"}`;
  const [row] = (await db.execute(sql`
    insert into call_meeting (
      cal_booking_uid, call_lead_id, call_id, matched_by,
      start_at, end_at, status, title,
      attendee_name, attendee_email, attendee_tz, kind, closer_user_id, synced_at
    ) values (
      ${`crm-${randomUUID()}`}, ${leadId}, ${bc?.id ?? null}, 'manual',
      ${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz,
      'accepted', ${title},
      ${lead.name}, ${lead.email}, ${zone}, 'demo',
      -- A closer closes the meetings they booked (2026-10-06).
      (select c.user_id from "call" c
        join app_user u on u.id = c.user_id
        where c.id = ${bc?.id ?? null}::int and u.role = 'closer' and u.active),
      now()
    )
    returning id
  `)) as { id: number }[];

  return Response.json({ id: row.id, when: when(startAt), theirs: leadZone !== null });
}
