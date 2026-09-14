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
  lead: { company: string | null; phone: string },
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
    notes: `${lead.company ?? lead.phone} (${lead.phone})`,
  });
  return `${base}?${params.toString()}`;
}
