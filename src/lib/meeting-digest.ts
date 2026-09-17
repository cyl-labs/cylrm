import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationsConfigured, notifyMeetingDigest } from "@/lib/notify";

/**
 * One Telegram message each morning: the demos coming up.
 *
 * Asked for on 2026-09-18 as "what meetings I have for the day, so I can have
 * a rough overview", separate from the per-meeting reminders a day and half an
 * hour before. Those say "this one is about to start"; this one is the list
 * read with a coffee.
 *
 * **It looks 24 hours ahead rather than at the founders' calendar day**, and
 * that is the whole design decision. The demos run through the US afternoon,
 * which is the middle of the night in Singapore: a 9:30am list of "today" on
 * that clock would carry the ones that finished at 3am and miss tonight's
 * entirely, since a Friday afternoon in New York is a Saturday morning here.
 * The next 24 hours is the US day that has not happened yet, whichever side of
 * midnight it falls on.
 *
 * Sent to the founders' chat — the one `lib/notify.ts` already reports email
 * replies to — so nothing has to be installed or switched on. Unset Telegram
 * settings mean it does nothing, like everything else in that module.
 */

/** 9:30 in the morning, and 9:30 where the founders actually are. */
const DIGEST_HOUR = 9;
const DIGEST_MINUTE = 30;

/**
 * The clock this whole message runs on: Singapore, because that is where the
 * founders are. Both the 9:30 and every time printed.
 *
 * **Deliberately not `foundersZone`**, the timezone picker on Stats and
 * Meetings, which is a reporting preference and was set to Eastern on
 * 2026-09-17: the first digest fired at 1:51am Singapore time, correct by that
 * rule and useless in practice, and listed the demos on a clock the reader was
 * not on. "Half past nine" and "9pm tonight" are facts about the person
 * holding the phone, not about which market they were last reading numbers in.
 * The prospect's own time rides alongside each line where it differs.
 *
 * `DIGEST_TZ` overrides it so a dev run does not have to wait until half past
 * nine, in the spirit of `TELEGRAM_API_BASE`. Never set it in prod.
 */
const HOME_TZ = process.env.DIGEST_TZ ?? "Asia/Singapore";
/** What that clock is called in the message. Moves with `HOME_TZ`. */
const HOME_LABEL = process.env.DIGEST_TZ ? "local time" : "SGT";
/**
 * How far ahead it looks. A full day, so the message covers every demo booked
 * for the coming US working day.
 */
const LOOKAHEAD_HOURS = 24;
/**
 * The window shuts in the evening. A worker down all morning should still
 * deliver the list late — it is a day's work either way — but one arriving at
 * midnight is about a day that is over.
 */
const LATEST_HOUR = 20;

type Row = Record<string, unknown>;

export type MeetingDigestResult = {
  skipped?: "unconfigured" | "not-due" | "already-sent";
  /** Meetings in the next 24 hours, as the message reported them. */
  meetings?: number;
  sent?: boolean;
};

/** Their local date (YYYY-MM-DD) and minutes past midnight, off `Intl` so
 *  daylight saving stays the zone database's problem. */
function localClock(tz: string, now: Date): { date: string; minutes: number } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    // h23 rather than hour12: false, which renders midnight as 24 in some
    // locales and would put the window an hour out.
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { date, minutes: part("hour") * 60 + part("minute") };
}

const clock = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

/** "9:00 PM" for one later today, "Sat 5:30 AM" for one past midnight — the
 *  day only where it is not the one the message was sent on. */
function at(start: Date, tz: string, today: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  const time = clock(start, tz);
  if (day === today) return time;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(start);
  return `${weekday} ${time}`;
}

export async function sendMeetingDigest(
  now: Date = new Date(),
): Promise<MeetingDigestResult> {
  if (!notificationsConfigured()) return { skipped: "unconfigured" };

  // Everything — the 9:30, the once-a-day claim and every time printed — is on
  // the founders' own clock.
  const { date, minutes } = localClock(HOME_TZ, now);
  const due = DIGEST_HOUR * 60 + DIGEST_MINUTE;
  if (minutes < due || minutes >= LATEST_HOUR * 60) return { skipped: "not-due" };

  const tz = HOME_TZ;

  const meetings = (await db.execute(sql`
    select m.start_at, m.attendee_tz,
      coalesce(l.company, l.name, m.attendee_name) as who,
      u.name as booked_by
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call c on c.id = m.call_id
    left join app_user u on u.id = c.user_id
    where m.status = 'accepted'
      and m.start_at > ${now.toISOString()}::timestamptz
      and m.start_at <= ${now.toISOString()}::timestamptz
        + make_interval(hours => ${LOOKAHEAD_HOURS}::int)
    order by m.start_at
  `)) as Row[];

  // Claimed before it is sent, on the local date, so two overlapping ticks
  // cannot both send one — the rule every other reminder here follows. The
  // claim is released if Telegram refuses, so the next tick tries again.
  const claimed = (await db.execute(sql`
    insert into meeting_digest_sent (sent_on, meetings)
    values (${date}, ${meetings.length})
    on conflict (sent_on) do nothing
    returning sent_on
  `)) as Row[];
  if (claimed.length === 0) return { skipped: "already-sent" };

  const lines = meetings.map((m) => {
    const start = new Date(m.start_at as string);
    const theirTz = typeof m.attendee_tz === "string" ? m.attendee_tz : null;
    let theirs = "";
    if (theirTz && theirTz !== tz) {
      try {
        theirs = ` (${clock(start, theirTz)} their time)`;
      } catch {
        // A zone name Intl does not know. Ours still stands.
      }
    }
    const who = (m.who as string | null) ?? "A meeting";
    const by = m.booked_by ? ` · booked by ${m.booked_by as string}` : "";
    return `• ${at(start, tz, date)} — ${who}${theirs}${by}`;
  });

  // The clock is named once: these arrive in the small hours here, and a bare
  // "9:00 PM" is the one thing on the message that could be read as the
  // prospect's time.
  const heading =
    meetings.length === 0
      ? "No demos in the next 24 hours"
      : `${meetings.length} demo${meetings.length === 1 ? "" : "s"} in the next 24 hours · your time (${HOME_LABEL})`;

  try {
    await notifyMeetingDigest(heading, lines);
  } catch (err) {
    // Reported, never thrown: this runs on the meetings tick, and a Telegram
    // hiccup must not fail a job that also syncs Cal.com.
    console.error("Meeting digest failed:", err);
    await db.execute(sql`delete from meeting_digest_sent where sent_on = ${date}`);
    return { meetings: meetings.length, sent: false };
  }

  return { meetings: meetings.length, sent: true };
}
