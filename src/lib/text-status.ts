import type { SmsStatus } from "@/lib/sms";

/** How long after a text goes out a delivery confirmation can still be on its
 *  way. A carrier that never confirms (Telnyx's `delivery_unconfirmed`, common
 *  for picture messages) must not read "waiting" for ever. */
const WAITING_MS = 10 * 60_000;

/**
 * How an outbound text is doing, in words (2026-10-09).
 *
 * "Sent" alone read as the end of the story, and "Sending…" stayed on a picture
 * text for half a minute after Telnyx had already passed it to the carrier, so a
 * founder asked why it was slow. The carrier's confirmation is a separate, later
 * step, and the label says so while it can still arrive.
 *
 * Db-free, so the Texts screen and the thread under a meeting say the same thing.
 */
export function outboundStatusLabel(status: SmsStatus, at: string, now = Date.now()): string {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "failed":
      return "Didn't go through";
    case "queued":
      return "Sending…";
    case "sent":
      return now - Date.parse(at) < WAITING_MS
        ? "Sent, waiting for the carrier to confirm"
        : "Sent";
    default:
      return "";
  }
}
