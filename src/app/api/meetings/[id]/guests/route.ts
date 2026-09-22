import { eq } from "drizzle-orm";
import { db } from "@/db";
import { callLead } from "@/db/schema";
import { callScope, getCurrentUser } from "@/lib/session";
import { getMeeting } from "@/lib/meetings";
import { addBookingGuest, calConfigured } from "@/lib/cal";

/** Long enough for any real address, and the column's own limit. */
const MAX_LENGTH = 500;

/**
 * A rough shape check, not a verdict on whether the address exists.
 *
 * Deliberately not a strict RFC pattern: the only thing worth refusing here is
 * something that plainly is not an address, because the real check is that
 * Cal.com either accepts it or tells us why, and the real risk is a typo no
 * regular expression can see — which is, after all, the reason this route
 * exists at all.
 */
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Send this booking's invitation to another email address.
 *
 * **The repair for an address typed wrong on the booking form**, which is a
 * thing that happens on the phone: a caller hears "Grab N Junk" and types
 * `grabandjunk365@gmail.com`, the prospect is never invited, and nothing on
 * the screen says so. The demo still happens — we ring them — but they get no
 * calendar entry and none of Cal.com's reminders.
 *
 * **It adds a guest rather than correcting the attendee, because correcting
 * the attendee is not possible.** Cal.com's v2 API has no endpoint for it, v1
 * had one and now answers 410, and the booking page locks the name and email
 * fields on a reschedule. See `addBookingGuest`. The consequence is worth
 * saying plainly on the screen: the wrong address stays on the booking and
 * keeps receiving Cal.com's mail.
 *
 * **The address is written back to the lead in the same breath**, when the two
 * differ. That is what the next booking prefills from, what the contract is
 * sent to, and what anybody reading the lead will believe — leaving it wrong
 * there is how the same mistake is made again on the next call. It is also
 * exactly what the dial card's booking box already does when a call is logged.
 *
 * Not admin-only. The caller who made the booking is the one who spots the
 * mistake, usually within the hour, and making them ask a founder is how a
 * demo goes ahead with nobody invited. The meeting is read through
 * `callScope`, so a caller can only do this to their own niches.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Switched off, this route reveals nothing — the same rule the texting one
  // follows. Without a key there is no way to reach the booking anyway.
  if (!calConfigured()) {
    return Response.json({ error: "Cal.com is not connected." }, { status: 404 });
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  const email =
    typeof body?.email === "string" ? body.email.trim().slice(0, MAX_LENGTH) : "";
  if (!looksLikeEmail(email)) {
    return Response.json(
      { error: "That does not look like an email address." },
      { status: 400 },
    );
  }

  // Scoped read: a caller naming a meeting on somebody else's niche gets the
  // same not-found as one that never existed.
  const meeting = await getMeeting(id, callScope(me));
  if (!meeting) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  if (meeting.status === "cancelled") {
    return Response.json(
      { error: "That booking is cancelled, so there is no invitation to send." },
      { status: 400 },
    );
  }
  // Refused rather than quietly succeeding: adding the address already on the
  // booking sends nothing new, and a green tick that changed nothing is how
  // somebody stops looking for the real problem.
  if (email.toLowerCase() === (meeting.attendeeEmail ?? "").toLowerCase()) {
    return Response.json(
      { error: "That is already the address on this booking." },
      { status: 400 },
    );
  }

  try {
    await addBookingGuest(meeting.calBookingUid, { email });
  } catch (err) {
    // Cal.com's own sentence, which says the useful thing — a duplicate guest,
    // a booking it will not take guests on, the thirty-guest ceiling.
    const message = err instanceof Error ? err.message : "Cal.com refused it.";
    console.error(`Adding a guest to meeting ${id} failed:`, err);
    return Response.json({ error: message }, { status: 502 });
  }

  // Only after Cal.com has accepted it. The invitation is the point; the lead
  // is the bookkeeping, and writing the lead first would leave a corrected
  // record behind a prospect who was never invited.
  let savedToLead = false;
  if (
    meeting.leadId !== null &&
    email.toLowerCase() !== (meeting.leadEmail ?? "").toLowerCase()
  ) {
    await db
      .update(callLead)
      .set({ email })
      .where(eq(callLead.id, meeting.leadId));
    savedToLead = true;
  }

  return Response.json({ ok: true, email, savedToLead });
}
