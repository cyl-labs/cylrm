import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Write one line to the meetings log (2026-10-05). The business and the
 * meeting's time are copied off the meeting at the moment, so the line still
 * reads right after the meeting is moved or deleted.
 *
 * **Never throws.** The log records an answer; it must not be able to stop the
 * answer being saved, so a failure is reported to the console and swallowed.
 */
export async function logMeetingEvent(e: {
  meetingId: number | null;
  userId: number;
  action: string;
  detail?: string | null;
}): Promise<void> {
  try {
    if (e.meetingId === null) {
      await db.execute(sql`
        insert into meeting_log (user_id, action, detail)
        values (${e.userId}, ${e.action}, ${e.detail ?? null})
      `);
      return;
    }
    await db.execute(sql`
      insert into meeting_log (user_id, meeting_id, business, meeting_start_at, action, detail)
      select ${e.userId}, m.id, coalesce(l.company, l.name, m.attendee_name),
        m.start_at, ${e.action}, ${e.detail ?? null}
      from call_meeting m
      left join call_lead l on l.id = m.call_lead_id
      where m.id = ${e.meetingId}
    `);
  } catch (err) {
    console.error("[meeting-log] could not write", e.action, err);
  }
}

export type MeetingLogEntry = {
  id: number;
  at: string;
  who: string | null;
  meetingId: number | null;
  business: string | null;
  meetingStartAt: string | null;
  action: string;
  detail: string | null;
};

/** The latest entries, newest first. */
export async function getMeetingLog(limit = 300): Promise<MeetingLogEntry[]> {
  const rows = (await db.execute(sql`
    select ml.id, ml.at, u.name as who, ml.meeting_id, ml.business,
      ml.meeting_start_at, ml.action, ml.detail
    from meeting_log ml
    left join app_user u on u.id = ml.user_id
    order by ml.at desc, ml.id desc
    limit ${limit}
  `)) as Record<string, unknown>[];
  const iso = (v: unknown) =>
    v === null || v === undefined ? null : new Date(v as string).toISOString();
  return rows.map((r) => ({
    id: Number(r.id),
    at: iso(r.at) as string,
    who: (r.who as string | null) ?? null,
    meetingId: r.meeting_id === null ? null : Number(r.meeting_id),
    business: (r.business as string | null) ?? null,
    meetingStartAt: iso(r.meeting_start_at),
    action: String(r.action),
    detail: (r.detail as string | null) ?? null,
  }));
}
