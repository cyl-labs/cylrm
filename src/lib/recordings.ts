import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import type { CurrentUser } from "@/lib/session";

export type VisibleRecording = {
  recordingId: string;
  transcriptText: string | null;
  transcriptTurns: TranscriptTurn[] | null;
};

/**
 * One recording, if this person is allowed to hear it.
 *
 * Shared by playback and by the transcript routes rather than written twice:
 * two copies of "may you hear this" is how the two end up disagreeing, and the
 * one that is wrong is a proxy into the whole Telnyx account. The id must
 * already be in `call_recording`, which is the outer half of the check —
 * `recordingDownloadUrl` will fetch any id on the account, so the table is
 * what limits this to calls the app itself placed.
 *
 * A caller may hear three things, and the second is what this was widened for
 * on 2026-09-06:
 *
 * - a call on a niche assigned to them, which is what the rule was;
 * - **a call they made**, whoever holds the niche now. Their own Stats lists
 *   calls by who logged them, so a niche reassigned since — or a lead they
 *   rang before the list moved — would have offered a Listen back button that
 *   404s. Their own dial is theirs to hear back;
 * - **a keypad dial they placed.** Those live in `keypad_call`, which the old
 *   query could not reach at all: it joined `call` alone, so every keypad
 *   recording in the Stats log was unplayable for admins too.
 *
 * Admins hear everything, which is the whole floor and their own business.
 */
export async function findVisibleRecording(
  id: string,
  me: CurrentUser,
): Promise<VisibleRecording | null> {
  // Never a skipped clause: only the admin branch drops the ownership test, so
  // there is no path where a missing id widens this to every recording.
  const userId = me.id;
  const mine =
    me.role === "admin"
      ? sql`true`
      : sql`(
          exists (
            select 1
            from call c
            join call_lead l on l.id = c.call_lead_id
            join call_list cl on cl.id = l.call_list_id
            where c.telnyx_session_id = r.call_session_id
              and (cl.assigned_user_id = ${userId} or c.user_id = ${userId})
          )
          or exists (
            select 1 from keypad_call k
            where k.telnyx_session_id = r.call_session_id
              and k.user_id = ${userId}
          )
        )`;

  const rows = (await db.execute(sql`
    select r.recording_id, r.transcript_text, r.transcript_turns
    from call_recording r
    where r.recording_id = ${id} and ${mine}
    limit 1
  `)) as {
    recording_id: string;
    transcript_text: string | null;
    transcript_turns: TranscriptTurn[] | null;
  }[];

  const row = rows[0];
  if (!row) return null;
  return {
    recordingId: row.recording_id,
    transcriptText: row.transcript_text,
    transcriptTurns: row.transcript_turns,
  };
}
