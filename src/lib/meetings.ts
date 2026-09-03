import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";
import { callScope, type CurrentUser } from "@/lib/session";
import { callRegionOf, statsRegionOf } from "@/lib/users";
import { statsZone } from "@/lib/stats-zones";
import { pushConfigured, pushToUser } from "@/lib/push";
import {
  bookingPhoneKey,
  calConfigured,
  calEventFilter,
  listCalBookings,
  type CalBooking,
} from "@/lib/cal";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/**
 * Narrow a query to the niches one person owns.
 *
 * The same rule the rest of the calling side runs on, and the same helper
 * shape — `lib/calls.ts` keeps its own copy private, so this is the one
 * duplication rather than exporting it and inviting a caller to pass the
 * wrong alias. Expects `call_list` aliased as `cl`.
 *
 * A meeting matched to no lead belongs to no niche, so it is nobody's under
 * this test and only an admin sees it. That is the right way round: an
 * unlinked booking is a data problem for whoever can fix it, not work for a
 * caller who cannot tell whose prospect it is.
 */
const ownedBy = (ownerId?: number) =>
  ownerId === undefined ? sql`` : sql`and cl.assigned_user_id = ${ownerId}`;

/* ------------------------------------------------------------------ *
 * Sync
 * ------------------------------------------------------------------ */

export type MeetingSyncResult = {
  /** Why nothing ran, when nothing did. Reported rather than thrown: an
   *  unconfigured Cal.com must leave every calling screen exactly as it was. */
  skipped?: "unconfigured" | "no-event-type";
  seen: number;
  /** Bookings that were not already in the table. Tracked so the manual
   *  refresh can say "1 new meeting" rather than a spinner and nothing —
   *  every other count here is the same on a tick that changed nothing. */
  created: number;
  matched: number;
  unmatched: number;
  cancelled: number;
  /** More bookings existed than one page holds. Said out loud so a run that
   *  silently synced the first hundred cannot look like a complete one. */
  hasMore: boolean;
  error?: string;
};

type Candidate = {
  id: number;
  phoneKey: string | null;
  email: string | null;
  /** The lead's latest `demo_booked` call, if it has one. Used both to break
   *  ties between leads sharing a number and to hang the meeting off the call
   *  that booked it. */
  callId: number | null;
  bookedAt: string | null;
};

/**
 * Find every lead a batch of bookings might belong to, in two queries.
 *
 * Phone first and email second, because phone is the key the whole calling
 * side dedupes on and an email is optional there. Both are needed: the phone
 * comes out of a free-text note a caller could have edited on the Cal.com
 * page, and when that fails the address they typed into the booking form is
 * the other thing we know about them.
 */
async function findCandidates(
  phoneKeys: string[],
  emails: string[],
): Promise<Candidate[]> {
  if (phoneKeys.length === 0 && emails.length === 0) return [];

  /**
   * A parameterised `in` list.
   *
   * Every value here came off the Cal.com API — an attendee types their own
   * email into that form — so none of it may reach the statement as text.
   * `sql.join` binds each one as its own parameter. An empty list renders
   * `(null)`, which matches nothing rather than being a syntax error.
   */
  const list = (values: string[]) =>
    values.length
      ? sql`(${sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        )})`
      : sql`(null)`;

  const rows = (await db.execute(sql`
    select l.id, l.phone_key, lower(l.email) as email,
      booked.id as call_id, booked.called_at as booked_at
    from call_lead l
    -- The call that booked it, when there is one. Latest wins: a lead
    -- re-booked after a no-show has two, and the meeting on the calendar
    -- belongs to the most recent.
    left join lateral (
      select c.id, c.called_at from "call" c
      where c.call_lead_id = l.id and c.outcome = 'demo_booked'
      order by c.called_at desc, c.id desc
      limit 1
    ) booked on true
    where l.duplicate_of_lead_id is null
      and (
        l.phone_key in ${list(phoneKeys)}
        or lower(l.email) in ${list(emails)}
      )
  `)) as Row[];

  return rows.map((r) => ({
    id: n(r.id),
    phoneKey: (r.phone_key as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    callId: r.call_id === null ? null : n(r.call_id),
    bookedAt: iso(r.booked_at),
  }));
}

/** Between two leads with the same number, the one that actually booked a
 *  demo wins, and the most recent booking breaks a remaining tie. */
function best(a: Candidate | undefined, b: Candidate): Candidate {
  if (!a) return b;
  if (Boolean(a.bookedAt) !== Boolean(b.bookedAt)) return a.bookedAt ? a : b;
  return (b.bookedAt ?? "") > (a.bookedAt ?? "") ? b : a;
}

/**
 * Pull the calendar and write what changed.
 *
 * Runs on the worker's five-minute tick. Every booking is upserted on its
 * Cal.com uid, so the same meeting seen three hundred times a day stays one
 * row, and a reschedule is a change to `start_at` rather than a new row —
 * which is what re-arms the chase, since a follow-up is recorded against the
 * time it was made for.
 */
export async function syncMeetings(): Promise<MeetingSyncResult> {
  const empty = {
    seen: 0,
    created: 0,
    matched: 0,
    unmatched: 0,
    cancelled: 0,
    hasMore: false,
  };
  if (!calConfigured()) return { ...empty, skipped: "unconfigured" };
  // Fail closed. That Cal.com account carries the voice agent's bookings and
  // several clients' event types, and syncing all of it into this CRM would
  // be both noise and other people's business.
  if (!calEventFilter()) return { ...empty, skipped: "no-event-type" };

  let bookings: CalBooking[];
  let hasMore: boolean;
  try {
    ({ bookings, hasMore } = await listCalBookings());
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  const keyed = bookings.map((b) => ({
    booking: b,
    phoneKey: bookingPhoneKey(b),
    email: b.attendeeEmail?.toLowerCase() ?? null,
  }));

  const candidates = await findCandidates(
    [...new Set(keyed.map((k) => k.phoneKey).filter((v): v is string => !!v))],
    [...new Set(keyed.map((k) => k.email).filter((v): v is string => !!v))],
  );

  const byPhone = new Map<string, Candidate>();
  const byEmail = new Map<string, Candidate>();
  for (const c of candidates) {
    if (c.phoneKey) byPhone.set(c.phoneKey, best(byPhone.get(c.phoneKey), c));
    if (c.email) byEmail.set(c.email, best(byEmail.get(c.email), c));
  }

  const result = { ...empty, hasMore, seen: bookings.length };

  for (const { booking, phoneKey, email } of keyed) {
    const phoneHit = phoneKey ? byPhone.get(phoneKey) : undefined;
    const emailHit = email ? byEmail.get(email) : undefined;
    const lead = phoneHit ?? emailHit ?? null;
    const matchedBy = phoneHit ? "phone" : emailHit ? "email" : null;

    if (lead) result.matched += 1;
    else result.unmatched += 1;
    if (booking.status === "cancelled") result.cancelled += 1;

    const written = (await db.execute(sql`
      insert into call_meeting (
        cal_booking_uid, cal_booking_id, call_lead_id, call_id, matched_by,
        start_at, end_at, status, title,
        attendee_name, attendee_email, attendee_tz, meeting_url, synced_at
      ) values (
        ${booking.uid}, ${booking.id}, ${lead?.id ?? null},
        ${lead?.callId ?? null}, ${matchedBy},
        ${booking.startAt}, ${booking.endAt}, ${booking.status}, ${booking.title},
        ${booking.attendeeName}, ${booking.attendeeEmail}, ${booking.attendeeTz},
        ${booking.meetingUrl}, now()
      )
      on conflict (cal_booking_uid) do update set
        cal_booking_id = excluded.cal_booking_id,
        -- A link once made is kept. Matching reads a phone number out of a
        -- free-text note, so a prospect or a caller editing that note on the
        -- Cal.com page would otherwise unlink a meeting that was correctly
        -- attached days ago.
        call_lead_id = coalesce(excluded.call_lead_id, call_meeting.call_lead_id),
        call_id = coalesce(excluded.call_id, call_meeting.call_id),
        matched_by = coalesce(excluded.matched_by, call_meeting.matched_by),
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        status = excluded.status,
        title = excluded.title,
        attendee_name = excluded.attendee_name,
        attendee_email = excluded.attendee_email,
        attendee_tz = excluded.attendee_tz,
        meeting_url = excluded.meeting_url,
        synced_at = now()
      -- Postgres sets xmax to the locking transaction on an updated row and
      -- leaves it 0 on a freshly inserted one, which is the only way an
      -- upsert can say which of the two it just did.
      returning (xmax = 0) as inserted
    `)) as Row[];
    if (written[0]?.inserted === true) result.created += 1;
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export type MeetingFollowupResult =
  | "confirmed"
  | "no_answer"
  | "rescheduled"
  | "cancelled";

export type Meeting = {
  id: number;
  startAt: string;
  endAt: string | null;
  status: string;
  title: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  /** The prospect's own zone, straight off the booking. What the SOP used to
   *  make the caller work out by hand before saying a time back to them. */
  attendeeTz: string | null;
  meetingUrl: string | null;

  /** Null for a booking that matched no lead — see `ownedBy`. */
  leadId: number | null;
  company: string | null;
  phone: string | null;
  listName: string | null;
  /** Why this number may not be rung, or null. Blocks the clipboard as well
   *  as any dial button, exactly as it does everywhere else. */
  dncBlock: string | null;
  /** Who logged the `demo_booked` call. Shown to admins only, like the
   *  callbacks diary shows who promised the call. */
  bookedBy: string | null;
  /** When that call happened. */
  bookedAt: string | null;
  /** The notes off that call — the handover from whoever booked it to
   *  whoever takes the demo, and usually the only one there is. */
  bookingNotes: string | null;
  /** Its transcript, when one has already been made. Null is the ordinary
   *  case: transcription is billed per minute and happens on request. */
  bookingTurns: TranscriptTurn[] | null;

  /**
   * Owed a chase call: the meeting is today or tomorrow in this screen's
   * clock, it has not been called off, and nobody has chased it *for this
   * time*. A reschedule moves the time and so re-arms it by itself.
   */
  needsChase: boolean;
  followup: {
    result: MeetingFollowupResult;
    at: string;
    byName: string | null;
  } | null;
};

/**
 * How far ahead a meeting starts being chased.
 *
 * One day, so the rule reads exactly as it was given: ring them the day
 * before or on the day itself. Counted in calendar days in the reader's own
 * clock rather than in hours, because "tomorrow" is what a person acts on —
 * a flat 24-hour window would leave a 5pm meeting tomorrow unflagged all of
 * this morning, which is precisely when there is time to make the call.
 */
const CHASE_DAYS_AHEAD = 1;

/** Meetings that have started are kept on the screen for this long, so the
 *  one at 10am is still there at noon when somebody wonders how it went. */
const KEEP_AFTER_START_HOURS = 12;

const meetingSelect = sql`
  m.id, m.start_at, m.end_at, m.status, m.title,
  m.attendee_name, m.attendee_email, m.attendee_tz, m.meeting_url,
  l.id as lead_id, l.company, l.name as lead_name, l.phone,
  l.dnc_status, l.dnc_checked_at,
  cl.name as list_name,
  (select u.name from app_user u where u.id = bc.user_id) as booked_by,
  -- What was actually said on the call that won this meeting. Read before
  -- ringing to confirm, and before the demo itself: the caller who booked it
  -- is often not the founder taking it, and the notes are the only handover
  -- there is.
  bc.notes as booking_notes,
  bc.called_at as booked_at,
  -- Its recording's transcript, if somebody has already paid for one. Never
  -- transcribed on demand from here: that is billed per minute and belongs
  -- behind the button on the recording sheet that already does it.
  (
    select cr.transcript_turns from call_recording cr
    where cr.call_session_id = bc.telnyx_session_id
    order by cr.id limit 1
  ) as booking_turns,
  f.result as followup_result, f.created_at as followup_at,
  f.by_name as followup_by
`;

/** The chase state, as one expression: four screens must not disagree about
 *  what is owed, the same reason `CALLBACK_DUE` is written once. */
const needsChase = (tz: string) => sql`
  m.status = 'accepted'
  and m.start_at > now()
  -- The cast on the parameter is load-bearing. A bare placeholder makes
  -- adding to a date ambiguous -- "operator is not unique: date + unknown"
  -- -- because Postgres cannot tell an integer's worth of days from an
  -- interval when neither side of the operator says which it is.
  and (m.start_at at time zone ${tz})::date
      <= (now() at time zone ${tz})::date + ${CHASE_DAYS_AHEAD}::int
  and f.id is null
`;

/** The latest chase made against the meeting's *current* time. Pinned to
 *  `for_start_at` so a rescheduled meeting comes back onto the list. */
const latestFollowup = sql`
  left join lateral (
    select fu.id, fu.result, fu.created_at,
      (select u.name from app_user u where u.id = fu.user_id) as by_name
    from call_meeting_followup fu
    where fu.meeting_id = m.id and fu.for_start_at = m.start_at
    order by fu.created_at desc, fu.id desc
    limit 1
  ) f on true
`;

const joins = sql`
  left join call_lead l on l.id = m.call_lead_id
  left join call_list cl on cl.id = l.call_list_id
  left join "call" bc on bc.id = m.call_id
  ${latestFollowup}
`;

function toMeeting(r: Row): Meeting {
  const phone = (r.phone as string | null) ?? null;
  return {
    id: n(r.id),
    startAt: iso(r.start_at)!,
    endAt: iso(r.end_at),
    status: String(r.status),
    title: (r.title as string | null) ?? null,
    attendeeName: (r.attendee_name as string | null) ?? null,
    attendeeEmail: (r.attendee_email as string | null) ?? null,
    attendeeTz: (r.attendee_tz as string | null) ?? null,
    meetingUrl: (r.meeting_url as string | null) ?? null,
    leadId: r.lead_id === null ? null : n(r.lead_id),
    // Directory scrapes file the business in `company`; a contact list may
    // only have a person. Falling back keeps the row identifiable either way.
    company:
      (r.company as string | null) ||
      (r.lead_name as string | null) ||
      null,
    phone,
    listName: (r.list_name as string | null) ?? null,
    dncBlock: phone
      ? dncBlockReason(
          {
            dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
            dncCheckedAt: iso(r.dnc_checked_at),
          },
          dialCountry(phone),
        )
      : null,
    bookedBy: (r.booked_by as string | null) ?? null,
    bookedAt: iso(r.booked_at),
    bookingNotes: (r.booking_notes as string | null) ?? null,
    bookingTurns: (r.booking_turns as TranscriptTurn[] | null) ?? null,
    needsChase: r.needs_chase === true,
    followup: r.followup_result
      ? {
          result: r.followup_result as MeetingFollowupResult,
          at: iso(r.followup_at)!,
          byName: (r.followup_by as string | null) ?? null,
        }
      : null,
  };
}

/**
 * The meetings diary: what is coming up, soonest first.
 *
 * Built to be read the way the callbacks diary is — once a day, top to
 * bottom, and empty by the end of it. Cancelled meetings stay on it while
 * their slot is still in the future, because "they called it off" is the most
 * important thing this screen can tell somebody and a row that simply
 * vanished would read as a bug.
 */
export async function getMeetings(
  ownerId?: number,
  tz: string = "America/New_York",
): Promise<Meeting[]> {
  const rows = (await db.execute(sql`
    select ${meetingSelect}, (${needsChase(tz)}) as needs_chase
    from call_meeting m
    ${joins}
    where m.start_at > now() - make_interval(hours => ${KEEP_AFTER_START_HOURS})
      and (m.status = 'accepted' or m.start_at > now())
      ${ownedBy(ownerId)}
    order by m.start_at asc, m.id asc
  `)) as Row[];

  return rows.map(toMeeting);
}

/**
 * How many chases are owed — the sidebar badge.
 *
 * Cached for the reason `countCallbacksDue` and `countUnreadReplies` are: the
 * sidebar and `PageShell` both ask while rendering one page.
 */
export const countMeetingsToChase = cache(
  async (ownerId?: number, tz: string = "America/New_York"): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(m.id) as n
      from call_meeting m
      ${joins}
      where (${needsChase(tz)}) ${ownedBy(ownerId)}
    `)) as Row[];
    return n(row?.n);
  },
);

/**
 * The badge, for whoever is signed in.
 *
 * The sidebar and `PageShell` both need it while rendering one page and both
 * would otherwise have to repeat the zone resolution, which is the sort of
 * duplication that ends with two screens disagreeing about what day it is.
 * The counting query underneath is `cache()`d, so this costs one round trip.
 */
export async function countMeetingsToChaseFor(
  me: CurrentUser | null,
): Promise<number> {
  const zone = statsZone(
    (await statsRegionOf(me?.id)) ?? (await callRegionOf(me?.id)),
  );
  return countMeetingsToChase(callScope(me), zone.tz);
}

/* ------------------------------------------------------------------ *
 * Reminders
 * ------------------------------------------------------------------ */

/** Not before this hour in the person's own clock. A reminder that arrives at
 *  4am is a reminder somebody turns off. */
const REMINDER_FROM_HOUR = 8;
/** Nor after it. */
const REMINDER_UNTIL_HOUR = 19;

/**
 * When each meeting is reminded about, as hours before it starts.
 *
 * Two, matching what the SOP asks for: ring them the day before, or on the
 * day. `same_day` is four hours out rather than one, because the point is to
 * catch a prospect who has forgotten while there is still time for them to
 * rearrange their morning.
 *
 * Ordered most urgent first — `dueOffsets` relies on it.
 */
const REMINDER_OFFSETS = [
  { kind: "same_day" as const, hoursBefore: 4 },
  { kind: "day_before" as const, hoursBefore: 24 },
];

export type ReminderResult = {
  skipped?: "unconfigured";
  /** Unconfirmed meetings still ahead that were examined this tick. */
  considered: number;
  /** Meetings that had a reminder fall due and got one. */
  sent: number;
  /** Notifications that reached a browser. More than `sent` when somebody has
   *  registered a laptop and a phone. */
  deliveries: number;
  /** Due, but nobody to tell: the niche is unassigned or its owner has no
   *  browser registered. Reported rather than silent, because "no reminders
   *  went out today" otherwise looks identical to "nothing was due". */
  unreachable: number;
};

/** Their local date as YYYY-MM-DD and the hour on their clock. Both come off
 *  `Intl` rather than arithmetic so daylight saving is the zone database's
 *  problem — Eastern and London both have it, and this is the kind of code
 *  that would otherwise be an hour wrong twice a year. */
function localHour(tz: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      // h23 rather than hour12:false, which renders midnight as 24 in some
      // locales and would put the gate an hour out.
      hourCycle: "h23",
    }).format(now),
  );
}

/** How the meeting time reads to the person being told about it. */
function whenPhrase(startAt: Date, tz: string, now: Date): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(startAt);

  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 24 * 3600_000));
  const on = day(startAt);
  if (on === today) return `today at ${time}`;
  if (on === tomorrow) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(startAt)} at ${time}`;
}

/**
 * Which offsets have come due for a meeting, most urgent first.
 *
 * All of them are returned, not just the nearest, because every one that has
 * passed must be claimed: a demo booked two hours before it starts has *both*
 * offsets already behind it, and claiming only the urgent one would leave the
 * day-before reminder to fire on the next tick — a second notification about a
 * meeting that has by then already happened.
 */
function dueOffsets(startAt: Date, now: Date) {
  return REMINDER_OFFSETS.filter(
    (o) => now.getTime() >= startAt.getTime() - o.hoursBefore * 3600_000,
  );
}

/**
 * Remind about each meeting at fixed points before it.
 *
 * Runs on the same five-minute tick as the sync. A reminder is *claimed* by an
 * insert into `meeting_reminder_sent` rather than decided by a check, because
 * two overlapping ticks can both pass a check but only one can win a unique
 * index. The row is written before the push goes out, so a failure costs one
 * missed reminder rather than a loop of them.
 *
 * Quiet hours are honoured and deliberately do *not* claim: a reminder falling
 * due at 3am is left for the tick after the window opens, rather than burned.
 */
export async function sendMeetingReminders(
  now: Date = new Date(),
): Promise<ReminderResult> {
  const empty = { considered: 0, sent: 0, deliveries: 0, unreachable: 0 };
  if (!pushConfigured()) return { ...empty, skipped: "unconfigured" };

  // Everybody who could be told anything, fetched once.
  const subscribers = (await db.execute(sql`
    select distinct u.id, u.role, u.stats_region, u.call_region
    from app_user u
    join push_subscription ps on ps.user_id = u.id
    where u.active
  `)) as Row[];
  if (subscribers.length === 0) return empty;

  const byId = new Map(subscribers.map((u) => [n(u.id), u]));
  const admins = subscribers.filter((u) => u.role === "admin").map((u) => n(u.id));

  // Unconfirmed meetings still ahead of us. A confirmed one needs no nudge,
  // and `latestFollowup` is pinned to the current start_at, so a rescheduled
  // meeting counts as unconfirmed again — which is the intent.
  const meetings = (await db.execute(sql`
    select m.id, m.start_at,
      coalesce(l.company, l.name, m.attendee_name) as who,
      cl.assigned_user_id as owner_id
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    ${latestFollowup}
    where m.status = 'accepted'
      and m.start_at > now()
      and f.id is null
  `)) as Row[];

  const result = { ...empty, considered: meetings.length };

  for (const m of meetings) {
    const id = n(m.id);
    const startAt = new Date(m.start_at as string);
    const due = dueOffsets(startAt, now);
    if (due.length === 0) continue;

    // Whose meeting it is, and who to tell if that fails.
    //
    // The owner of the niche first: the chase call is their job. Everything
    // else falls to the admins — an unassigned niche, an unlinked booking, or
    // an owner who has simply never turned reminders on. That last case is the
    // one worth spelling out: a caller who never pressed the button would
    // otherwise mean a booked meeting nobody is reminded about at all, which
    // is the exact failure this feature exists to prevent. Better a founder
    // hears about it than no one does.
    const ownerId = m.owner_id === null ? null : n(m.owner_id);
    const targets =
      ownerId !== null && byId.has(ownerId) ? [ownerId] : admins;

    if (targets.length === 0) {
      result.unreachable += 1;
      continue;
    }

    for (const userId of targets) {
      const who = byId.get(userId)!;
      const zone = statsZone(who.stats_region ?? who.call_region);
      const hour = localHour(zone.tz, now);
      // Left unclaimed on purpose: a reminder that comes due at 3am should go
      // out when the window opens, not be silently consumed.
      if (hour < REMINDER_FROM_HOUR || hour >= REMINDER_UNTIL_HOUR) continue;

      // Claim every offset that has passed, so an older one cannot fire later
      // as a second notification about the same meeting.
      let claimedAny = false;
      for (const offset of due) {
        const claimed = (await db.execute(sql`
          insert into meeting_reminder_sent (meeting_id, kind, for_start_at, user_id)
          values (${id}, ${offset.kind}, ${m.start_at as string}, ${userId})
          on conflict (meeting_id, kind, for_start_at) do nothing
          returning id
        `)) as Row[];
        if (claimed.length > 0) claimedAny = true;
      }
      if (!claimedAny) continue;

      const deliveries = await pushToUser(userId, {
        title: `${(m.who as string | null) ?? "A meeting"} — ${whenPhrase(startAt, zone.tz, now)}`,
        body: "Ring them to confirm they are still coming.",
        url: "/meetings",
        // Tagged per meeting, so two different meetings stack as two
        // notifications while a repeat about one replaces itself.
        tag: `cylrm-meeting-${id}`,
      });

      result.sent += 1;
      result.deliveries += deliveries;
    }
  }

  return result;
}

/** One meeting, scoped exactly as the list is: a caller asking for a meeting
 *  on somebody else's niche gets the same nothing as one that never existed. */
export async function getMeeting(
  id: number,
  ownerId?: number,
): Promise<Meeting | null> {
  const rows = (await db.execute(sql`
    select ${meetingSelect}, false as needs_chase
    from call_meeting m
    ${joins}
    where m.id = ${id} ${ownedBy(ownerId)}
    limit 1
  `)) as Row[];
  return rows[0] ? toMeeting(rows[0]) : null;
}
