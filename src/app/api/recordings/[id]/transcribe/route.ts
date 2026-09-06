import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { findVisibleRecording } from "@/lib/recordings";
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
 * Scoped like the playback route, through the same `findVisibleRecording`. A
 * caller can transcribe their own calls: at a cent or so for a three-minute
 * dial the spend is not worth a permission, and reading back what was actually
 * said is most of the value of listening to your own calls at all.
 */
/**
 * The transcript already written for this recording, or null.
 *
 * Never spends money and never calls Deepgram — that is POST's job, and the
 * split is the point. Without this the sheet had no way to ask "is there one
 * already", so it opened showing the button every time and a transcript
 * written a minute ago looked like it had never been made. It was reading back
 * from React state alone, which a refresh throws away.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await findVisibleRecording(id, me);
  if (!row) {
    return Response.json({ error: "Recording not found." }, { status: 404 });
  }

  return Response.json(
    row.transcriptText === null
      ? { text: null, turns: null }
      : { text: row.transcriptText, turns: row.transcriptTurns ?? [] },
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await findVisibleRecording(id, me);

  if (!existing) {
    return Response.json({ error: "Recording not found." }, { status: 404 });
  }

  if (existing.transcriptText !== null) {
    return Response.json({
      text: existing.transcriptText,
      turns: existing.transcriptTurns ?? [],
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
