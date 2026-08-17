import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TranscriptTurn } from "@/db/schema";
import { callScope, getCurrentUser } from "@/lib/session";
import { transcribeUrl, transcriptionConfigured } from "@/lib/deepgram";
import { recordingDownloadUrl } from "@/lib/telnyx";

/**
 * Transcribe one recording, on demand.
 *
 * On demand rather than automatically on every call: transcription is billed
 * per minute, and these are opened a handful of times a week to check a
 * booking against what was actually said. Transcribing every dial would be a
 * standing bill for text nobody reads.
 *
 * Stored on first use, so the second person to open the same call pays
 * nothing and reads it instantly. POST rather than GET for exactly that
 * reason — the first call spends money, which is not a thing a prefetch or a
 * link preview should be able to do.
 *
 * Scoped like the playback route: the id must already be in `call_recording`
 * and the call must be on a list this person can see.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ownerId = callScope(me);

  const rows = (await db.execute(sql`
    select r.recording_id, r.transcript_text, r.transcript_turns
    from call_recording r
    join call c on c.telnyx_session_id = r.call_session_id
    join call_lead l on l.id = c.call_lead_id
    join call_list cl on cl.id = l.call_list_id
    where r.recording_id = ${id}
      ${ownerId === undefined ? sql`` : sql`and cl.assigned_user_id = ${ownerId}`}
    limit 1
  `)) as {
    recording_id: string;
    transcript_text: string | null;
    transcript_turns: TranscriptTurn[] | null;
  }[];

  if (rows.length === 0) {
    return Response.json({ error: "Recording not found." }, { status: 404 });
  }

  const existing = rows[0];
  if (existing.transcript_text !== null) {
    return Response.json({
      text: existing.transcript_text,
      turns: existing.transcript_turns ?? [],
      cached: true,
    });
  }

  // Checked after the scope query, not before it: whether this person may see
  // this recording is the first question, so an id they have no business
  // asking about answers 404 whatever the server is configured with.
  if (!transcriptionConfigured()) {
    return Response.json(
      { error: "Transcription is not configured." },
      { status: 503 },
    );
  }

  const url = await recordingDownloadUrl(id).catch(() => null);
  if (!url) {
    return Response.json(
      { error: "Telnyx has no download for that recording." },
      { status: 502 },
    );
  }

  let transcript;
  try {
    transcript = await transcribeUrl(url);
  } catch (error) {
    console.error("[transcribe] failed", id, error);
    return Response.json(
      { error: "Could not transcribe that recording." },
      { status: 502 },
    );
  }

  await db.execute(sql`
    update call_recording
    set transcript_text = ${transcript.text},
        transcript_turns = ${JSON.stringify(transcript.turns)}::jsonb,
        transcribed_at = now()
    where recording_id = ${id}
  `);

  return Response.json({ ...transcript, cached: false });
}
