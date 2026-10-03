import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { transcribeRecordings } from "@/lib/meeting-brief";
import {
  REVIEW_MIN_MINUTES,
  getStoredReviews,
  reviewConfigured,
  reviewFingerprint,
  reviewSource,
  writeReview,
} from "@/lib/demo-review";

/**
 * Write (or refresh) the review of one meeting's demo call.
 *
 * Founders for any meeting, and a closer for the meetings handed to them.
 * `/api` is outside the middleware matcher, so this check is the only guard.
 * Always on a press, never automatic: a review is an OpenAI call and a
 * recording with no transcript yet is a Deepgram minute on top. An unchanged
 * review is returned without spending anything unless `force` is set.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin" && me.role !== "closer") {
    return Response.json(
      { error: "Only a founder or closer can review a demo call." },
      { status: 403 },
    );
  }
  if (!reviewConfigured()) {
    return Response.json(
      { error: "No OpenAI key is configured on this server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    meetingId?: unknown;
    force?: unknown;
  } | null;
  const meetingId = Number(body?.meetingId);
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    return Response.json({ error: "No meeting given." }, { status: 400 });
  }
  if (me.role === "closer") {
    const mine = (await db.execute(sql`
      select 1 from call_meeting
      where id = ${meetingId} and closer_user_id = ${me.id}
    `)) as unknown as unknown[];
    if (mine.length === 0) {
      return Response.json(
        { error: "You can only review the demos you were given to close." },
        { status: 403 },
      );
    }
  }

  let source = await reviewSource(meetingId);
  if (!source) return Response.json({ error: "Meeting not found." }, { status: 404 });
  if (source.recordingIds.length === 0) {
    return Response.json(
      { error: "There is no recording of the demo call, so there is nothing to review." },
      { status: 422 },
    );
  }

  if (source.untranscribedIds.length > 0) {
    const t = await transcribeRecordings(source.untranscribedIds);
    if (t.failed > 0 && t.transcribed === 0 && !source.transcript) {
      return Response.json(
        { error: "The recording could not be turned into text. Try again in a minute." },
        { status: 502 },
      );
    }
    source = (await reviewSource(meetingId)) ?? source;
  }
  if (!source.transcript || !source.talk) {
    return Response.json(
      { error: "The recording could not be turned into text. Try again in a minute." },
      { status: 502 },
    );
  }
  if (source.minutes < REVIEW_MIN_MINUTES) {
    return Response.json(
      {
        error: `The demo call was only ${source.minutes} minutes, too short to review. Reviews need at least ${REVIEW_MIN_MINUTES}.`,
      },
      { status: 422 },
    );
  }

  const fp = reviewFingerprint(source);
  const have = (
    (await db.execute(sql`
      select source_fingerprint from call_meeting_review where meeting_id = ${meetingId}
    `)) as unknown as { source_fingerprint: string | null }[]
  )[0];
  if (body?.force !== true && have?.source_fingerprint === fp) {
    const stored = (await getStoredReviews([meetingId])).get(meetingId) ?? null;
    return Response.json({ stored, reused: true });
  }

  try {
    const review = await writeReview(source);
    // Through Drizzle, never the raw postgres client, which would store a
    // jsonb string (see AGENTS.md).
    await db.execute(sql`
      insert into call_meeting_review
        (meeting_id, review, source_fingerprint, model, generated_by_user_id)
      values (${meetingId}, ${JSON.stringify(review)}::jsonb, ${fp}, ${"gpt-4.1-mini"}, ${me.id})
      on conflict (meeting_id) do update set
        review = excluded.review,
        source_fingerprint = excluded.source_fingerprint,
        model = excluded.model,
        generated_at = now(),
        generated_by_user_id = excluded.generated_by_user_id
    `);
  } catch (err) {
    console.error("[demo-review] failed", meetingId, err);
    return Response.json(
      { error: "The review could not be written this time. Try again." },
      { status: 502 },
    );
  }
  const stored = (await getStoredReviews([meetingId])).get(meetingId) ?? null;
  return Response.json({ stored, reused: false });
}
