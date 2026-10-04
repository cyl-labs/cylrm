import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { findVisibleRecording } from "@/lib/recordings";
import { summaryConfigured, writeCallSummary } from "@/lib/call-summary";

/**
 * Write the summary of one call, on request (2026-10-02).
 *
 * The meeting-calls cron writes these by itself for recent calls over five
 * minutes; this is for the ones it never saw (older than its three-day window,
 * or made before it existed) and, since 2026-10-05, for a call of any length:
 * somebody asking for a summary of a two minute call is choosing to spend the
 * few cents, which the cron's blanket rule could not know. A call with almost
 * nothing said (a voicemail) answers "not enough was said" rather than being
 * refused for its length. Needs the transcript already, so it never spends on
 * transcribing unasked. Scoped like the transcript: whoever may hear a call may
 * have its summary.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await findVisibleRecording(id, me);
  if (!row) return Response.json({ error: "Recording not found." }, { status: 404 });
  if (row.summary) return Response.json({ summary: row.summary, cached: true });
  if (row.transcriptText === null) {
    return Response.json({ error: "Get the transcript first." }, { status: 409 });
  }
  if (!summaryConfigured()) {
    return Response.json({ error: "Summaries are not configured." }, { status: 503 });
  }

  let summary: string | null;
  try {
    summary = await writeCallSummary({ turns: row.transcriptTurns, text: row.transcriptText });
  } catch (error) {
    console.error("[summary] failed", id, error);
    return Response.json({ error: "Could not write that summary." }, { status: 502 });
  }
  if (!summary) {
    return Response.json({ error: "Not enough was said on this call to summarise." }, { status: 422 });
  }
  await db.execute(sql`
    update call_recording set summary = ${summary}, summary_at = now()
    where recording_id = ${id}
  `);
  return Response.json({ summary, cached: false });
}
