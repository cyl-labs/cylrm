import { cache } from "react";
import { sql } from "drizzle-orm";
import { countFounderCallsDue } from "@/lib/founder-calls";
import { db } from "@/db";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry, e164 } from "@/lib/phone";
// The meeting row dials in place now, so it needs what the dial card needs.
// No cycle: the calls module does not import this one.
import { didFor, getDids, leadZone, type DidMap } from "@/lib/calls";
import { callScope, type CurrentUser } from "@/lib/session";
import { callRegionOf, statsRegionOf } from "@/lib/users";
import { statsZone } from "@/lib/stats-zones";
import { pushConfigured, pushToUser } from "@/lib/push";
import { notificationsConfigured, notifyMeeting } from "@/lib/notify";
// No cycle: the digest imports the notifier and the database, never this file.
import { DIGEST_TZ } from "@/lib/meeting-digest";
import {
  bookingPhoneKey,
  calConfigured,
  calEventFilter,
  followUpSlug,
  listCalBookings,
  type CalBooking,
} from "@/lib/cal";
import { prospectZone, theirClock } from "@/lib/call-time";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** A gap this wide between one call ending and the next starting is a
 *  different conversation, not a redial. See `clusterDemoRecordings`. */
const DEMO_REDIAL_GAP_MINUTES = 20;

/**
 * Which of the recordings found in a meeting's (deliberately wide) matching
 * window actually belong to the demo, rather than to something else rung on
 * the same business afterward.
 *
 * Groups the recordings by the gap between one call ending and the next
 * starting — under `DEMO_REDIAL_GAP_MINUTES` reads as "got disconnected,
 * called straight back", anything wider is a separate event. Only the group
 * containing the single longest recording survives, which is the same
 * recording `demo_recording_id` picked on its own before this — a no-show
 * followed by an unrelated call three hours later still correctly finds
 * whichever of the two is the real demo, because that is still "longest
 * wins", just applied to a group of one instead of to every row in the
 * window.
 *
 * Pure and synchronous on purpose: `getMeetings` renders every row on the
 * screen at once, and this runs once per row over what is already an array
 * in memory rather than another round trip to Postgres.
 */
export function clusterDemoRecordings(
  recordings: { recordingId: string; durationMs: number | null; startedAt: string }[],
): { recordingId: string; durationMs: number | null; startedAt: string }[] {
  if (recordings.length <= 1) {
    return recordings.map((r) => ({
      recordingId: r.recordingId,
      durationMs: r.durationMs,
      startedAt: r.startedAt,
    }));
  }

  const sorted = [...recordings].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const groups: (typeof sorted)[] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const gapMs = prev
      ? new Date(r.startedAt).getTime() -
        (new Date(prev.startedAt).getTime() + (prev.durationMs ?? 0))
      : Infinity;
    if (prev && gapMs <= DEMO_REDIAL_GAP_MINUTES * 60_000) {
      last.push(r);
    } else {
      groups.push([r]);
    }
  }

  // The group holding the longest single call, ties broken toward the
  // earlier group — the same "order by duration desc, id desc" the old
  // single-recording query used, restated over groups instead of rows.
  let best = groups[0];
  let bestMax = Math.max(...best.map((r) => r.durationMs ?? 0));
  for (const g of groups.slice(1)) {
    const max = Math.max(...g.map((r) => r.durationMs ?? 0));
    if (max > bestMax) {
      best = g;
      bestMax = max;
    }
  }

  return best.map((r) => ({
    recordingId: r.recordingId,
    durationMs: r.durationMs,
    startedAt: r.startedAt,
  }));
}

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
 * row.
 *
 * A reschedule is **a new booking with a new uid**, not a changed `start_at`.
 * This said the opposite until 2026-09-19, when the account turned out to hold
 * a counter-example: `6CgQzWi6ACgBh3v72Biww2` went `cancelled` carrying
 * `rescheduledToUid`, and `eXxWooZqXRnFjzsaqPBhPh` is the live booking at the
 * new time. Nothing here had to change for it — the old row goes cancelled and
 * the new one arrives with the notes line intact, so it matches the same lead —
 * but the consequence is worth knowing: a moved meeting leaves two rows, and
 * the reminders re-arm because the new row has no claims rather than because
 * `for_start_at` stopped matching. That column still earns its place for a
 * booking whose time changes where it stands.
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

  // Read once rather than per booking: it is an environment lookup and a
  // string split, and this loop runs over every booking on the account.
  const followUp = followUpSlug();

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
        attendee_name, attendee_email, attendee_phone, attendee_tz,
        meeting_url, kind, synced_at
      ) values (
        ${booking.uid}, ${booking.id}, ${lead?.id ?? null},
        ${lead?.callId ?? null}, ${matchedBy},
        ${booking.startAt}, ${booking.endAt}, ${booking.status}, ${booking.title},
        ${booking.attendeeName}, ${booking.attendeeEmail}, ${booking.attendeePhone},
        ${booking.attendeeTz}, ${booking.meetingUrl},
        ${followUp && booking.eventTypeSlug === followUp ? "follow_up" : "demo"},
        now()
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
        -- coalesce: a payload without the field must not blank a number the
        -- prospect gave, the same rule the recording numbers follow.
        attendee_phone = coalesce(excluded.attendee_phone, call_meeting.attendee_phone),
        attendee_tz = excluded.attendee_tz,
        meeting_url = excluded.meeting_url,
        kind = excluded.kind,
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

/** A contract already drafted into DocuSeal for a meeting. Carries the slug
 *  rather than a URL, so moving instances does not orphan the links. */
export type MeetingContract = {
  kind: "trial" | "paid";
  senderSlug: string;
  /** The client's own link. Carried so the screen can open the document as
   *  they will see it — the sender's link shows Cyl Labs' side, which is not
   *  what anybody wants to check before sending one out. */
  signerSlug: string;
  packageId: string | null;
  termId: string | null;
  /** When the client signed, or null. Recorded by `/api/contracts/signed` off
   *  the DocuSeal webhook — the chip is otherwise identical whether a contract
   *  is untouched or fully executed. */
  signedAt: string | null;
};

export type Meeting = {
  id: number;
  /** Cal.com's own handle for the booking. Read here so a row can offer to
   *  move the meeting: `rescheduleUid` is how Cal.com is told to change this
   *  booking rather than take a second one. */
  calBookingUid: string;
  startAt: string;
  endAt: string | null;
  status: string;
  title: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  /** The prospect's own zone, straight off the booking — which is to say, the
   *  zone the booking *form* was sitting in. Nearly always a caller's own
   *  browser, so it is the weaker of the two. See `prospectZone`. */
  attendeeTz: string | null;
  /** `leadZone`'s answer for this lead: the scraped state, then the area code,
   *  then the Singapore and UK prefixes. The stronger evidence of where the
   *  prospect actually sits, and the one the callbacks diary and the 9-to-5
   *  filter already read them in. Null for a toll-free number, or a booking
   *  that matched no lead. */
  leadTz: string | null;
  meetingUrl: string | null;

  /** What the CRM holds as this business's email. The booking's `attendeeEmail`
   *  is a copy taken when the Cal.com link was opened and can never be edited
   *  afterwards; this one can, so the two drift apart exactly when somebody
   *  notices a mistake. The invite dialog prefills from here. */
  leadEmail: string | null;

  /** Null for a booking that matched no lead — see `ownedBy`. */
  leadId: number | null;
  company: string | null;
  /**
   * The number this row rings, copies and texts: Cal.com's "Best number to
   * call you on" where the prospect gave one, the lead's listed number
   * otherwise.
   *
   * The dial card prefills the booking with the *listed* number and the
   * prospect is asked for the better one, so on 2026-09-18 Call them reached a
   * business's main line while the owner waited on his mobile. The booking had
   * the right number all along.
   */
  phone: string | null;
  /** The lead's own number, when the booking's differs from it — so the row
   *  can say which one it is about to ring. Null when they are the same. */
  listedPhone: string | null;
  /** The company's own site, when the scrape found one. Rendered only through
   *  `websiteHref`, which admits http(s) and nothing else — this came off a
   *  scraped page, and `javascript:` in an href runs on click. */
  website: string | null;
  /** The niche's id, so a row can link straight into the dial card for this
   *  lead. Null on an unlinked booking, which belongs to no list — and so has
   *  no dialler to open. */
  listId: number | null;
  listName: string | null;
  /** The trade, off the lead's list. Prefills "operates a ___ business" on a
   *  contract, which is why it is the niche and not the list's name. */
  niche: string | null;
  /** What has already been drafted for this meeting. Empty is the normal
   *  state; two rows means both agreements are waiting. */
  contracts: MeetingContract[];
  /**
   * Whether somebody has recorded that this demo happened — the answer given on
   * Payroll, which is where the $30 attendance fee is decided.
   *
   * Read here so the row can say it. The two are separate records on purpose:
   * this diary is fed by Cal.com, and "did they turn up" is a founder's
   * judgement that no calendar can make. But a meeting that has been answered
   * is finished business, and a row that looks identical to an unanswered one
   * reads as work still owed.
   */
  attendance: "showed_up" | "no_show" | "invalid" | null;
  /**
   * What happened at the demo, in words.
   *
   * The three statuses answer the question the fee turns on and nothing else.
   * A founder who rings at the booked time and spends five minutes with a
   * receptionist has learned the manager's name and when he is reachable, and
   * before this there was nowhere to put it: the demo call has no call row to
   * hold notes, and the ring-back notes only exist once a no show is marked.
   */
  attendanceNotes: string | null;
  /** Why this number may not be rung, or null. Blocks the clipboard as well
   *  as any dial button, exactly as it does everywhere else. */
  dncBlock: string | null;
  /** Who logged the `demo_booked` call. Shown to admins only, like the
   *  callbacks diary shows who promised the call. */
  bookedBy: string | null;
  /** When the demo was agreed: that call's time, or — for a booking with no
   *  call behind it — when the sync first saw it, which is within minutes.
   *  Null only where neither can be trusted. */
  bookedAt: string | null;
  /** The notes off that call — the handover from whoever booked it to
   *  whoever takes the demo, and usually the only one there is. */
  bookingNotes: string | null;
  /** Its recording, for the same listen-back sheet the call log opens.
   *  Null when the call was made from a handset or never recorded. */
  recordingId: string | null;
  recordingMs: number | null;

  /**
   * The demo itself — the conversation at the booked time, not the cold call
   * that won it. Every recording from *that attempt*, oldest first, not only
   * the longest single call.
   *
   * It was one recording — the longest anywhere in the matching window —
   * until 2026-09-23: "for calls where i call the meeting back multiple
   * times... it only shows one part." A demo that drops and gets redialled is
   * two Telnyx sessions, and picking the longer one silently threw the other
   * away — usually the first half of the actual conversation.
   *
   * The matching window is wide on purpose — see `DEMO_RECORDING_WHERE` — and
   * a lead rung on unrelated business for days afterward (a missed call, a
   * callback chased down) sits inside it alongside the real demo. Returning
   * every match in that window verbatim would have labelled all of it "Demo
   * call 2", "Demo call 3"… — confirmed on `203JUNKIT LLC`, whose window held
   * six recordings spanning three days, five of which were nothing to do with
   * the demo. `clusterDemoRecordings` groups by the gap between one call
   * ending and the next starting, and only the group containing the single
   * longest recording — the same call the old logic picked on its own —
   * survives. A gap under `DEMO_REDIAL_GAP_MINUTES` reads as "got
   * disconnected, called straight back"; anything wider is a different
   * conversation that happens to be about the same business.
   *
   * Matched on the lead's number within a window around `startAt`, because the
   * demo call usually has no `call` row to hang a session id off: a row is
   * written when an outcome is logged, and nobody logs an outcome mid-demo.
   * Empty until `scripts/backfill-recording-numbers.mjs` has run, and empty
   * afterwards for any meeting whose demo was never recorded or never happened.
   */
  demoRecordings: {
    recordingId: string;
    durationMs: number | null;
    startedAt: string;
  }[];

  /**
   * What the row needs to ring them without leaving the screen.
   *
   * The diary used to link to the lead's dial card instead, because the phone
   * only lived there. That stopped being true when the line moved into the app
   * layout, and nobody revisited it -- so a demo meant a redirect, a second
   * press, and an outcome logged on a different screen from the meeting it
   * belonged to. That is exactly how the demo recording ended up attached to
   * nothing.
   *
   * `dialFrom` is the signed-in person's own number, not one chosen by the
   * prospect's country: `getDids` reads `telnyx_did` for whoever is asking and
   * returns it under every country key. Null when they have no number assigned,
   * which is two accounts today -- the row says so rather than hiding the
   * button, since a missing control reads as the phone being broken.
   */
  dialTo: string | null;
  dialFrom: string | null;

  /**
   * The call that booked it, when the meeting is linked to one.
   *
   * What "did they turn up" is recorded against — the same key Payroll uses, so
   * an answer given here and one given there are the same record rather than
   * two that can disagree.
   */
  bookingCallId: number | null;
  /** Already begun. Decided by the database's clock rather than the browser's:
   *  a control that appears on one and not the other is a hydration error. */
  started: boolean;
  /**
   * Starts within a day, in this screen's clock.
   *
   * It used to mean "ring them to confirm"; nobody does that any more, so it
   * only means the demo is nearly here — something coming, not work owed.
   */
  startingSoon: boolean;
  /**
   * They did not turn up, and nobody has rung them back.
   *
   * The only work this screen asks for. Cleared by logging the follow-up,
   * whatever it turned out to be.
   */
  needsRingBack: boolean;
  /** They turned up and the sale is still open — the founders' follow-up calls
   *  are logged from this row, and it stays until one says trial, won or
   *  lost. */
  needsFollowUp: boolean;
  /** "demo" or "follow_up". A follow-up is never asked the attendance
   *  question: the fee belongs to the demo, once per business. */
  kind: "demo" | "follow_up";
  /**
   * A founder moved this meeting to a call back after a no-show (2026-09-24):
   * when, how many times it has gone unanswered, and the note. The row is
   * drawn at this time rather than the booking's. Always null for a caller —
   * the call back is the founders' alone.
   */
  callBack: {
    id: number;
    at: string;
    tries: number;
    notes: string | null;
    /** Its time has come. */
    due: boolean;
    /** Due within the hour, for the calendar's strong colour. */
    soon: boolean;
  } | null;
  followup: {
    result: MeetingFollowupResult;
    at: string;
    byName: string | null;
    /** What the follow-up turned up. The result alone carries none of it —
     *  "moved to another time" does not say to when, or why. */
    notes: string | null;
  } | null;
};

/**
 * How soon a meeting counts as "coming up" for the badge.
 *
 * This used to be the chase window: every booking got a confirmation call the
 * day before. That is gone (2026-09-11). The floor's argument against it was
 * the right one — a prospect who agreed to a slot has not forgotten it, and
 * ringing to ask whether they are still coming hands them an easy moment to say
 * no. Cal.com already emails them a reminder; we stopped adding a phone call on
 * top of it.
 *
 * What is left is a count of what is about to happen, which is the thing a
 * founder actually wants from a diary — not a queue of calls owed.
 */
const SOON_DAYS_AHEAD = 1;

/** Meetings that have started are kept on the screen for this long, so the
 *  one at 10am is still there at noon when somebody wonders how it went. */
const KEEP_AFTER_START_HOURS = 12;

/**
 * How long a demo that happened stays on the screen to be followed up.
 *
 * The founders ring a prospect back after a demo to show them a mock-up, often
 * more than once. The row used to vanish twelve hours after the meeting
 * started, so by the time that call was made there was nothing left to log it
 * against — and the lead sat on "Demo booked" however many times it was
 * chased.
 *
 * Capped rather than open-ended: a demo nobody ever follows up would otherwise
 * sit at the top of this screen for good, which is how a diary stops being
 * read.
 */
const FOLLOW_UP_DAYS = 21;

/**
 * How long a missed demo stays on the diary asking to be rung back.
 *
 * This is the one follow-up call left, and it is deliberately the opposite end
 * of the meeting from the one we removed: chasing somebody *before* a demo
 * hands them a moment to say no, while ringing after they did not turn up is
 * the warmest call of the week — they agreed to a slot four days ago and then
 * something happened. Ask what, and rebook it on the spot.
 *
 * A week, because after that "you missed our call on Tuesday" is a stranger
 * ringing about nothing. It also bounds the list: a no-show nobody ever rang
 * would otherwise sit on the screen forever.
 */
const NO_SHOW_RING_DAYS = 7;

/**
 * Which recordings count as "the demo call" on a meeting row.
 *
 * It was a three-hour window after the booked slot, longest wins. That is the
 * right answer when the demo happens at its time and the wrong one the moment
 * it does not: Pro Junk Removal no-showed at 1am, the founder rang back at
 * 11:30 the next morning and talked for **thirteen minutes**, and the row went
 * on offering the 25-second voicemail from the slot itself. "Make the demo
 * call the longest conversation from when I call them from meetings."
 *
 * So the window runs from half an hour before the slot — Telnyx starts
 * recording as the call connects, which measured 79 seconds early on one live
 * demo — until **the next booking for the same lead**, or now if there is not
 * one. That upper bound is load-bearing rather than tidy: a no-show is
 * routinely rebooked from its own row ("put a new time in while you have
 * them"), and without it the old meeting would show the new meeting's call.
 *
 * The cold call that won the booking is always earlier than the lower bound,
 * so it can never be mistaken for the demo.
 *
 * Longest rather than earliest, unchanged: a slot can hold a failed first
 * attempt of a few seconds, and the conversation is the one worth hearing.
 * Either number, since the row rings the booking's where there is one and
 * demos booked before that was stored were rung on the lead's.
 *
 * Deliberately wide on the far end (see the 2026-09-20 commit that put it
 * there), which is why every match cannot simply be shown as the demo:
 * `clusterDemoRecordings` below is what keeps an unrelated later call out of
 * the demo's own recording list.
 */
const DEMO_RECORDING_WHERE = sql`
  cr.to_number in ('+' || l.phone_key, m.attendee_phone)
  and cr.started_at >= m.start_at - interval '30 minutes'
  and cr.started_at < coalesce(
    (
      select min(m2.start_at) from call_meeting m2
      where m2.call_lead_id = m.call_lead_id
        and m2.id <> m.id
        and m2.status = 'accepted'
        and m2.start_at > m.start_at
    ),
    now() + interval '1 minute'
  )
`;

const meetingSelect = sql`
  m.id, m.cal_booking_uid, m.start_at, m.end_at, m.status, m.title,
  -- The caller's own name typed into the booking form in place of the
  -- prospect's (2026-09-24: Alex booked Jason's Jacksonville Junk Removal as
  -- "Alex"). Cal.com cannot rename an attendee and the sync rewrites this
  -- column, so it is corrected on read: when the booking name is the booking
  -- caller's own, the lead's name is shown instead. Only then — lead names
  -- carry typos of their own ("Vinvent" against a booking's "Vincent").
  case
    when l.name is not null and bc.user_id is not null
      and lower(trim(m.attendee_name)) = (
        select lower(trim(u.name)) from app_user u where u.id = bc.user_id
      )
      then l.name
    else m.attendee_name
  end as attendee_name,
  m.attendee_email, m.attendee_phone, m.attendee_tz,
  m.meeting_url, m.kind,
  -- Where the business actually is, which outranks the zone Cal.com recorded:
  -- that one is the zone the booking form was open in, and the form is a
  -- caller's browser in Singapore. See prospectZone in lib/call-time.ts.
  z.tz as lead_tz,
  l.id as lead_id, l.company, l.name as lead_name, l.phone,
  -- The CRM's own record of the business's email, which is not always the one
  -- on the booking: the booking's is frozen at the moment the Cal.com link was
  -- opened, and this one goes on being corrected afterwards. Where they
  -- disagree, this is nearly always the right one — see the invite dialog.
  l.email as lead_email,
  l.dnc_status, l.dnc_checked_at,
  -- Read before a demo rather than during a cold call: "what do they actually
  -- do" is the question the booking notes cannot answer, and a founder walking
  -- into a call has thirty seconds to look.
  l.website,
  cl.id as list_id,
  cl.name as list_name,
  -- The niche rather than the list name: a split list is called "Movers.2",
  -- which is a filing label, where the niche is the trade itself and so the
  -- thing that reads correctly in "the Client operates a ___ business".
  cl.niche as niche,
  -- What has already been drafted for this meeting, so the row can offer the
  -- contracts rather than a button that would mint a second copy. Aggregated
  -- here rather than fetched per row: the screen renders every meeting at once
  -- and a query each would be a query per booking.
  (
    select coalesce(
      json_agg(
        json_build_object(
          'kind', c.kind,
          'senderSlug', c.sender_slug,
          'signerSlug', c.signer_slug,
          'packageId', c.package_id,
          'termId', c.term_id,
          'signedAt', c.signed_at
        ) order by c.kind
      ),
      '[]'::json
    )
    from call_contract c where c.meeting_id = m.id
  ) as contracts,
  (select u.name from app_user u where u.id = bc.user_id) as booked_by,
  -- The booking call itself. Attendance is keyed on it (one answer per
  -- booking, one fee per business), so the row cannot record what happened at
  -- the meeting without it.
  bc.id as booking_call_id,
  -- What was actually said on the call that won this meeting. Read before the
  -- demo: the caller who booked it is often not the founder taking it, and the
  -- notes are the only handover there is.
  bc.notes as booking_notes,
  -- When it was agreed, which is the question a demo in the diary that nobody
  -- remembers agreeing to actually asks. The booking call's own time normally.
  -- For a booking with no call behind it — made straight off the public link,
  -- or by a founder — the row's own creation stands in: the sync runs every
  -- five minutes, so that is within minutes of the real thing. Guarded on
  -- being before the meeting, since a row backfilled afterwards would
  -- otherwise claim a booking date it cannot know, and no date beats a wrong
  -- one.
  coalesce(
    bc.called_at,
    case when m.created_at < m.start_at then m.created_at end
  ) as booked_at,
  -- Its recording, so the meeting card can offer the same "listen back" the
  -- call log does. Only the id and the length: the audio lives in Telnyx's S3
  -- and a fresh presigned URL is minted per play, which is why one opened a
  -- month later still works.
  (
    select cr.recording_id from call_recording cr
    where cr.call_session_id = bc.telnyx_session_id
    order by cr.id limit 1
  ) as recording_id,
  (
    select cr.duration_ms from call_recording cr
    where cr.call_session_id = bc.telnyx_session_id
    order by cr.id limit 1
  ) as recording_ms,
  -- The demo itself, which is a different call from the one above: that one is
  -- the cold call that won the booking, this is the conversation at the booked
  -- time. Found by number and time rather than by a session id, because the
  -- demo call usually has no call row at all -- a founder mid-demo is talking,
  -- not tapping an outcome, and a row is only written when an outcome is
  -- logged. That is why to_number exists; see the 2026-09-17 migration.
  --
  -- NB: no backticks and no dollar-brace in this comment. A sql template body is
  -- raw text until a backtick or an interpolation opener, so either one inside a
  -- SQL comment breaks the file -- the backtick closes the template, the
  -- interpolation opener starts an expression that is not there. A slash-slash
  -- comment sitting inside an interpolation is lexed properly and is safe; this
  -- is not. Both mistakes were made writing this very block.
  --
  -- The window opens BEFORE the booked time: measured on the live data, Gel
  -- Recycling's demo recording began 79 seconds before start_at, because the
  -- founder rang on the minute and Telnyx started recording as it connected.
  -- Three hours after covers a demo that ran long or started late.
  --
  -- Telnyx stores E.164 and phone_key is bare digits, hence the concatenation.
  -- Either number: the row rings the booking's where there is one, and demos
  -- booked before that was stored were rung on the lead's.
  --
  -- Every recording in the window, oldest first, not only the longest -- a
  -- demo that drops and gets redialled is two Telnyx sessions, and picking
  -- one used to throw the other away, usually the first half of the real
  -- conversation. json_agg, the same way contracts above is aggregated, for
  -- the same reason: the screen renders every meeting at once, and a query
  -- per meeting for its recordings would be a query per row. (No backticks
  -- in here -- this is inside a template literal and one would end the
  -- string, the trap the Drizzle constraint-name gotcha documents.)
  (
    select coalesce(
      json_agg(
        json_build_object(
          'recordingId', cr.recording_id,
          'durationMs', cr.duration_ms,
          'startedAt', cr.started_at
        ) order by cr.started_at asc nulls last, cr.id asc
      ),
      '[]'::json
    )
    from call_recording cr
    where ${DEMO_RECORDING_WHERE}
  ) as demo_recordings,
  f.result as followup_result, f.created_at as followup_at,
  f.by_name as followup_by, f.notes as followup_notes,
  -- Whether a founder has answered "did they turn up" on Payroll.
  --
  -- Only an answer recorded *after* this meeting began can be about it: a lead
  -- re-booked after a no-show carries the old answer, and stamping it on the
  -- new booking would report a meeting as missed before it had happened.
  -- Latest first, so a corrected answer wins.
  (
    select a.status from call_demo_attendance a
    where a.call_lead_id = l.id and a.marked_at >= m.start_at
    order by a.marked_at desc limit 1
  ) as attendance,
  -- What happened, in words. Same row, same ordering as the answer above, so
  -- the note and the status a reader sees always came from the same marking --
  -- two subselects with different sorts could show one meeting's note beside
  -- another's answer.
  (
    select a.notes from call_demo_attendance a
    where a.call_lead_id = l.id and a.marked_at >= m.start_at
    order by a.marked_at desc limit 1
  ) as attendance_notes,
  -- A founder moved this meeting to a call back (2026-09-24). See the cb
  -- lateral in joins, and the founder_call table.
  cb.id as call_back_id, cb.start_at as call_back_at, cb.tries as call_back_tries,
  cb.notes as call_back_notes,
  (cb.start_at <= now()) as call_back_due,
  (cb.start_at <= now() + interval '1 hour') as call_back_soon
`;

/**
 * Starting within a day and still on.
 *
 * Deliberately says nothing about whether anybody has confirmed it: there is no
 * confirmation call any more, so an unconfirmed meeting is not work owed. It is
 * simply a meeting that has not happened yet.
 */
/**
 * Missed, and nobody has rung them back yet.
 *
 * Three facts, and all three have to hold: a founder answered "no show" on
 * Payroll for a booking that had already started, and no follow-up has been
 * logged against this meeting's *current* time. That last clause is what takes
 * the row off the list — logging the ring back is the only way to clear it,
 * which is the same mechanism the callbacks diary clears on.
 *
 * `for_start_at` rather than any follow-up, for the reason it exists: a
 * prospect who no-shows and rebooks arrives as a new booking, and a stale
 * follow-up must not answer for a meeting it was not made about.
 */
const needsRingBack = sql`coalesce(
  -- A follow-up is not the demo, so it never asks for the ring back that a
  -- missed demo asks for, and never earns the attendance fee.
  m.kind = 'demo'
  and m.status = 'accepted'
  and m.start_at < now()
  and m.start_at > now() - make_interval(days => ${NO_SHOW_RING_DAYS}::int)
  and (
    select a.status from call_demo_attendance a
    where a.call_lead_id = l.id and a.marked_at >= m.start_at
    order by a.marked_at desc limit 1
  ) = 'no_show'
  -- Only the lead's latest booking asks. Attendance is recorded per business
  -- rather than per meeting, so a prospect who has booked three times carries
  -- one "no show" answer that every one of those rows would otherwise claim —
  -- live proof on KR Services, which asked to be rung back twice for a single
  -- missed demo. It also closes the row the moment a new time is agreed: once
  -- something later is on the calendar there is nothing left to ring about,
  -- whether or not anybody logged the call that arranged it.
  and not exists (
    select 1 from call_meeting m2
    where m2.call_lead_id = m.call_lead_id
      and m2.id <> m.id
      and m2.status = 'accepted'
      and m2.start_at > m.start_at
  )
  and not exists (
    select 1 from call_meeting_followup fu
    where fu.meeting_id = m.id and fu.for_start_at = m.start_at
  )
  -- A founder moved it to a call back (2026-09-24, founder_call): the ring
  -- back is owed at the call back's time, on the same row, rather than now.
  and not exists (
    select 1 from founder_call fc
    where fc.meeting_id = m.id and fc.created_at >= m.start_at
  ),
  false
)`;

/**
 * Whose ring back it is: the founders' (2026-09-24).
 *
 * A no-show used to be the caller's to ring back — the red note, the "Ring
 * them back" button and a place in their Meetings badge. The founders now
 * follow up every no-show themselves ("I don't want my callers to call them
 * back … for all no shows I'll follow up no matter what"), deciding on the
 * spot when they mark it: a call back on their own calendar, or dead. So for a
 * caller's view — any scoped to one person's niches — nothing is owed.
 */
const ringBackFor = (ownerId?: number) =>
  ownerId === undefined ? needsRingBack : sql`false`;

/** The meeting has an open founders' call back — for a founder's view only,
 *  since a caller's never shows one. Reads `cb` from `joins`. */
const hasCallBack = (ownerId?: number) =>
  ownerId === undefined ? sql`cb.id is not null` : sql`false`;

const startingSoon = (tz: string) => sql`
  m.status = 'accepted'
  and m.start_at > now()
  -- The cast on the parameter is load-bearing. A bare placeholder makes
  -- adding to a date ambiguous -- "operator is not unique: date + unknown"
  -- -- because Postgres cannot tell an integer's worth of days from an
  -- interval when neither side of the operator says which it is.
  and (m.start_at at time zone ${tz})::date
      <= (now() at time zone ${tz})::date + ${SOON_DAYS_AHEAD}::int
`;

/** The latest follow-up made against the meeting's *current* time. Pinned to
 *  `for_start_at` so a rescheduled meeting comes back onto the list. */
const latestFollowup = sql`
  left join lateral (
    select fu.id, fu.result, fu.created_at, fu.notes,
      (select u.name from app_user u where u.id = fu.user_id) as by_name
    from call_meeting_followup fu
    where fu.meeting_id = m.id and fu.for_start_at = m.start_at
    order by fu.created_at desc, fu.id desc
    limit 1
  ) f on true
`;

/**
 * A demo that happened and has not been settled yet.
 *
 * The opposite branch to `needsRingBack`: that one is for a prospect who did
 * not turn up, this is for one who did and is being worked. Both keep a row on
 * the screen past the twelve hours, and a meeting is never both.
 *
 * "Settled" is the lead's latest call saying trial, won or lost. While it
 * still says the booking itself, or a follow-up, there is more to do and the
 * row stays. A correlated subquery per meeting, which is fine here and would
 * not be on `call_lead`: this query returns dozens of rows, not thousands.
 */
const needsFollowUp = sql`coalesce(
  m.kind = 'demo'
  and m.status = 'accepted'
  and m.start_at < now()
  and m.start_at > now() - make_interval(days => ${FOLLOW_UP_DAYS}::int)
  -- Only where they actually turned up. A no-show is the other branch's
  -- business, and an attendance question nobody has answered is not yet a
  -- sale to work.
  and (
    select a.status from call_demo_attendance a
    where a.call_lead_id = l.id and a.marked_at >= m.start_at
    order by a.marked_at desc limit 1
  ) = 'showed_up'
  and (
    select c.outcome::text from "call" c
    where c.call_lead_id = l.id
    order by c.called_at desc, c.id desc limit 1
  ) in ('demo_booked', 'following_up')
  -- Only the lead's latest booking, for the reason the ring-back rule above
  -- documents: attendance is recorded per business, so an older row would
  -- claim the same answer. (No backticks in here: this is inside a template
  -- literal and one would end the string.)
  and not exists (
    select 1 from call_meeting m2
    where m2.call_lead_id = m.call_lead_id
      and m2.id <> m.id
      and m2.status = 'accepted'
      and m2.start_at > m.start_at
  )
, false)`;

/**
 * Still belongs with what is coming up: not started, or started and not yet
 * logged. Logged means the attendance answer ("Log what happened") for a demo,
 * dated after it began — the same rule `attendance` above reads — or a
 * follow-up result against its current time for a follow-up meeting, which is
 * never asked about attendance. Reads `f` from `latestFollowup`, so it only
 * works inside a query built on `joins`.
 */
const stillAhead = sql`(
  m.start_at > now()
  or (
    m.status = 'accepted'
    and m.start_at > now() - make_interval(hours => ${KEEP_AFTER_START_HOURS}::int)
    and case
      when m.kind = 'follow_up' then f.id is null
      else not exists (
        select 1 from call_demo_attendance a
        where a.call_lead_id = l.id and a.marked_at >= m.start_at
      )
    end
  )
)`;

const joins = sql`
  left join call_lead l on l.id = m.call_lead_id
  left join call_list cl on cl.id = l.call_list_id
  left join "call" bc on bc.id = m.call_id
  ${latestFollowup}
  -- The founders' call back on this meeting while it is open: the meeting
  -- "moved" to that time as a call back, without Cal.com or the prospect ever
  -- hearing of it. The booking's own time is left alone — attendance, the ring
  -- back and payroll are all read against it.
  left join lateral (
    select fc.id, fc.start_at, fc.tries, fc.notes
    from founder_call fc
    where fc.meeting_id = m.id and fc.done_at is null
    order by fc.id desc
    limit 1
  ) cb on true
  -- After the call_lead join, which it reads. A cross join lateral over one
  -- row per meeting, and this screen lists tens of them rather than the 5,231
  -- leads the calling queries run it over, so the fence inside it is enough.
  ${leadZone}
`;

// `dids` is threaded in rather than read here, exactly as `toLead` takes it:
// `getDids` is async and cached per request, and a mapper that awaited would
// make every row its own round trip.
function toMeeting(r: Row, dids: DidMap): Meeting {
  const listed = (r.phone as string | null) ?? null;
  const booked = (r.attendee_phone as string | null) ?? null;
  // What the prospect asked to be rung on wins over the directory's number.
  const phone = booked ?? listed;
  return {
    id: n(r.id),
    calBookingUid: String(r.cal_booking_uid),
    startAt: iso(r.start_at)!,
    endAt: iso(r.end_at),
    status: String(r.status),
    title: (r.title as string | null) ?? null,
    attendeeName: (r.attendee_name as string | null) ?? null,
    attendeeEmail: (r.attendee_email as string | null) ?? null,
    attendeeTz: (r.attendee_tz as string | null) ?? null,
    leadTz: (r.lead_tz as string | null) ?? null,
    leadEmail: (r.lead_email as string | null) ?? null,
    // Only a link that opens something. The demo event moved to a phone
    // location on 2026-09-11, and Cal.com then fills this field with the
    // prospect's phone number, which rendered as a "Meet link" button pointing
    // at a relative URL. Bookings made before the switch keep their real
    // Google Meet link.
    meetingUrl: /^https?:\/\//i.test(String(r.meeting_url ?? ""))
      ? String(r.meeting_url)
      : null,
    leadId: r.lead_id === null ? null : n(r.lead_id),
    // Directory scrapes file the business in `company`; a contact list may
    // only have a person. Falling back keeps the row identifiable either way.
    company:
      (r.company as string | null) ||
      (r.lead_name as string | null) ||
      null,
    phone,
    listedPhone: booked && listed && e164(booked) !== e164(listed) ? listed : null,
    website: (r.website as string | null) ?? null,
    attendance: (r.attendance as Meeting["attendance"]) ?? null,
    attendanceNotes: (r.attendance_notes as string | null) ?? null,
    listId: r.list_id === null || r.list_id === undefined ? null : n(r.list_id),
    listName: (r.list_name as string | null) ?? null,
    niche: (r.niche as string | null) ?? null,
    // `json_agg` hands back parsed JSON through the driver; the coalesce in
    // the query means this is never null, only empty.
    contracts: (r.contracts as MeetingContract[] | null) ?? [],
    dncBlock: phone
      ? dncBlockReason(
          {
            dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
            dncCheckedAt: iso(r.dnc_checked_at),
          },
          dialCountry(phone),
        )
      : null,
    // Built exactly as the dial card builds them, so a number that can be rung
    // from one screen can be rung from the other.
    dialTo: phone ? e164(phone) : null,
    dialFrom: didFor(dialCountry(phone ?? ""), dids),
    bookedBy: (r.booked_by as string | null) ?? null,
    bookedAt: iso(r.booked_at),
    bookingNotes: (r.booking_notes as string | null) ?? null,
    recordingId: (r.recording_id as string | null) ?? null,
    recordingMs: r.recording_ms === null ? null : Number(r.recording_ms),
    demoRecordings: clusterDemoRecordings(
      (
        (r.demo_recordings as
          | {
              recordingId: string;
              durationMs: number | null;
              startedAt: string;
            }[]
          | null) ?? []
      ).map((d) => ({
        recordingId: d.recordingId,
        durationMs: d.durationMs === null ? null : Number(d.durationMs),
        startedAt: d.startedAt,
      })),
    ),
    bookingCallId: r.booking_call_id === null ? null : n(r.booking_call_id),
    started: r.started === true,
    startingSoon: r.starting_soon === true,
    needsRingBack: r.needs_ring_back === true,
    needsFollowUp: r.needs_follow_up === true,
    kind: r.kind === "follow_up" ? "follow_up" : "demo",
    callBack: r.call_back_id
      ? {
          id: Number(r.call_back_id),
          at: iso(r.call_back_at)!,
          tries: Number(r.call_back_tries ?? 0),
          notes: (r.call_back_notes as string | null) ?? null,
          due: r.call_back_due === true,
          soon: r.call_back_soon === true,
        }
      : null,
    followup: r.followup_result
      ? {
          result: r.followup_result as MeetingFollowupResult,
          at: iso(r.followup_at)!,
          byName: (r.followup_by as string | null) ?? null,
          notes: (r.followup_notes as string | null) ?? null,
        }
      : null,
  };
}

/**
 * The meetings diary: what is coming up, soonest first, then what is done.
 *
 * Built to be read the way the callbacks diary is — once a day, top to
 * bottom, and empty by the end of it. Cancelled meetings stay on it while
 * their slot is still in the future, because "they called it off" is the most
 * important thing this screen can tell somebody and a row that simply
 * vanished would read as a bug.
 *
 * **Everything ahead comes before everything behind.** Rows outstay their slot
 * on purpose — a no-show is owed a ring back, a demo that happened is still
 * being followed up — and under a plain `start_at asc` those have the earliest
 * times on the screen and sit at the top of it. See the order by for the rest.
 */
export async function getMeetings(
  ownerId?: number,
  tz: string = "America/New_York",
  opts: {
    /**
     * The whole history instead of the rolling work queue.
     *
     * The default `where` below is deliberately narrow — the diary is meant
     * to be read top to bottom every shift, and a meeting that happened
     * months ago and was settled is not work. But "not work" is not "gone":
     * asked for 2026-09-23 after a founder went looking for an old no-show
     * and found nothing past the seven-day ring-back window — the only place
     * left to find it was the call log, filtered by outcome, which does not
     * say whether it was a no-show or a no-booking follow-up. This flag
     * drops every window and every status filter, so cancelled and settled
     * meetings come back too — a history, not a queue.
     */
    past?: boolean;
  } = {},
): Promise<Meeting[]> {
  const rows = (await db.execute(sql`
    select ${meetingSelect},
      (m.start_at <= now()) as started,
      (${startingSoon(tz)}) as starting_soon,
      (${ringBackFor(ownerId)}) as needs_ring_back,
      (${needsFollowUp}) as needs_follow_up
    from call_meeting m
    ${joins}
    where ${
      opts.past
        ? sql`m.start_at <= now()`
        : sql`(
              m.start_at > now() - make_interval(hours => ${KEEP_AFTER_START_HOURS})
              -- A missed demo outstays the twelve hours: it is the one call
              -- worth making, and a row that vanished overnight is a call
              -- nobody makes.
              or (${ringBackFor(ownerId)})
              -- So does one that happened and is still being worked: the
              -- mock-up call comes days later and is logged from this row.
              or (${needsFollowUp})
              -- And one a founder has moved to a call back: it is upcoming
              -- work again, at the call back's time.
              or (${hasCallBack(ownerId)})
            )
            and (m.status = 'accepted' or m.start_at > now())`
    }
      ${ownedBy(ownerId)}
    order by ${
      opts.past
        ? // History reads newest first, the same order the call log opens on.
          sql`m.start_at desc, m.id desc`
        : sql`
      -- What has not happened yet, first (2026-09-20). It was start_at asc
      -- for everything, which is right for a diary and wrong for this one:
      -- the rows that outstay their slot — a no-show owed a ring back, a demo
      -- still being followed up — have the *earliest* start times on the
      -- screen, so they floated to the top and pushed tonight's bookings
      -- under three days of finished business. "Can you move these ones that
      -- are already done down? i want the upcoming ones at the top."
      --
      -- "Not happened yet" includes a meeting whose slot has begun but that
      -- nobody has logged (2026-09-23). It used to be start_at > now() alone,
      -- so the demo being held that minute dropped under the finished ones
      -- the second its start time passed — mid-call. "wait until i log a
      -- outcome its not like i finish the call in 1 minute". Twelve hours at
      -- most, the window the where clause already keeps a row for.
      (${stillAhead} or ${hasCallBack(ownerId)}) desc,
      -- Upcoming: soonest first, the diary order — so the one in progress,
      -- having the earliest time, sits on top. A meeting moved to a call back
      -- sorts at the call back's time, which is where it now is.
      case when ${stillAhead} or ${hasCallBack(ownerId)}
        then coalesce(cb.start_at, m.start_at) end asc,
      -- Past: still owed something before finished, so the ring back that
      -- kept the row alive is above the demo that is closed out. Nothing is
      -- hidden either way — this only decides which of two past rows is
      -- higher.
      (${ringBackFor(ownerId)} or ${needsFollowUp}) desc,
      -- Then most recent, because the further back it is the less likely it
      -- is still the thing being dealt with.
      m.start_at desc,
      m.id asc
    `
    }
  `)) as Row[];

  const dids = await getDids();
  return rows.map((r) => {
    const m = toMeeting(r, dids);
    // The founders' own: a caller's view never carries it.
    return ownerId === undefined ? m : { ...m, callBack: null };
  });
}

/**
 * What the Meetings badge counts: demos nearly here, plus no-shows to ring back.
 *
 * Two different things under one number, which is worth being deliberate about.
 * A badge that counted only what is coming would never say a call was owed, and
 * the missed demo — the one call the floor agreed is worth making — is exactly
 * the thing that gets forgotten if nothing points at it. Both are answered by
 * opening the screen, which is all a badge asks anybody to do.
 *
 * Cached for the reason `countCallbacksDue` and `countUnreadReplies` are: the
 * sidebar and `PageShell` both ask while rendering one page.
 */
export const countMeetingsWaiting = cache(
  async (ownerId?: number, tz: string = "America/New_York"): Promise<number> => {
    const [row] = (await db.execute(sql`
      select count(m.id) as n
      from call_meeting m
      ${joins}
      where ((${startingSoon(tz)}) or (${ringBackFor(ownerId)})) ${ownedBy(ownerId)}
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
export async function countMeetingsWaitingFor(
  me: CurrentUser | null,
): Promise<number> {
  const zone = statsZone(
    (await statsRegionOf(me?.id)) ?? (await callRegionOf(me?.id)),
  );
  const [waiting, unbooked, callBacks] = await Promise.all([
    countMeetingsWaiting(callScope(me), zone.tz),
    countUnbookedDemos(callScope(me)),
    // The founders' own call backs that are due (2026-09-24) — theirs alone,
    // so only ever counted for a founder.
    me?.role === "admin" ? countFounderCallsDue() : Promise.resolve(0),
  ]);
  return waiting + unbooked + callBacks;
}

/**
 * A lead logged as Demo booked that has no Cal.com booking behind it.
 *
 * The safety net under the booking step. A demo can be logged from the dial
 * card, the Spreadsheet or the Pipeline board, or — as on 2026-09-15 — from a
 * Keypad ring back that had no lead in front of it, and the Cal.com booking is
 * a separate act on another site that is easy to leave for later and forget.
 * Until it exists nothing reminds the prospect, nothing reminds us, and the
 * meeting is on no screen.
 *
 * - **Thirty minutes of grace**: the booking is normally made on the call, and
 *   the sync runs every five minutes, so anything younger is simply in flight.
 * - **Any booking for the lead from a day before the call onwards counts**,
 *   cancelled included: a booking made just before the outcome was logged is
 *   the ordinary order of events, and a cancellation already shows on Meetings.
 * - **The last 30 days only**, so an old demo nobody booked does not sit here
 *   for ever.
 * - **Linked by lead**, which means a booking whose notes line was cleared —
 *   and so matched to nothing — leaves its lead listed here. That is right: it
 *   is exactly the booking no screen can see.
 */
export type UnbookedDemo = {
  leadId: number;
  listId: number;
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string;
  loggedAt: string;
  byName: string | null;
  /** The prospect's own clock, so the Cal.com link opens showing their local
   *  times rather than the caller's. Null for a number that belongs to no
   *  place. */
  tz: string | null;
};

const unbookedDemosSql = (ownerId?: number) => sql`
  from call_lead l
  join call_list cl on cl.id = l.call_list_id
  join lateral (
    select c.outcome, c.called_at, c.user_id from call c
    where c.call_lead_id = l.id
    order by c.called_at desc, c.id desc
    limit 1
  ) lc on true
  left join app_user u on u.id = lc.user_id
  -- The prospect's clock, for the Cal.com link. A cross join lateral over one
  -- row per lead, and this query is capped at 50, so it costs nothing here.
  ${leadZone}
  where l.duplicate_of_lead_id is null
    and lc.outcome = 'demo_booked'
    and lc.called_at < now() - interval '30 minutes'
    and lc.called_at > now() - interval '30 days'
    and not exists (
      select 1 from call_meeting m
      where m.call_lead_id = l.id
        and m.created_at > lc.called_at - interval '1 day'
    )
    ${ownerId === undefined ? sql`` : sql`and cl.assigned_user_id = ${ownerId}`}
`;

export async function getUnbookedDemos(ownerId?: number): Promise<UnbookedDemo[]> {
  const rows = (await db.execute(sql`
    select l.id as lead_id, cl.id as list_id, l.company, l.name, l.email,
      l.phone, lc.called_at, u.name as by_name, z.tz
    ${unbookedDemosSql(ownerId)}
    order by lc.called_at desc
    limit 50
  `)) as Row[];
  return rows.map((r) => ({
    leadId: n(r.lead_id),
    listId: n(r.list_id),
    company: (r.company as string | null) ?? null,
    contactName: (r.name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    phone: String(r.phone),
    loggedAt: new Date(r.called_at as string).toISOString(),
    byName: (r.by_name as string | null) ?? null,
    tz: (r.tz as string | null) ?? null,
  }));
}

/** Part of the Meetings badge: a demo nobody put on the calendar is work
 *  owed, the same as a no-show waiting on a ring back. */
export const countUnbookedDemos = cache(async (ownerId?: number): Promise<number> => {
  const [row] = (await db.execute(sql`
    select count(*) as n ${unbookedDemosSql(ownerId)}
  `)) as Row[];
  return n(row?.n);
});

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

  // Every meeting still ahead of us that has not been called off.
  //
  // It used to skip any meeting with a follow-up logged against it, because a
  // confirmed meeting needed no chasing. There is no chasing now — this is a
  // heads-up that a demo is coming — so a note somebody wrote about a prospect
  // must not silence it. A cancelled booking drops out on `status`, which is
  // the only reason left to say nothing.
  const meetings = (await db.execute(sql`
    select m.id, m.start_at,
      coalesce(l.company, l.name, m.attendee_name) as who,
      cl.assigned_user_id as owner_id
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    where m.status = 'accepted'
      and m.start_at > now()
  `)) as Row[];

  const result = { ...empty, considered: meetings.length };

  for (const m of meetings) {
    const id = n(m.id);
    const startAt = new Date(m.start_at as string);
    const due = dueOffsets(startAt, now);
    if (due.length === 0) continue;

    // Whose meeting it is, and who to tell if that fails.
    //
    // The owner of the niche first: it is their demo. Everything
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
        // A heads-up, not an instruction. Cal.com emails the prospect their own
        // reminder 24 hours and an hour before, so this one exists only so the
        // demo does not arrive as a surprise on our side — and telling somebody
        // to ring would put back the confirmation call we deliberately dropped.
        body: "Coming up. Nothing to do — Cal.com has reminded them.",
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

/**
 * When the founders' Telegram chat hears about each meeting, as minutes before
 * it starts.
 *
 * **One alert, five minutes before.** It was a day before as well until
 * 2026-09-19, and that one was dropped at the founders' request: the 8:30pm
 * digest already lists everything in the next three days, so a separate
 * "tomorrow at…" for each meeting said the same thing again, a few hours out
 * of step, and was the one people started ignoring. "I only want the daily
 * alert at 8:30pm … then the alert for when its 30 minutes before the call.
 * nothing else."
 *
 * It moved from thirty minutes to five on 2026-09-20, for the reason the
 * day-before one went: "Google Calendar already tells me 30 mins before."
 * This one is the nudge to be at the desk, not the notice that something
 * exists.
 *
 * **Five minutes only means five because the alerts run on their own
 * one-minute tick** (`/api/cron/meeting-alerts`). On the five-minute loop the
 * rest of the meetings job uses, a five-minute window and a five-minute tick
 * gave anywhere from five minutes' notice to a few seconds — one tick always
 * lands in the window, but nothing says where. The kind is renamed with the
 * offset so the claim rows say what they were for; a meeting already warned at
 * thirty minutes gets the new five-minute one too, which is the intent.
 *
 * The founders take every demo, so this goes for every meeting, not only the
 * ones whose niche has nobody to push to.
 */
const TELEGRAM_OFFSETS = [
  { kind: "telegram_5_min" as const, minutesBefore: 5 },
];

/**
 * The founders' clock, the one Meetings shows them in: their account's
 * reporting zone, then its market, then Eastern.
 *
 * **Not used by the Telegram alerts any more** (2026-09-19). They read
 * `DIGEST_TZ` instead, the same constant the nightly digest is pinned to, so
 * one bot cannot speak two clocks. It was doing exactly that: on 2026-09-18 the
 * half-hour warning said "at 12:00 AM" (Singapore, right) while the day-before
 * alerts for the same evening said "tomorrow at 9:00 AM" and "tomorrow at
 * 1:00 PM" — both Eastern. `statsZone` falls back to Eastern for a null
 * region, so any tick where the founders had not picked a zone silently
 * renamed every hour in the message. Reported as "is it glitching".
 */
export async function foundersZone(): Promise<string> {
  const [founder] = (await db.execute(sql`
    select stats_region, call_region from app_user
    where role = 'admin' and active
    order by id
    limit 1
  `)) as Row[];
  return statsZone(founder?.stats_region ?? founder?.call_region).tz;
}

export type TelegramReminderResult = {
  skipped?: "unconfigured";
  /** Meetings starting within the next day that were examined this tick. */
  considered: number;
  sent: number;
  /** Telegram refused or did not answer. The claim is released, so the next
   *  tick tries again. */
  failed: number;
};

/**
 * Tell the founders' Telegram chat about each meeting, a day and 30 minutes
 * before it starts.
 *
 * The chat is the one the email side already reports replies to
 * (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`), so nobody has to install or
 * switch on anything, which is the gap the browser push has.
 *
 * - **No quiet hours, unlike the browser push.** The US demos run through the
 *   Singapore night, and a half-hour warning held until 8am is a warning about
 *   a meeting that has already happened. Telegram's own mute is the way to
 *   silence the chat.
 * - **Claimed through `meeting_reminder_sent`**, the push reminders' table,
 *   under kinds of its own so the two never block each other. The same unique
 *   key makes two overlapping ticks send once, and `for_start_at` re-arms both
 *   reminders when a meeting moves.
 * - **Every offset already past is claimed and one message goes out**, for the
 *   reason `dueOffsets` gives: a demo booked in the last day would otherwise get
 *   its day-before message now and the same again five minutes later.
 * - **A failed send releases its claim**, the opposite of the push reminders.
 *   A 30-minute warning lost to a Telegram blip is a demo somebody is late
 *   for, and a retry every five minutes delivers nothing twice unless Telegram
 *   received a message it then failed to acknowledge.
 */
export async function sendMeetingTelegrams(
  now: Date = new Date(),
): Promise<TelegramReminderResult> {
  const result: TelegramReminderResult = { considered: 0, sent: 0, failed: 0 };
  if (!notificationsConfigured()) return { ...result, skipped: "unconfigured" };

  // The digest's clock, not the picker's: these two land in the same chat and
  // must name the same hour. See `foundersZone` for what happened when they
  // did not.
  const tz = DIGEST_TZ;
  const clock = (d: Date, zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);

  // Only a meeting inside the longest offset can have anything due.
  const longest = TELEGRAM_OFFSETS[TELEGRAM_OFFSETS.length - 1].minutesBefore;
  const meetings = (await db.execute(sql`
    select m.id, m.start_at, m.attendee_name, m.attendee_tz, z.tz as lead_tz,
      coalesce(l.company, l.name, m.attendee_name) as who,
      u.name as booked_by
    from call_meeting m
    left join call_lead l on l.id = m.call_lead_id
    left join call c on c.id = m.call_id
    left join app_user u on u.id = c.user_id
    ${leadZone}
    where m.status = 'accepted'
      and m.start_at > ${now.toISOString()}::timestamptz
      and m.start_at <= ${now.toISOString()}::timestamptz
        + make_interval(mins => ${longest}::int)
    order by m.start_at
  `)) as Row[];
  result.considered = meetings.length;

  for (const m of meetings) {
    const id = n(m.id);
    const startAt = new Date(m.start_at as string);
    const due = TELEGRAM_OFFSETS.filter(
      (o) => now.getTime() >= startAt.getTime() - o.minutesBefore * 60_000,
    );
    if (due.length === 0) continue;

    const claimed: string[] = [];
    for (const o of due) {
      const rows = (await db.execute(sql`
        insert into meeting_reminder_sent (meeting_id, kind, for_start_at)
        values (${id}, ${o.kind}, ${m.start_at as string})
        on conflict (meeting_id, kind, for_start_at) do nothing
        returning id
      `)) as Row[];
      if (rows.length > 0) claimed.push(o.kind);
    }
    if (claimed.length === 0) continue;

    // Every Telegram alert is the imminent one now; the day-before went in
    // September. Kept as a flag because `notifyMeeting` renders the two
    // differently and the digest still sends the calm shape.
    const urgent = true;
    const minutesLeft = Math.max(1, Math.round((startAt.getTime() - now.getTime()) / 60_000));
    // Where the business is, then the zone the booking form was open in. A
    // demo half an hour out is the worst moment to be told a Maui prospect
    // keeps Singapore hours. `theirClock` says nothing at all when the two
    // clocks agree, and carries their weekday when the date does not.
    const their = theirClock(
      startAt,
      prospectZone(
        typeof m.lead_tz === "string" ? m.lead_tz : null,
        typeof m.attendee_tz === "string" ? m.attendee_tz : null,
      ),
      tz,
    );
    const theirTime = their === null ? null : `${their} their time`;

    try {
      await notifyMeeting({
        urgent,
        heading: urgent
          ? `Demo in ${minutesLeft} minutes, at ${clock(startAt, tz)}`
          : `Demo ${whenPhrase(startAt, tz, now)}`,
        who: (m.who as string | null) ?? "A meeting",
        theirTime,
        contactName: (m.attendee_name as string | null) ?? null,
        bookedBy: (m.booked_by as string | null) ?? null,
      });
      result.sent += 1;
    } catch (err) {
      console.error(`Telegram reminder for meeting ${id} failed:`, err);
      await db.execute(sql`
        delete from meeting_reminder_sent
        where meeting_id = ${id}
          and for_start_at = ${m.start_at as string}
          and kind in (${sql.join(claimed.map((k) => sql`${k}`), sql`, `)})
      `);
      result.failed += 1;
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
    -- Neither flag is computed here: this reads one meeting for a write path
    -- (the follow-up route), which asks whether the row exists and who owns it,
    -- never how it should be drawn on the diary.
    select ${meetingSelect}, false as started, false as starting_soon,
      false as needs_ring_back
    from call_meeting m
    ${joins}
    where m.id = ${id} ${ownedBy(ownerId)}
    limit 1
  `)) as Row[];
  const dids = await getDids();
  return rows[0] ? toMeeting(rows[0], dids) : null;
}
