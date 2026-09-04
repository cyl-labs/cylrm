import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { verifyTelnyxSignature } from "@/lib/telnyx";
import { phoneKeyCandidates } from "@/lib/calls";

/**
 * Telnyx call events.
 *
 * `/api` is outside the middleware matcher, so this guards itself. Unset
 * `TELNYX_PUBLIC_KEY` means 401, never allow-by-default, following the cron
 * routes: this writes to the database, so the "unset means silently off" rule
 * that applies to outbound best-effort calls does not apply here.
 *
 * Two things are acted on: `call.recording.saved`, and the inbound call
 * lifecycle (`call.initiated` / `call.answered` / `call.hangup`) for calls
 * arriving at a caller's own number. Everything else is answered 200 and
 * ignored — a 4xx or 5xx makes Telnyx retry each one and eventually disable
 * the webhook entirely.
 *
 * Inbound is recorded here rather than in the browser on purpose. A call that
 * rang out while the CRM was closed is exactly the one worth knowing about,
 * and no browser was there to report it; the webhook sees every leg either
 * way.
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

  // An inbound leg. `direction` is "incoming" here, matching the call events
  // API rather than the browser SDK's "inbound" — the two vocabularies differ
  // and it is worth not assuming they agree.
  if (
    p.direction === "incoming" &&
    (type === "call.initiated" ||
      type === "call.answered" ||
      type === "call.hangup")
  ) {
    await recordInbound(type, p);
    return NextResponse.json({ ok: true, inbound: type });
  }

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

/**
 * One row per inbound call, built up across its three events.
 *
 * Keyed on the session rather than the leg: Telnyx forks an invite and emits
 * `call.initiated` several times for one ringing phone, and a person
 * experienced one call. `on conflict do nothing` makes the extra legs free.
 *
 * Everything is resolved here, at write time, rather than joined at read time
 * — who was rung, and which lead is calling. Both can change afterwards (a
 * number gets reassigned, a lead is deleted) and a missed call should keep
 * saying who it was for on the day it came in.
 */
async function recordInbound(
  type: string,
  p: Record<string, unknown>,
): Promise<void> {
  const sessionId = String(p.call_session_id ?? "");
  if (!sessionId) return;

  if (type === "call.initiated") {
    const from = String(p.from ?? "");
    const to = String(p.to ?? "");
    if (!from || !to) return;
    const keys = phoneKeyCandidates(from);
    await db.execute(sql`
      insert into inbound_call
        (call_session_id, from_number, to_number, user_id, call_lead_id, started_at)
      values (
        ${sessionId}, ${from}, ${to},
        (select id from app_user where telnyx_did = ${to} and active limit 1),
        ${
          keys.length > 0
            ? sql`(select id from call_lead where phone_key = any(${keys})
                   order by duplicate_of_lead_id nulls first, id limit 1)`
            : sql`null`
        },
        ${p.start_time ? String(p.start_time) : sql`now()`}
      )
      on conflict (call_session_id) do nothing
    `);
    return;
  }

  if (type === "call.answered") {
    // Coalesced, so a second leg's answer cannot move the time the call was
    // actually picked up.
    await db.execute(sql`
      update inbound_call
      set answered_at = coalesce(answered_at, now())
      where call_session_id = ${sessionId}
    `);
    return;
  }

  await db.execute(sql`
    update inbound_call
    set ended_at = coalesce(ended_at, now())
    where call_session_id = ${sessionId}
  `);
}
