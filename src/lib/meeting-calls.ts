/**
 * Transcribes the calls that belong to a meeting, by itself, and reads each for
 * a promised call back (2026-10-02).
 *
 * "Meeting call" means a recording whose far end is the number of a business
 * that has a meeting on the calendar: the demo, a follow-up, a quick call to
 * rearrange. Cold calls to businesses with no meeting are left alone, and so
 * is anything under twenty seconds (voicemails, nobody home).
 *
 * Run by the worker every five minutes (`/api/cron/meeting-calls`), not by the
 * webhook: the webhook has to answer Telnyx quickly and the audio is not always
 * ready the instant it says so. Capped per tick, newest-first within the last
 * three days, so a backlog is worked through rather than spent at once.
 *
 * Each recording is **claimed first** (`auto_checked_at`), so a transcription
 * that fails is not retried every five minutes for three days. The Transcribe
 * button on the recording is still there, and was the only way in before this.
 *
 * Transcription is billed per minute (Deepgram), which is why it used to be on
 * demand only; restricting it to calls with a meeting behind them is what
 * keeps the bill to a handful of calls a day.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import { zoneForLead } from "@/lib/calls";
import { readCallbackRequest, suggestionConfigured } from "@/lib/callback-suggestion";
import { transcribeUrl, transcriptionConfigured } from "@/lib/deepgram";
import { recordingDownloadUrl } from "@/lib/telnyx";

const PER_TICK = 5;
const MIN_MS = 20_000;
const DAYS = 3;

type Row = {
  id: number;
  recording_id: string;
  started_at: string;
  transcript_text: string | null;
  transcript_turns: TranscriptTurn[] | null;
  lead_id: number | null;
};

export async function processMeetingCalls(): Promise<{
  considered: number;
  transcribed: number;
  suggested: number;
  failed: number;
}> {
  const result = { considered: 0, transcribed: 0, suggested: 0, failed: 0 };
  if (!transcriptionConfigured()) return result;

  const rows = (await db.execute(sql`
    select r.id, r.recording_id, r.started_at, r.transcript_text, r.transcript_turns,
      (
        select l.id from call_meeting m
        join call_lead l on l.id = m.call_lead_id
        where ('+' || l.phone_key) in (r.to_number, r.from_number)
           or ('+' || l.direct_phone_key) in (r.to_number, r.from_number)
           or m.attendee_phone in (r.to_number, r.from_number)
        order by m.start_at desc limit 1
      ) as lead_id
    from call_recording r
    where r.auto_checked_at is null
      and r.started_at > now() - make_interval(days => ${DAYS}::int)
      and r.duration_ms >= ${MIN_MS}
      and r.received_at is not null
      and exists (
        select 1 from call_meeting m
        join call_lead l on l.id = m.call_lead_id
        where ('+' || l.phone_key) in (r.to_number, r.from_number)
           or ('+' || l.direct_phone_key) in (r.to_number, r.from_number)
           or m.attendee_phone in (r.to_number, r.from_number)
      )
    order by r.started_at desc
    limit ${PER_TICK}
  `)) as unknown as Row[];

  for (const r of rows) {
    result.considered += 1;
    // Claimed before any work, atomically: two overlapping ticks cannot both
    // spend money on the same recording.
    const claimed = (await db.execute(sql`
      update call_recording set auto_checked_at = now()
      where id = ${r.id} and auto_checked_at is null
      returning id
    `)) as unknown[];
    if (claimed.length === 0) continue;

    try {
      let text = r.transcript_text;
      let turns = r.transcript_turns;
      if (!text) {
        const url = await recordingDownloadUrl(r.recording_id).catch(() => null);
        if (!url) throw new Error("Telnyx has no download for that recording.");
        const t = await transcribeUrl(url);
        text = t.text;
        turns = t.turns;
        await db.execute(sql`
          update call_recording
          set transcript_text = ${t.text},
              transcript_turns = ${JSON.stringify(t.turns)}::jsonb,
              transcribed_at = now()
          where id = ${r.id}
        `);
        result.transcribed += 1;
      }

      if (suggestionConfigured() && text) {
        const tz = (r.lead_id ? await zoneForLead(r.lead_id) : null) ?? "America/New_York";
        const found = await readCallbackRequest({
          turns,
          text,
          startedAt: new Date(r.started_at),
          tz,
        });
        if (found) {
          await db.execute(sql`
            update call_recording
            set callback_suggestion = ${JSON.stringify(found)}::jsonb
            where id = ${r.id}
          `);
          result.suggested += 1;
        }
      }
    } catch (err) {
      result.failed += 1;
      console.error("[meeting-calls] failed", r.recording_id, err);
    }
  }
  return result;
}
