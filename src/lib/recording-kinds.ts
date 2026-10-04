import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * What a recording turned out to be, so a Meetings row can say "voicemail"
 * instead of leaving a founder to press play on thirty seconds of a greeting.
 *
 * - `voicemail`: the call went to a mailbox or a call screener.
 * - `no_answer`: it rang out.
 * - `live`: somebody talked to somebody.
 * - `unknown`: nobody logged the call and nothing was transcribed, so there is
 *   nothing to judge it by. Said as such, never guessed from the length: a
 *   45 second demo and a 45 second voicemail look the same on a clock.
 */
export type RecordingKind = "voicemail" | "no_answer" | "live" | "unknown";

/**
 * What a mailbox says, in the opening of a short call. Deliberately the phrases
 * only a machine says: a person may well say "he is not available" or "leave a
 * message", so those are not enough on their own.
 */
const MAILBOX_OPENING =
  "(after the (tone|beep)|at the (tone|beep)|voice ?mail|mailbox|leave (me )?(a|your|an additional) message|cannot (take|answer) your call|can.t take your call|unable to (take|come to|answer)|subscriber)";

/**
 * A call screener ("record your name and reason for calling") is not a voicemail
 * by itself: when the person picks up, the call carries on as a conversation. It
 * only counts when the call also ends in a machine saying they are not there.
 */
const SCREENER = "(record your (name|message)|stay on the line|reason for calling)";
const NOT_THERE =
  "(is not available|after the (tone|beep)|leave (me )?(a|your|an additional) message|unavailable)";

/** A mailbox greeting is in the first few sentences of a short call. */
const GREETING_CHARS = 400;
const GREETING_MAX_MS = 180_000;

/**
 * Judged in this order, strongest evidence first:
 *  1. a caller logged it as a voicemail;
 *  2. a caller logged a real outcome (booked, not interested, gatekeeper...),
 *     which is a conversation whatever the words say;
 *  3. the transcript is a mailbox greeting;
 *  4. a caller logged "no answer";
 *  5. it was transcribed and is not a mailbox: a conversation;
 *  6. nothing to go on.
 */
export async function getRecordingKinds(
  recordingIds: string[],
): Promise<Record<string, RecordingKind>> {
  const ids = [...new Set(recordingIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = (await db.execute(sql`
    select cr.recording_id as id,
      (select c.outcome::text from "call" c
        where c.telnyx_session_id = cr.call_session_id
        order by c.called_at desc, c.id desc limit 1) as outcome,
      cr.transcript_text is not null and cr.transcript_text <> '' as has_text,
      -- A greeting comes at the start of a short call. Anywhere else the words
      -- are just conversation: a demo of an AI receptionist says "voice mail"
      -- all the way through, and 816 and 1,142 second demos matched until this
      -- was limited to the opening of calls under three minutes.
      coalesce(coalesce(cr.duration_ms, 0) < ${GREETING_MAX_MS} and (
        left(cr.transcript_text, ${GREETING_CHARS}) ~* ${MAILBOX_OPENING}
        or (left(cr.transcript_text, ${GREETING_CHARS}) ~* ${SCREENER}
            and cr.transcript_text ~* ${NOT_THERE})
      ), false) as mailbox_text
    from call_recording cr
    where cr.recording_id in (${sql.join(ids.map((v) => sql`${v}`), sql`, `)})
  `)) as unknown as {
    id: string;
    outcome: string | null;
    has_text: boolean;
    mailbox_text: boolean;
  }[];

  const out: Record<string, RecordingKind> = {};
  for (const r of rows) {
    const spoke =
      r.outcome !== null &&
      !["voicemail", "no_answer", "bad_number"].includes(r.outcome);
    out[r.id] =
      r.outcome === "voicemail"
        ? "voicemail"
        : spoke
          ? "live"
          : r.mailbox_text
            ? "voicemail"
            : r.outcome === "no_answer"
              ? "no_answer"
              : r.has_text
                ? "live"
                : "unknown";
  }
  return out;
}
