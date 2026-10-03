import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { ensureTranscripts, transcribeRecordings } from "@/lib/meeting-brief";
import {
  REVIEW_MIN_MINUTES,
  bookingSource,
  getStoredReviews,
  reviewConfigured,
  reviewFingerprint,
  reviewSource,
  writeReview,
  REVIEW_MODEL,
  type ReviewKind,
  type ReviewSource,
} from "@/lib/demo-review";

/**
 * Write (or refresh) the review of one meeting's call.
 *
 * `kind` is "demo" (the default: the demo a founder or closer ran) or "booking"
 * (the cold call a caller made to win it). Who may ask:
 * - demo: founders for any meeting, a closer for the meetings handed to them.
 * - booking: founders for any meeting, a caller for the meetings they booked.
 * `/api` is outside the middleware matcher, so these checks are the only guard.
 *
 * Always on a press, never automatic: a review is an OpenAI call and a
 * recording with no transcript yet is a Deepgram minute on top. An unchanged
 * review is returned without spending anything unless `force` is set.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!reviewConfigured()) {
    return Response.json(
      { error: "No OpenAI key is configured on this server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    meetingId?: unknown;
    force?: unknown;
    kind?: unknown;
    recordingIds?: unknown;
  } | null;
  const meetingId = Number(body?.meetingId);
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    return Response.json({ error: "No meeting given." }, { status: 400 });
  }
  const kind: ReviewKind = body?.kind === "booking" ? "booking" : "demo";
  // The calls the reviewer ticked as the real demo (demo reviews only).
  const picked =
    kind === "demo" && Array.isArray(body?.recordingIds)
      ? (body.recordingIds as unknown[])
          .filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v))
          .slice(0, 10)
      : [];

  // Founders only, both kinds (2026-10-03): the reviews are a need to know
  // thing. It was open to a closer on their own meetings and a caller on their
  // own bookings until the founders withdrew that the same day.
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only a founder can run a call review." },
      { status: 403 },
    );
  }

  let source: ReviewSource | null;
  if (kind === "demo") {
    source = await reviewSource(meetingId, picked);
    if (!source) return Response.json({ error: "Meeting not found." }, { status: 404 });
    if (source.recordingIds.length === 0) {
      return Response.json(
        {
          error:
            picked.length > 0
              ? "None of the calls you chose belong to this business, so there is nothing to review."
              : "There is no recording of the demo call, so there is nothing to review. Tick the call you want reviewed.",
        },
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
      source = (await reviewSource(meetingId, picked)) ?? source;
    }
  } else {
    let got = await bookingSource(meetingId);
    if (!got) return Response.json({ error: "Meeting not found." }, { status: 404 });
    if (!got.source.transcript && got.hasRecording) {
      await ensureTranscripts([meetingId]);
      got = (await bookingSource(meetingId)) ?? got;
    }
    if (!got.hasRecording) {
      return Response.json(
        { error: "There is no recording of the booking call, so there is nothing to review." },
        { status: 422 },
      );
    }
    source = got.source;
  }

  if (!source.transcript || !source.talk) {
    return Response.json(
      { error: "The recording could not be turned into text. Try again in a minute." },
      { status: 502 },
    );
  }
  // A booking call is short by nature; only a demo is refused for being brief.
  if (kind === "demo" && source.minutes < REVIEW_MIN_MINUTES) {
    return Response.json(
      {
        error: `The calls you chose add up to only ${source.minutes} minutes, too short to review. A demo review needs at least ${REVIEW_MIN_MINUTES}. If the call dropped, tick every part of it.`,
      },
      { status: 422 },
    );
  }

  const table = kind === "demo" ? sql.raw("call_meeting_review") : sql.raw("call_booking_review");
  const fp = reviewFingerprint(source, kind);
  const have = (
    (await db.execute(sql`
      select source_fingerprint from ${table} where meeting_id = ${meetingId}
    `)) as unknown as { source_fingerprint: string | null }[]
  )[0];
  if (body?.force !== true && have?.source_fingerprint === fp) {
    const stored = (await getStoredReviews([meetingId], kind)).get(meetingId) ?? null;
    return Response.json({ stored, reused: true });
  }

  try {
    const review = await writeReview(source, kind);
    // Through Drizzle, never the raw postgres client, which would store a
    // jsonb string (see AGENTS.md).
    await db.execute(sql`
      insert into ${table}
        (meeting_id, review, source_fingerprint, model, generated_by_user_id)
      values (${meetingId}, ${JSON.stringify(review)}::jsonb, ${fp}, ${REVIEW_MODEL}, ${me.id})
      on conflict (meeting_id) do update set
        review = excluded.review,
        source_fingerprint = excluded.source_fingerprint,
        model = excluded.model,
        generated_at = now(),
        generated_by_user_id = excluded.generated_by_user_id
    `);
  } catch (err) {
    console.error("[demo-review] failed", kind, meetingId, err);
    return Response.json(
      { error: "The review could not be written this time. Try again." },
      { status: 502 },
    );
  }
  const stored = (await getStoredReviews([meetingId], kind)).get(meetingId) ?? null;
  return Response.json({ stored, reused: false });
}
