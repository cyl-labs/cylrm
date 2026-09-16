import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { verifyTelnyxSignature } from "@/lib/telnyx";
import { phoneKeyCandidates } from "@/lib/calls";
import { recordInboundText, smsEnabled, updateTextStatus } from "@/lib/sms";

/**
 * Telnyx call and message events.
 *
 * `/api` is outside the middleware matcher, so this guards itself. Unset
 * `TELNYX_PUBLIC_KEY` means 401, never allow-by-default, following the cron
 * routes: this writes to the database, so the "unset means silently off" rule
 * that applies to outbound best-effort calls does not apply here.
 *
 * Three things are acted on: `call.recording.saved`, the inbound call
 * lifecycle (`call.initiated` / `call.answered` / `call.hangup`) for calls
 * arriving at a caller's own number, and texts (`message.*`) once texting is
 * switched on. Everything else is answered 200 and ignored — a 4xx or 5xx
 * makes Telnyx retry each one and eventually disable the webhook entirely.
 * Messaging webhooks are signed with the same account key as call events.
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

  // Texts, from the `cylrm-sms` messaging profile. Ignored outright while
  // texting is switched off, and answered 200 either way — the rule below
  // applies here too. Placed first so nothing written for call events reads a
  // message payload: an inbound text's `direction` is "inbound", not the
  // "incoming" the call branch keys on, and it is worth not relying on that.
  if (
    type === "message.received" ||
    type === "message.sent" ||
    type === "message.finalized"
  ) {
    if (!smsEnabled()) {
      return NextResponse.json({ ok: true, ignored: "texting is off" });
    }
    if (type === "message.received") {
      const result = await recordInboundText(p);
      return NextResponse.json({ ok: true, text: "received", ...result });
    }
    const moved = await updateTextStatus(p);
    return NextResponse.json({ ok: true, text: type, moved });
  }

  // An inbound leg. `direction` is "incoming" here, matching the call events
  // API rather than the browser SDK's "inbound" — the two vocabularies differ
  // and it is worth not assuming they agree.
  //
  // **Only `call.initiated` is gated on the direction**, and that asymmetry is
  // the fix for a bug that ran for the life of this route (2026-09-16). An
  // answered call kept `answered_at` null and so sat in somebody's Missed calls
  // for ever, clearable only by hand: measured on prod, `answered_at` was set
  // on 1 inbound row in 92 while `ended_at` managed 38. Telnyx does not send
  // `call.answered` with direction "incoming" for these calls — an inbound call
  // answered by a SIP endpoint reports the leg that picked up, which is the
  // outgoing one — so the old guard dropped nearly every answer on the floor,
  // and they landed in the fall-through logger below instead.
  //
  // Letting the other two through unguarded is safe because of what
  // `recordInbound` does with them: `call.initiated` INSERTs, so an outbound
  // leg reaching it would invent a missed call from a number we rang, and it
  // keeps the check. `call.answered` and `call.hangup` only UPDATE a row keyed
  // on `call_session_id`, so a leg belonging to no inbound call matches nothing
  // and costs one statement that touches no rows.
  if (
    (p.direction === "incoming" && type === "call.initiated") ||
    type === "call.answered" ||
    type === "call.hangup"
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
  // Who the call was with. Telnyx has always sent these and this route always
  // threw them away, which is why 122 recordings whose call was never logged
  // could not be reached from anywhere in the app: `call_recording` held only
  // ids, so nothing could ask which business the audio was of. Kept as sent —
  // matching a lead happens at read time, because a match made here would be
  // frozen into the row and a number reassigned later would make it a lie.
  const toNumber = p.to ? String(p.to) : null;
  const fromNumber = p.from ? String(p.from) : null;

  await db.execute(sql`
    insert into call_recording
      (recording_id, call_session_id, call_leg_id, duration_ms, started_at,
       ended_at, to_number, from_number)
    values (
      ${recordingId}, ${sessionId}, ${p.call_leg_id ? String(p.call_leg_id) : null},
      ${durationMs}, ${startedAt}, ${endedAt}, ${toNumber}, ${fromNumber}
    )
    on conflict (recording_id) do update set
      call_session_id = excluded.call_session_id,
      duration_ms = excluded.duration_ms,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      -- coalesce, not excluded: a retry whose payload omits the numbers must
      -- not blank out ones already stored, and the backfill may have got there
      -- first on a recording saved before this shipped.
      to_number = coalesce(excluded.to_number, call_recording.to_number),
      from_number = coalesce(excluded.from_number, call_recording.from_number)
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
            ? // `in (…)`, never `= any(${keys})`: Drizzle spreads an array into
              // "($1, $2)", which Postgres reads as a row rather than an array,
              // so the whole insert failed. It did, for every inbound call from
              // 2026-09-04 to 2026-09-15, and Missed calls stayed empty.
              sql`(select id from call_lead
                   where phone_key in (${sql.join(
                     keys.map((k) => sql`${k}`),
                     sql`, `,
                   )})
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
