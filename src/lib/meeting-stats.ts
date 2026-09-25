import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { sinceOn, type StatsWindow } from "@/lib/call-stats";
import { STATS_TZ } from "@/lib/stats-zones";

/**
 * What happened at the meetings, day by day (2026-09-25).
 *
 * Asked for as "on this day how many meetings did I have, how many actual
 * conversations, how many voicemails / no shows, then how many follow ups".
 * A voicemail is a no show: somebody who picks up and cannot talk has the
 * meeting moved rather than marked, so there is one kind of no show and the
 * split that shipped briefly (voicemail / no answer) was dropped the same day.
 * The Meetings screen is a queue read top to bottom and the answer is a table,
 * so it lives on Stats with the window, the zone and the person picker that
 * screen already has; Meetings carries one summary line pointing here.
 *
 * Three ledgers, each counted on its own clock:
 *
 * - **Demos** by when they were booked for (`start_at`), with the answer given
 *   on the row: showed up (a conversation), no show, not a real booking, not
 *   logged yet, still to come, cancelled.
 * - **After a demo that happened**: follow-up meetings on the calendar, and
 *   follow-up calls logged on a lead after it showed up — with the trials,
 *   wins and losses among them. By when the call was logged.
 * - **After a no-show**: every ring back and call back result, by when it was
 *   logged. `call_meeting_followup` holds both — the founders' call backs
 *   write their result there too.
 *
 * `personId` is **who booked the demo**, on every ledger: the question a
 * founder asks of a caller is how their bookings turn out, and the follow-up
 * calls are the founders' own, so filtering those by who dialled would read
 * zero for every caller.
 */
export type MeetingCounts = {
  demos: number;
  showed: number;
  noShow: number;
  notReal: number;
  unlogged: number;
  upcoming: number;
  cancelled: number;
  followUpMeetings: number;
  followUpCalls: number;
  trials: number;
  won: number;
  lost: number;
  ringBacks: number;
  ringBackSpoke: number;
  ringBackRebooked: number;
  /** Contracts, each on the day it happened (2026-09-25): drafted, sent (the
   *  client's link first copied), signed by the client. Trial and paid are
   *  separate agreements and each counts. */
  contractsDrafted: number;
  contractsSent: number;
  contractsSigned: number;
  trialsSigned: number;
  paidSigned: number;
};

export type MeetingDay = MeetingCounts & { day: string };

export type MeetingStats = { totals: MeetingCounts; days: MeetingDay[] };

const ZERO: MeetingCounts = {
  demos: 0,
  showed: 0,
  noShow: 0,
  notReal: 0,
  unlogged: 0,
  upcoming: 0,
  cancelled: 0,
  followUpMeetings: 0,
  followUpCalls: 0,
  trials: 0,
  won: 0,
  lost: 0,
  ringBacks: 0,
  ringBackSpoke: 0,
  ringBackRebooked: 0,
  contractsDrafted: 0,
  contractsSent: 0,
  contractsSigned: 0,
  trialsSigned: 0,
  paidSigned: 0,
};

/**
 * A window as a condition on a meeting-ish time. The calendar-date windows
 * ("today", a picked day, a range) can include meetings still ahead, which is
 * what "how many meetings do I have today" wants. The clock windows ("last 7
 * days", all time) stop at now, or every booked future demo would sit in last
 * week's numbers.
 */
const inWindow = (w: StatsWindow, col: SQL): SQL =>
  w.kind === "day" || w.kind === "between"
    ? sinceOn(w, col)
    : sql`${sinceOn(w, col)} and ${col} <= now()`;

const filters = (listId?: number, personId?: number): SQL => sql`
  ${listId ? sql`and l.call_list_id = ${listId}` : sql``}
  ${personId ? sql`and bc.user_id = ${personId}` : sql``}
`;

/**
 * The answer that belongs to meeting `m`, for counting.
 *
 * Stricter than the Meetings row's `answersMeeting`, on purpose. Attendance is
 * keyed by booking call, and a lead that no-showed Monday and turned up
 * Wednesday can carry Wednesday's answer on both rows — harmless on a queue,
 * where the old row has gone, and a double count here. So an answer counts for
 * `m` when it was given on `m` itself, or after `m` began and before the lead's
 * next meeting did.
 */
const ANSWER = sql`
  left join lateral (
    select a.status from call_demo_attendance a
    where a.call_lead_id = m.call_lead_id
      and (a.meeting_id is null or a.meeting_id = m.id)
      and (a.marked_at >= m.start_at or a.for_start_at = m.start_at)
      and (
        a.meeting_id = m.id
        or not exists (
          select 1 from call_meeting m2
          where m2.call_lead_id = m.call_lead_id
            and m2.id <> m.id
            and m2.status = 'accepted'
            and m2.start_at > m.start_at
            and m2.start_at <= a.marked_at
        )
      )
    order by a.marked_at desc
    limit 1
  ) att on true
`;

export async function getMeetingStats(
  w: StatsWindow,
  listId?: number,
  personId?: number,
): Promise<MeetingStats> {
  const tz = w.tz ?? STATS_TZ;
  const f = filters(listId, personId);

  const [demoRows, callRows, ringRows, contractRows] = await Promise.all([
    db.execute(sql`
      select (m.start_at at time zone ${tz})::date::text as day,
        -- An answer outranks the calendar's status: a booking cancelled on
        -- Cal.com and held anyway (moved by phone) still happened.
        count(*) filter (where m.kind = 'demo'
          and (att.status is not null or m.status = 'accepted'))::int as demos,
        count(*) filter (where m.kind = 'demo' and att.status = 'showed_up')::int as showed,
        count(*) filter (where m.kind = 'demo' and att.status = 'no_show')::int as no_show,
        count(*) filter (where m.kind = 'demo' and att.status = 'invalid')::int as not_real,
        -- Not logged: a demo with no answer, or a follow-up nothing has been
        -- logged against since it began (2026-09-25), the Meetings row's rule.
        count(*) filter (where m.status = 'accepted' and m.start_at <= now() and (
          (m.kind = 'demo' and att.status is null)
          or (m.kind = 'follow_up'
            and not exists (
              select 1 from "call" fc
              where fc.call_lead_id = m.call_lead_id
                and fc.called_at >= m.start_at - interval '30 minutes'
            )
            and not exists (
              select 1 from call_meeting_followup fu
              where fu.meeting_id = m.id and fu.for_start_at = m.start_at
            ))
        ))::int as unlogged,
        count(*) filter (where m.kind = 'demo' and att.status is null
          and m.status = 'accepted' and m.start_at > now())::int as upcoming,
        count(*) filter (where m.kind = 'demo' and att.status is null
          and m.status <> 'accepted')::int as cancelled,
        count(*) filter (where m.kind = 'follow_up'
          and m.status = 'accepted')::int as follow_up_meetings
      from call_meeting m
      left join call_lead l on l.id = m.call_lead_id
      left join "call" bc on bc.id = m.call_id
      ${ANSWER}
      where ${inWindow(w, sql`m.start_at`)} ${f}
      group by 1
    `),
    // Calls logged on a lead after a demo it turned up to. The booking call
    // itself is excluded — it comes before the demo anyway, but a clock skew
    // of a minute should not turn a booking into a follow-up.
    db.execute(sql`
      select (c.called_at at time zone ${tz})::date::text as day,
        count(*)::int as calls,
        count(*) filter (where c.outcome = 'trial')::int as trials,
        count(*) filter (where c.outcome = 'won')::int as won,
        count(*) filter (where c.outcome = 'lost')::int as lost
      from "call" c
      where ${inWindow(w, sql`c.called_at`)}
        and exists (
          select 1
          from call_meeting m
          left join call_lead l on l.id = m.call_lead_id
          left join "call" bc on bc.id = m.call_id
          join call_demo_attendance a
            on a.call_lead_id = m.call_lead_id and a.status = 'showed_up'
          where m.call_lead_id = c.call_lead_id
            and m.kind = 'demo'
            and m.start_at < c.called_at
            and c.id is distinct from m.call_id
            ${f}
        )
      group by 1
    `),
    db.execute(sql`
      select (fu.created_at at time zone ${tz})::date::text as day,
        count(*)::int as ring_backs,
        count(*) filter (where fu.result = 'confirmed')::int as spoke,
        count(*) filter (where fu.result = 'rescheduled')::int as rebooked
      from call_meeting_followup fu
      join call_meeting m on m.id = fu.meeting_id
      left join call_lead l on l.id = m.call_lead_id
      left join "call" bc on bc.id = m.call_id
      where ${inWindow(w, sql`fu.created_at`)} ${f}
      group by 1
    `),
    // Contracts: one row per event, so a contract drafted Monday, sent Monday
    // and signed Wednesday counts on both days. Filtered by the meeting it was
    // drafted for, so a caller's bookings show what their demos turned into.
    db.execute(sql`
      select day, count(*) filter (where ev = 'drafted')::int as drafted,
        count(*) filter (where ev = 'sent')::int as sent,
        count(*) filter (where ev = 'signed')::int as signed,
        count(*) filter (where ev = 'signed' and kind = 'trial')::int as trials_signed,
        count(*) filter (where ev = 'signed' and kind = 'paid')::int as paid_signed
      from (
        select e.ev, c.kind, (e.at at time zone ${tz})::date::text as day
        from call_contract c
        join call_meeting m on m.id = c.meeting_id
        left join call_lead l on l.id = m.call_lead_id
        left join "call" bc on bc.id = m.call_id
        cross join lateral (values
          ('drafted', c.created_at), ('sent', c.sent_at), ('signed', c.signed_at)
        ) as e(ev, at)
        where e.at is not null and ${inWindow(w, sql`e.at`)} ${f}
      ) x
      group by day
    `),
  ]);

  const byDay = new Map<string, MeetingDay>();
  const dayOf = (d: unknown) => {
    const key = String(d);
    let row = byDay.get(key);
    if (!row) {
      row = { day: key, ...ZERO };
      byDay.set(key, row);
    }
    return row;
  };
  for (const r of demoRows as Record<string, unknown>[]) {
    const d = dayOf(r.day);
    d.demos += Number(r.demos);
    d.showed += Number(r.showed);
    d.noShow += Number(r.no_show);
    d.notReal += Number(r.not_real);
    d.unlogged += Number(r.unlogged);
    d.upcoming += Number(r.upcoming);
    d.cancelled += Number(r.cancelled);
    d.followUpMeetings += Number(r.follow_up_meetings);
  }
  for (const r of callRows as Record<string, unknown>[]) {
    const d = dayOf(r.day);
    d.followUpCalls += Number(r.calls);
    d.trials += Number(r.trials);
    d.won += Number(r.won);
    d.lost += Number(r.lost);
  }
  for (const r of ringRows as Record<string, unknown>[]) {
    const d = dayOf(r.day);
    d.ringBacks += Number(r.ring_backs);
    d.ringBackSpoke += Number(r.spoke);
    d.ringBackRebooked += Number(r.rebooked);
  }

  for (const r of contractRows as Record<string, unknown>[]) {
    const d = dayOf(r.day);
    d.contractsDrafted += Number(r.drafted);
    d.contractsSent += Number(r.sent);
    d.contractsSigned += Number(r.signed);
    d.trialsSigned += Number(r.trials_signed);
    d.paidSigned += Number(r.paid_signed);
  }

  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  const totals = { ...ZERO };
  for (const d of days) {
    for (const k of Object.keys(ZERO) as (keyof MeetingCounts)[]) {
      totals[k] += d[k];
    }
  }
  return { totals, days };
}

/** Showed up out of those whose answer is in: the show rate. Not-real and
 *  unlogged are left out of both sides — neither is a prospect deciding. */
export const showRate = (c: MeetingCounts): number | null => {
  const den = c.showed + c.noShow;
  return den === 0 ? null : c.showed / den;
};
