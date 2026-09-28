import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/**
 * Move a meeting on our calendar only, `{ at }` (2026-09-28).
 *
 * Asked for as "just move meetings without sending a new calcom or having to
 * mark as no show". Cal.com is not told, so the prospect gets no email from
 * this, and Cal.com's own reminder still goes out for the old time: the
 * dialog says so.
 *
 * It rewrites `start_at` itself (and `end_at` by the same amount) rather than
 * keeping a second time beside it, so every reminder, the badge, the calendar
 * and "did they turn up" follow the new time with no change of their own.
 * `cal_start_at` keeps Cal.com's time, which is how the sync knows to leave
 * ours alone; see `syncMeetings`. Payroll's attendance fee is keyed on the
 * booking call, so the caller who booked it is paid the same either way.
 *
 * Founders, and a closer on a meeting handed to them. `/api` is outside the
 * middleware matcher, so this check is the only guard.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const [m] = (await db.execute(sql`
    select id, call_lead_id, attendee_tz, status, closer_user_id
    from call_meeting where id = ${id}
  `)) as {
    id: number;
    call_lead_id: number | null;
    attendee_tz: string | null;
    status: string;
    closer_user_id: number | null;
  }[];
  if (!m) return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (me.role !== "admin" && Number(m.closer_user_id) !== me.id) {
    return Response.json(
      { error: "Only a founder, or the closer it was handed to, can move a meeting." },
      { status: 403 },
    );
  }
  if (m.status === "cancelled") {
    return Response.json(
      { error: "This meeting was cancelled on Cal.com, so there is nothing to move." },
      { status: 400 },
    );
  }

  // Their clock, the way every time box in the app is read: a datetime-local
  // value carries no offset, and "10am" means the prospect's morning.
  const body = (await request.json().catch(() => null)) as { at?: unknown } | null;
  const zone =
    prospectZone(
      m.call_lead_id === null ? null : await zoneForLead(m.call_lead_id),
      m.attendee_tz,
    ) ?? (await readerZone(me.id)).tz;
  const startAt = parseCallbackAt(body?.at, zone);
  if (!startAt) {
    return Response.json({ error: "Pick a day and a time." }, { status: 400 });
  }

  const [row] = (await db.execute(sql`
    update call_meeting set
      end_at = case when end_at is null then null
        else ${startAt.toISOString()}::timestamptz + (end_at - start_at) end,
      start_at = ${startAt.toISOString()}::timestamptz,
      -- Rows synced before the column existed have it filled by the
      -- migration; this is only a guard for one that somehow was not.
      cal_start_at = coalesce(cal_start_at, start_at)
    where id = ${id}
    returning start_at
  `)) as { start_at: string }[];

  return Response.json({ startAt: new Date(row.start_at).toISOString() });
}
