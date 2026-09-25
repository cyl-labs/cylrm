import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notAnsweredYet } from "@/lib/attendance-sql";
import { notificationsConfigured, notifyMeetingDigest } from "@/lib/notify";
// No cycle: `lib/calls` does not import this module, and `call-time` is Intl
// and nothing else.
import { leadZone } from "@/lib/calls";
import { prospectZone, theirClock } from "@/lib/call-time";

/**
 * One Telegram message each morning: the demos coming up.
 *
 * Asked for on 2026-09-18 as "what meetings I have for the day, so I can have
 * a rough overview", separate from the per-meeting reminders a day and half an
 * hour before. Those say "this one is about to start"; this one is the list
 * read with a coffee.
 *
 * **It looks three days ahead rather than at the founders' calendar day**, and
 * that is the whole design decision. The demos run through the US afternoon,
 * which is the middle of the night in Singapore: a list of "today" on that
 * clock would carry the ones that finished at 3am and miss tonight's entirely,
 * since a Friday afternoon in New York is a Saturday morning here. Three days
 * covers tonight's shift and the two after it — at a demo a day, a single
 * day's window reported "nothing" on most evenings while three were booked.
 *
 * Sent to the founders' chat — the one `lib/notify.ts` already reports email
 * replies to — so nothing has to be installed or switched on. Unset Telegram
 * settings mean it does nothing, like everything else in that module.
 */

/**
 * Seven in the evening, where the founders are.
 *
 * It was 9:30 in the morning for a day, which read well and was the wrong hour
 * for this floor: the demos run between one and six in the morning here, so by
 * half past nine they are finished and the next US day's are still 24 hours
 * out. Eight in the evening is the hour before the US day opens — the list
 * arrives while there is still time to act on it.
 */
const DIGEST_HOUR = 19;
/** 7pm since 2026-09-25, at the founders' request. It was 8:30pm from
 *  2026-09-19, asked for alongside dropping the day-before alert: with that
 *  gone this is the only thing that says what tomorrow holds. */
const DIGEST_MINUTE = 0;

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
/** The same clock, for the half-hour meeting alert — both land in one chat, so
 *  both must name the same hour. See `foundersZone` in `lib/meetings.ts` for
 *  what happened while they did not. */
export const DIGEST_TZ = HOME_TZ;
/** What that clock is called in the message. Moves with `HOME_TZ`. */
const HOME_LABEL = process.env.DIGEST_TZ ? "local time" : "SGT";
/**
 * How far ahead it looks: tonight's US day and the two after it. Wide enough
 * that a quiet night still says what is coming, narrow enough to read at a
 * glance.
 */
const LOOKAHEAD_HOURS = 72;
/**
 * The window shuts before midnight. A worker down at eight should still
 * deliver late — the evening is the evening — but the claim rolls with the
 * local date, so a message at one in the morning would be the next day's.
 */
const LATEST_HOUR = 23;

type Row = Record<string, unknown>;

export type MeetingDigestResult = {
  skipped?: "unconfigured" | "not-due" | "already-sent";
  /** Meetings in the window, as the message reported them. */
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

/**
 * "Fri 9:00 PM" — the weekday always, never "today" or "tonight".
 *
 * This is sent at eight in the evening and most of what it lists happens after
 * midnight, so a relative word would be wrong as often as right: a demo at one
 * in the morning is tonight's shift and tomorrow's date.
 */
function at(start: Date, tz: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(start);
  return `${weekday} ${clock(start, tz)}`;
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
    select m.start_at, m.attendee_tz, z.tz as lead_tz,
      coalesce(l.company, l.name, m.attendee_name) as who,
      u.name as booked_by
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call c on c.id = m.call_id
    left join app_user u on u.id = c.user_id
    ${leadZone}
    where m.status = 'accepted'
      and ${notAnsweredYet("m")}
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
    // Where the business is first, the zone the booking form was open in
    // second — and their weekday with it when their date is not ours. This
    // message is read at eight in the evening about demos that happen after
    // midnight, so "their time" without a day was the one number on it that
    // could be read as the wrong day and look perfectly ordinary.
    const their = theirClock(
      start,
      prospectZone(
        typeof m.lead_tz === "string" ? m.lead_tz : null,
        typeof m.attendee_tz === "string" ? m.attendee_tz : null,
      ),
      tz,
    );
    const theirs = their === null ? "" : ` (${their} their time)`;
    const who = (m.who as string | null) ?? "A meeting";
    const by = m.booked_by ? ` · booked by ${m.booked_by as string}` : "";
    return `• ${at(start, tz)}: ${who}${theirs}${by}`;
  });

  // The clock is named once: these arrive in the small hours here, and a bare
  // "9:00 PM" is the one thing on the message that could be read as the
  // prospect's time.
  const heading =
    meetings.length === 0
      ? "No demos in the next 3 days"
      : `${meetings.length} demo${meetings.length === 1 ? "" : "s"} in the next 3 days · your time (${HOME_LABEL})`;

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
