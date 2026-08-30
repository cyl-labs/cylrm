/**
 * Reading the meetings back off Cal.com.
 *
 * The calling side books demos through Cal.com's own page — the "Book it on
 * Cal.com" button on the dial card opens it in a new tab, prefilled — because
 * Cal.com owns the availability, sends the invite and creates the Google Meet
 * link. What it did not do was tell the CRM anything, so a booked meeting had
 * no time attached to it anywhere in this app.
 *
 * This module is the read side of that. No database, no Next.js: just the API
 * and the rules for turning a booking into something `lib/meetings.ts` can
 * match against a lead.
 *
 * Everything here is best-effort and silent when unconfigured, in the same
 * spirit as `lib/notify.ts`: an unreachable Cal.com must leave the calling
 * screens exactly as they were, never break a cron tick, and never throw into
 * a page render.
 */

const CAL_API = "https://api.cal.com/v2";

/** The API version this module's field names were written against. Cal.com
 *  dates its breaking changes rather than numbering them, and an unpinned
 *  request gets whatever is newest — which is how a working integration
 *  starts returning a differently-shaped booking one morning. */
const CAL_API_VERSION = "2026-05-01";

const TIMEOUT_MS = 15_000;

/** Bookings pulled per status. Far above a real week's demos; `hasMore` is
 *  reported rather than paginated through, so a run that ever hits this says
 *  so instead of quietly syncing the first hundred. */
const TAKE = 100;

export const calConfigured = () => Boolean(process.env.CAL_API_KEY);

/**
 * Which event type on the account is ours.
 *
 * That Cal.com account is not only the cold-calling team's: it carries the
 * voice agent's own bookings and several clients' event types, and syncing
 * every booking on it into this CRM would be both noise and other people's
 * business. So the filter is required, and when it cannot be worked out
 * nothing is synced at all rather than everything.
 *
 * Normally nothing has to be configured for it: `CAL_BOOKING_URL` already
 * ends in the event type's slug — the same URL the dial card links to — so
 * the one already in the environment answers it. `CAL_EVENT_TYPE_ID` is there
 * to override that if the booking link ever changes shape.
 */
export function calEventFilter(): { id?: number; slug?: string } | null {
  const id = Number(process.env.CAL_EVENT_TYPE_ID);
  if (Number.isFinite(id) && id > 0) return { id };

  const url = process.env.CAL_BOOKING_URL;
  if (!url) return null;
  // ".../cyllabs/voice-agent-demo" -> "voice-agent-demo". Query strings and a
  // trailing slash both appear in links people paste.
  const slug = url.split("?")[0].replace(/\/+$/, "").split("/").pop();
  return slug ? { slug } : null;
}

export type CalBooking = {
  uid: string;
  id: number | null;
  title: string | null;
  /** The booking form's "additional notes", which is where the dial card's
   *  prefill lands and therefore where the lead's phone number is. */
  notes: string | null;
  startAt: string;
  endAt: string | null;
  status: string;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeeTz: string | null;
  meetingUrl: string | null;
  eventTypeId: number | null;
  eventTypeSlug: string | null;
  createdAt: string | null;
};

type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function toBooking(raw: Json): CalBooking | null {
  const uid = str(raw.uid);
  const start = str(raw.start);
  // Without these two there is nothing to store and nothing to count down to.
  if (!uid || !start) return null;

  const responses = (raw.bookingFieldsResponses ?? {}) as Json;
  const attendees = Array.isArray(raw.attendees) ? (raw.attendees as Json[]) : [];
  // The person we are meeting. Cal.com puts the host in `hosts`, so the first
  // attendee is the prospect rather than us.
  const who = attendees[0] ?? {};
  const eventType = (raw.eventType ?? {}) as Json;

  return {
    uid,
    id: typeof raw.id === "number" ? raw.id : null,
    title: str(raw.title),
    // `description` and the `notes` response carry the same prefilled text;
    // either can be the populated one depending on how the booking was made,
    // and the voice agent's own bookings put theirs in neither.
    notes: str(responses.notes) ?? str(raw.description),
    startAt: start,
    endAt: str(raw.end),
    status: str(raw.status) ?? "accepted",
    attendeeName: str(who.name) ?? str(responses.name),
    attendeeEmail: str(who.email) ?? str(responses.email),
    attendeeTz: str(who.timeZone),
    meetingUrl: str(raw.meetingUrl),
    eventTypeId:
      typeof raw.eventTypeId === "number" ? raw.eventTypeId : null,
    eventTypeSlug: str(eventType.slug),
    createdAt: str(raw.createdAt),
  };
}

async function fetchPage(status: string): Promise<{
  bookings: CalBooking[];
  hasMore: boolean;
}> {
  const key = process.env.CAL_API_KEY;
  if (!key) return { bookings: [], hasMore: false };

  const params = new URLSearchParams({
    status,
    take: String(TAKE),
    sortStart: "asc",
  });
  // Narrowing server-side when we have the id saves pulling other people's
  // bookings across the wire at all. With only a slug the filter still has to
  // happen, just here — see `listCalBookings`.
  const filter = calEventFilter();
  if (filter?.id) params.set("eventTypeId", String(filter.id));

  const res = await fetch(`${CAL_API}/bookings?${params}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "cal-api-version": CAL_API_VERSION,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Cal.com ${res.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as Json;
  const data = Array.isArray(body.data) ? (body.data as Json[]) : [];
  const pagination = (body.pagination ?? {}) as Json;
  return {
    bookings: data.map(toBooking).filter((b): b is CalBooking => b !== null),
    hasMore: pagination.hasMore === true,
  };
}

/**
 * Everything upcoming, plus what has been cancelled.
 *
 * Two requests because the API's status filter takes one value at a time. The
 * cancelled ones matter as much as the live ones: a prospect who calls off a
 * meeting is the single most important thing this sync can tell a caller, and
 * a booking that simply stopped being returned would otherwise sit on the
 * screen looking real until its time passed.
 */
export async function listCalBookings(): Promise<{
  bookings: CalBooking[];
  hasMore: boolean;
}> {
  const filter = calEventFilter();
  if (!filter) return { bookings: [], hasMore: false };

  const pages = await Promise.all(
    // Upcoming and cancelled, never `past`: the diary is about what is still
    // to come, and `past` would re-upsert the hundred most recent finished
    // meetings on every one of the day's 288 ticks to no end. A one-off
    // backfill of history is this array plus one word, if it is ever wanted.
    ["upcoming", "cancelled"].map((s) => fetchPage(s)),
  );

  let bookings = pages.flatMap((p) => p.bookings);
  // With no id to filter on server-side, drop everything that is not ours
  // here. Fail closed: a booking whose event type we cannot read is not
  // assumed to be the cold-calling team's.
  if (!filter.id && filter.slug) {
    bookings = bookings.filter((b) => b.eventTypeSlug === filter.slug);
  }

  return { bookings, hasMore: pages.some((p) => p.hasMore) };
}

/**
 * The lead's phone number, out of the booking notes.
 *
 * The dial card prefills those notes with `Company Name (+15205551234)` — it
 * has done since the button shipped, for a human reading the calendar rather
 * than for this — so the number is already sitting on every booking a caller
 * has made, in E.164, which is exactly `call_lead.phone_key` with its plus.
 * That is what makes this work on bookings already in the past.
 *
 * Returns bare digits to match `phone_key` directly. Anything without a `+`
 * is ignored rather than guessed at: a bare run of digits in a free-text note
 * could be a house number, and the whole point of the leading plus is that it
 * is the one part of a written number that is not an inference.
 */
export function bookingPhoneKey(booking: CalBooking): string | null {
  if (!booking.notes) return null;
  const m = /\+\d[\d\s().-]{5,20}/.exec(booking.notes);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  // E.164 allows fifteen digits and needs at least seven to be a real line.
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}
