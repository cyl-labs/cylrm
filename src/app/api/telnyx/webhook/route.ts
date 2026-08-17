import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { verifyTelnyxSignature } from "@/lib/telnyx";

/**
 * Telnyx call events.
 *
 * `/api` is outside the middleware matcher, so this guards itself. Unset
 * `TELNYX_PUBLIC_KEY` means 401, never allow-by-default, following the cron
 * routes: this writes to the database, so the "unset means silently off" rule
 * that applies to outbound best-effort calls does not apply here.
 *
 * Only `call.recording.saved` is acted on. `call.initiated`, `call.answered`
 * and `call.hangup` all arrive at this same URL and are answered 200 and
 * ignored — a 4xx or 5xx makes Telnyx retry each one and eventually disable
 * the webhook entirely.
 */
export async function POST(request: Request) {
  // Read the bytes before parsing: the signature is over the raw body, and
  // re-serialising parsed JSON changes them.
  const raw = await request.text();
  const ok = verifyTelnyxSignature(
    raw,
    request.headers.get("telnyx-signature-ed25519"),
    request.headers.get("telnyx-timestamp"),
  );
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: {
    data?: { event_type?: string; payload?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const type = event.data?.event_type;
  const p = event.data?.payload ?? {};

  if (type !== "call.recording.saved") {
    // Logged, not stored. The first real call is what confirms the browser's
    // telnyxSessionId is the same string as call_session_id here, which the
    // Telnyx docs list separately without ever saying they match.
    console.log(
      "[telnyx]",
      type,
      JSON.stringify({
        call_session_id: p.call_session_id,
        call_control_id: p.call_control_id,
        call_leg_id: p.call_leg_id,
      }),
    );
    return NextResponse.json({ ok: true, ignored: type ?? "unknown" });
  }

  const recordingId = String(p.recording_id ?? p.id ?? "");
  const sessionId = String(p.call_session_id ?? "");
  if (!recordingId || !sessionId) {
    console.log("[telnyx] recording.saved with no ids:", JSON.stringify(p).slice(0, 400));
    return NextResponse.json({ ok: true, ignored: "no ids" });
  }

  const startedAt = p.recording_started_at ? String(p.recording_started_at) : null;
  const endedAt = p.recording_ended_at ? String(p.recording_ended_at) : null;
  const durationMs =
    startedAt && endedAt
      ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
      : null;

  // Conflict on the recording, not the session: a session that produces two
  // recordings keeps both, where uniqueness on the session id would make the
  // second silently overwrite the first.
  await db.execute(sql`
    insert into call_recording
      (recording_id, call_session_id, call_leg_id, duration_ms, started_at, ended_at)
    values (
      ${recordingId}, ${sessionId}, ${p.call_leg_id ? String(p.call_leg_id) : null},
      ${durationMs}, ${startedAt}, ${endedAt}
    )
    on conflict (recording_id) do update set
      call_session_id = excluded.call_session_id,
      duration_ms = excluded.duration_ms,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at
  `);

  return NextResponse.json({ ok: true, recordingId, sessionId });
}
