import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import type { CurrentUser } from "@/lib/session";

/** Whose recordings to limit to: a caller's id, or undefined for an admin,
 *  who hears everything — the same shape `callScope` gives. */
const scopeOf = (me: CurrentUser): number | undefined =>
  me.role === "admin" ? undefined : me.id;

/**
 * The "may you hear this" test as a clause on `call_recording r`, for the
 * rules spelled out on `findVisibleRecording`.
 *
 * One clause for playback, the transcript routes, the Spreadsheet's count and
 * a lead's recordings list: a list that offered a recording its own play
 * button then refused would be the same bug as two copies of the rule.
 *
 * Never a skipped clause: only the admin branch drops the ownership test, so
 * there is no path where a missing id widens this to every recording.
 */
export const recordingVisibleTo = (userId: number | undefined): SQL =>
  userId === undefined
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
        -- The demo of a meeting on their niche, or one handed to them to
        -- close (2026-09-25). A demo is rung from the meeting row by whoever
        -- takes it and writes no call row, so neither branch above can reach
        -- it: the row offered callers a "Demo call" button whose audio and
        -- transcript both 404'd. Matched the way the row finds it -- the
        -- lead's number or the booking's, from half an hour before the slot.
        or exists (
          select 1
          from call_meeting m
          join call_lead l on l.id = m.call_lead_id
          left join call_list cl on cl.id = l.call_list_id
          where (cl.assigned_user_id = ${userId} or m.closer_user_id = ${userId})
            and r.to_number in ('+' || l.phone_key, m.attendee_phone)
            and r.started_at >= m.start_at - interval '30 minutes'
        )
      )`;

export type LeadRecording = {
  recordingId: string;
  startedAt: string | null;
  durationMs: number | null;
  /** "out" when we rang them, "in" when they rang us. */
  direction: "out" | "in";
  /** Who was on our side, from the call or keypad row it belongs to. */
  byName: string | null;
  /** The outcome logged against it, when it was placed from the dial card. */
  outcome: string | null;
  /** Dialled on the Keypad, so no outcome is attached to it. */
  keypad: boolean;
};

/**
 * Every recording of a call with this number, newest first.
 *
 * Matched on the number rather than on the lead's calls, because a call row
 * only carries a recording when it was dialled from the dial card. One rung on
 * the Keypad, or logged afterwards from the Spreadsheet, has its audio filed
 * under the number and nowhere else — which is how a whole evening of a
 * caller's recordings came to be unreachable from the lead. `phone` is the
 * E.164 form `call_recording` stores.
 */
export async function getRecordingsForNumber(
  phone: string,
  me: CurrentUser,
): Promise<LeadRecording[]> {
  const rows = (await db.execute(sql`
    select r.recording_id, r.started_at, r.duration_ms,
      case when r.from_number = ${phone} then 'in' else 'out' end as direction,
      coalesce(cu.name, ku.name) as by_name,
      cc.outcome, k.id is not null as keypad
    from call_recording r
    left join lateral (
      select c.user_id, c.outcome from call c
      where c.telnyx_session_id = r.call_session_id
      order by c.called_at desc limit 1
    ) cc on true
    left join app_user cu on cu.id = cc.user_id
    left join lateral (
      select k.id, k.user_id from keypad_call k
      where k.telnyx_session_id = r.call_session_id
      limit 1
    ) k on true
    left join app_user ku on ku.id = k.user_id
    where (r.to_number = ${phone} or r.from_number = ${phone})
      and ${recordingVisibleTo(scopeOf(me))}
    order by r.started_at desc nulls last, r.id desc
    limit 50
  `)) as Record<string, unknown>[];

  return rows.map((r) => ({
    recordingId: String(r.recording_id),
    startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
    durationMs: r.duration_ms === null ? null : Number(r.duration_ms),
    direction: r.direction === "in" ? "in" : "out",
    byName: (r.by_name as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
    keypad: r.keypad === true,
  }));
}

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
 * A caller may hear four things; the second is what this was widened for on
 * 2026-09-06, the fourth on 2026-09-25:
 *
 * - a call on a niche assigned to them, which is what the rule was;
 * - **a call they made**, whoever holds the niche now. Their own Stats lists
 *   calls by who logged them, so a niche reassigned since — or a lead they
 *   rang before the list moved — would have offered a Listen back button that
 *   404s. Their own dial is theirs to hear back;
 * - **a keypad dial they placed.** Those live in `keypad_call`, which the old
 *   query could not reach at all: it joined `call` alone, so every keypad
 *   recording in the Stats log was unplayable for admins too.
 * - **the demo of a meeting on their niche**, or one a founder assigned them
 *   to close. The demo has no call row to own, so without this every "Demo
 *   call" button on a caller's Meetings screen refused to play or transcribe.
 *
 * Admins hear everything, which is the whole floor and their own business.
 */
export async function findVisibleRecording(
  id: string,
  me: CurrentUser,
): Promise<VisibleRecording | null> {
  const rows = (await db.execute(sql`
    select r.recording_id, r.transcript_text, r.transcript_turns
    from call_recording r
    where r.recording_id = ${id} and ${recordingVisibleTo(scopeOf(me))}
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
