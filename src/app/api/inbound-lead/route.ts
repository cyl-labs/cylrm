import { sql } from "drizzle-orm";
import { db } from "@/db";
import { phoneKeyCandidates } from "@/lib/calls";
import { callScope, getCurrentUser } from "@/lib/session";
import { answersMeeting } from "@/lib/attendance-sql";

/**
 * Who is ringing, and what was said last time.
 *
 * An inbound call arrives as a number and nothing else, which is the worst
 * possible thing to answer: somebody ringing back has already had a
 * conversation, and starting it again from "who am I speaking to" wastes the
 * one advantage a callback has.
 *
 * Matched on `phone_key` — digits only — because that is what the importer
 * stores and what dedupe already relies on, so a number written any of the ways
 * a directory writes it still finds its lead. Against every key the line could
 * be under, not just one: the SDK reports a caller without their country code,
 * and keying on that alone made a lead in the caller's own niche ring in as an
 * unknown number.
 *
 * Scoped like every other calling query: a caller sees a lead on their own
 * niches, an admin sees any. An unmatched number is a perfectly ordinary
 * answer, not an error — somebody can ring a number that was never in a list.
 */
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const from = new URL(request.url).searchParams.get("from") ?? "";
  // Every way this line could be stored, because the number arrives from the
  // SDK without its country code — see `phoneKeyCandidates`.
  const keys = phoneKeyCandidates(from);
  if (keys.length === 0) return Response.json({ lead: null });

  const owner = callScope(me);
  const [lead] = (await db.execute(sql`
    select l.id, l.company, l.name, l.phone, l.title, l.website,
           cl.name as list_name
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    -- A list, not "= any(array)": Drizzle renders an array as "($1, $2)",
    -- which Postgres refuses, and every lookup here failed from 2026-09-04.
    where (
      l.phone_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      -- The decision maker's own line, when one was saved on the lead.
      or l.direct_phone_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
    )
      ${owner === undefined ? sql`` : sql`and cl.assigned_user_id = ${owner}`}
    -- A number can sit on more than one list when a duplicate was kept rather
    -- than dropped. The original is the one with the history on it.
    order by l.duplicate_of_lead_id nulls first, l.id
    limit 1
  `)) as {
    id: number;
    company: string | null;
    name: string | null;
    phone: string;
    title: string | null;
    website: string | null;
    list_name: string;
  }[];

  // Bookings with this caller (2026-10-03): "show me the previous context /
  // booking summary of the caller so i know what is going on". Found by the
  // lead when there is one, and by the booking's own phone number otherwise,
  // since a prospect who booked from a mobile rings in from it. The number
  // path is a founder's only: a caller reaches a booking through a lead on
  // their own niches, like everything else here.
  const keyList = sql.join(keys.map((k) => sql`${k}`), sql`, `);
  const meetingRows = (await db.execute(sql`
    select m.id, m.kind, m.start_at, m.status, m.attendee_name, m.attendee_tz,
      b.summary as brief,
      (select a.status from call_demo_attendance a
        where a.call_lead_id = m.call_lead_id and ${answersMeeting("a", "m")}
        order by a.marked_at desc limit 1) as attendance,
      (select f.result from call_meeting_followup f
        where f.meeting_id = m.id and f.for_start_at = m.start_at
        order by f.created_at desc limit 1) as follow_up
    from call_meeting m
    left join call_meeting_brief b on b.meeting_id = m.id
    where ${
      lead
        ? sql`m.call_lead_id = ${lead.id}`
        : owner === undefined
          ? sql`regexp_replace(coalesce(m.attendee_phone, ''), '[^0-9]', '', 'g') in (${keyList})`
          : sql`false`
    }
    order by m.start_at desc
    limit 3
  `)) as {
    id: number;
    kind: string;
    start_at: string;
    status: string;
    attendee_name: string | null;
    attendee_tz: string | null;
    brief: string | null;
    attendance: string | null;
    follow_up: string | null;
  }[];
  const meetings = meetingRows.map((m) => ({
    id: m.id,
    kind: m.kind,
    startAt: new Date(m.start_at).toISOString(),
    status: m.status,
    name: m.attendee_name,
    tz: m.attendee_tz,
    attendance: m.attendance,
    followUp: m.follow_up,
    brief: m.brief,
  }));

  if (!lead) return Response.json({ lead: null, meetings });

  // The newest written summary of a call with them, if one exists. Read as
  // stored: nothing is generated while the phone is ringing.
  const [summaryRow] = (await db.execute(sql`
    select cr.summary, cr.started_at
    from call c
    join call_recording cr on cr.call_session_id = c.telnyx_session_id
    where c.call_lead_id = ${lead.id} and cr.summary is not null
    order by cr.started_at desc nulls last
    limit 1
  `)) as { summary: string; started_at: string | null }[];

  // The last few calls, newest first. Notes are the point — the outcome alone
  // says a callback was promised, the note says what for.
  const history = (await db.execute(sql`
    select c.called_at, c.outcome::text as outcome, c.notes, u.name as caller
    from call c
    left join app_user u on u.id = c.user_id
    where c.call_lead_id = ${lead.id}
    order by c.called_at desc
    limit 5
  `)) as {
    called_at: string;
    outcome: string;
    notes: string | null;
    caller: string | null;
  }[];

  return Response.json({
    meetings,
    lastSummary: summaryRow
      ? {
          text: summaryRow.summary,
          at: summaryRow.started_at ? new Date(summaryRow.started_at).toISOString() : null,
        }
      : null,
    lead: {
      id: lead.id,
      company: lead.company,
      name: lead.name,
      phone: lead.phone,
      title: lead.title,
      website: lead.website,
      list: lead.list_name,
      history: history.map((h) => ({
        at: new Date(h.called_at).toISOString(),
        outcome: h.outcome,
        notes: h.notes,
        caller: h.caller,
      })),
    },
  });
}
