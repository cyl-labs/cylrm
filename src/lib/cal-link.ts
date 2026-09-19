import { e164 } from "@/lib/phone";

/**
 * The Cal.com booking link for a lead, filled in.
 *
 * One place for every screen that books a demo — the dial card, the
 * Spreadsheet, the Pipeline board and the "not on the calendar" list on
 * Meetings — because the notes line is load-bearing: `Company (+1…)` is how the
 * meetings sync matches a booking back to its lead (`lib/meetings.ts`), and a
 * screen that built it slightly differently would book demos nothing can find.
 *
 * No database behind it, so server and client components can both use it.
 */
export function calBookingHref(
  base: string,
  lead: { company: string | null; phone: string; tz?: string | null },
  contact: { name?: string | null; email?: string | null } = {},
): string {
  // The demo is a phone call, so Cal.com asks for a number and requires one.
  // Filled with the lead's own in E.164, which is what the booking has to
  // carry; the caller changes it on Cal.com if the prospect gave another.
  const dial = e164(lead.phone);
  const name = contact.name?.trim();
  const email = contact.email?.trim();
  const params = new URLSearchParams({
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(dial ? { attendeePhoneNumber: dial } : {}),
    // The prospect's clock, so every slot on the page already reads in their
    // local time. Without it Cal.com opens in the *caller's* zone, and the SOP
    // has to ask them to change it by hand before offering a time — a step
    // measured at nought out of four on the calls reviewed on 2026-09-18, with
    // one prospect read a window of "12:30AM till 5AM" off somebody else's
    // screen. `cal.tz` is the parameter Cal.com reads; `timeZone` and `tz` are
    // both ignored, checked against the live booking page.
    ...(lead.tz ? { "cal.tz": lead.tz } : {}),
    notes: `${lead.company ?? lead.phone} (${lead.phone})`,
  });
  return `${base}?${params.toString()}`;
}

/**
 * The Cal.com page for moving a booking already made.
 *
 * A prospect who cannot take the call at the agreed time is the ordinary case
 * — "sometimes they're not free right now" — and until this there was no way
 * to move a meeting from the CRM at all. Both people who need it were stuck:
 * the founder ringing at the booked time, and the caller ringing a no-show
 * back, whose own log already offers "Rebooked — new time agreed" with nothing
 * on the screen that could do the rebooking.
 *
 * `rescheduleUid` moves the booking rather than adding a second one. That is
 * the whole difference from `calBookingHref`, and it is not cosmetic: a demo
 * booked twice is two rows on Meetings, two sets of reminders and a second
 * booking Cal.com has separately told the prospect about.
 *
 * **No prefill, deliberately.** Cal.com carries the original booking's answers
 * across to the new one — verified on the one real reschedule on this account,
 * where the notes line `KR Services LLC (+18084292496)` survived intact — and
 * that line is what the sync matches a booking back to its lead on. Sending
 * our own values would overwrite whatever the prospect corrected on Cal.com,
 * the "Best number to call you on" among them.
 *
 * **Built against the event page rather than `cal.com/reschedule/<uid>`.**
 * That shorter link exists and is what Cal.com's own emails use, but it
 * answers 307 to exactly this URL **with the query string dropped** — so the
 * zone below would be lost, which is the one thing this must not do. Measured,
 * not assumed.
 */
export function calRescheduleHref(
  base: string,
  uid: string,
  /** The prospect's own zone off the booking — their answer, not our guess at
   *  it. Without it the page opens on the reader's clock, and a founder in
   *  Singapore reads slots for a Florida prospect at four in the morning: the
   *  failure `cal.tz` was added to the booking link to fix. Checked against the
   *  live reschedule page, where it renames the "Former time" line too. */
  tz?: string | null,
): string {
  const params = new URLSearchParams({
    rescheduleUid: uid,
    ...(tz ? { "cal.tz": tz } : {}),
  });
  return `${base}?${params.toString()}`;
}
