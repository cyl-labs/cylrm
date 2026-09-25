import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import type { DemoStatus } from "@/lib/payroll";

/**
 * Record whether a booked meeting actually happened.
 *
 * This is the one fact the CRM could not already answer. `demo_booked` means
 * they agreed to a slot and `trial`/`won` mean they bought in; the fee is paid
 * on neither, but on turning up — so a prospect who came and declined earns it
 * and never reaches trial.
 *
 * An upsert on `call_id`, so a mis-tap is corrected by answering again rather
 * than by a second row. The exception is an attendance a payout has already
 * claimed: that money is out of the door, and the fix for a wrong payment is a
 * correcting one, not a silent edit of the evidence.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin" && me.role !== "closer") {
    return Response.json(
      { error: "Only a founder or the meeting's closer can say what happened." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    callId?: unknown;
    meetingId?: unknown;
    status?: unknown;
    notes?: unknown;
  } | null;

  // Null when the meeting has no booking call behind it — see `meetingOnly`
  // below. Payroll's confirm list always sends one.
  const sentCallId =
    body?.callId === undefined || body?.callId === null ? null : Number(body.callId);
  if (sentCallId !== null && !Number.isInteger(sentCallId)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  let callId = sentCallId;
  // A meeting booked straight off the Cal.com link, with no demo_booked call
  // in the CRM (2026-09-25): a founder's own booking, a test. It used to have
  // no "Log what happened" at all, because the answer is keyed on the booking
  // call, so it sat as "not logged" for good. Its answer is kept against the
  // meeting instead. No caller booked it, so no fee turns on it: Payroll only
  // ever reads answers through a call.
  let meetingOnly: { id: number; leadId: number } | null = null;

  // The meeting it was answered on, when it came from the Meetings row. Payroll
  // sends none and keeps the old rule (an answer counts for whichever meeting
  // of the lead began before it). With one, the answer is pinned to that
  // meeting and its current time — which is what lets a founder answer before
  // the meeting starts. See `answersMeeting`.
  const meetingId =
    body?.meetingId === undefined || body?.meetingId === null
      ? null
      : Number(body.meetingId);
  if (meetingId !== null && !Number.isInteger(meetingId)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  let pin: { id: number } | null = null;
  if (meetingId !== null) {
    const [m] = (await db.execute(sql`
      select id, start_at, call_id, call_lead_id, closer_user_id, kind,
        start_at <= now() as started
      from call_meeting where id = ${meetingId}
    `)) as Record<string, unknown>[];
    const meetingCall = m?.call_id === null || m?.call_id === undefined ? null : Number(m.call_id);
    // The meeting has to be the one this booking call made: the pin and the
    // answer must describe the same booking.
    if (!m || (callId !== null && meetingCall !== callId)) {
      return Response.json({ error: "Meeting not found." }, { status: 404 });
    }
    if (meetingCall === null) {
      if (m.call_lead_id === null || m.call_lead_id === undefined) {
        return Response.json(
          { error: "This booking is not linked to a business, so there is nothing to record it against." },
          { status: 400 },
        );
      }
      meetingOnly = { id: Number(m.id), leadId: Number(m.call_lead_id) };
    }
    callId = meetingCall;
    // A closer answers the meetings a founder handed them, once they have
    // begun, and nothing else (2026-09-25). Founders answer any, at any time:
    // writing off a booking that is not real before it sits in everybody's
    // reminders is the reason the early answer exists.
    if (me.role === "closer") {
      if (Number(m.closer_user_id) !== me.id) {
        return Response.json(
          { error: "That meeting has not been given to you to close." },
          { status: 403 },
        );
      }
      if (m.started !== true) {
        return Response.json(
          { error: "You can say what happened once the meeting has started." },
          { status: 400 },
        );
      }
    }
    pin = { id: Number(m.id) };
  } else if (me.role !== "admin") {
    // Payroll's confirm list: founders only, as it always was.
    return Response.json(
      { error: "Only a founder can confirm a meeting from here." },
      { status: 403 },
    );
  }
  if (
    body?.status !== "showed_up" &&
    body?.status !== "no_show" &&
    body?.status !== "invalid"
  ) {
    return Response.json(
      { error: "Say whether they showed up." },
      { status: 400 },
    );
  }
  const status: DemoStatus = body.status;


  // Two different silences, and the write below turns on telling them apart.
  //
  // Payroll's confirm list posts {callId, status} and nothing else, so an
  // answer given there must leave a note written on Meetings alone. The
  // Meetings box always sends the field, prefilled with whatever is already
  // stored — so when it arrives empty somebody looked at that note and deleted
  // it, which is an instruction rather than an omission.
  //
  // Hence `given` rather than a null check: "said nothing" keeps, "said
  // nothing in particular" clears. An answer with no note at all is the normal
  // case and is never refused.
  const given = typeof body.notes === "string";
  const trimmed = given ? (body.notes as string).trim() : "";
  const notes = trimmed === "" ? null : trimmed;

  if (meetingOnly) {
    // One answer per such meeting: updated if it exists, inserted if not. No
    // payout can have claimed it and no fee rule applies, so neither check
    // below is asked.
    await db.execute(sql`
      with up as (
        update call_demo_attendance
        set status = ${status},
            marked_by_user_id = ${me.id},
            marked_at = now(),
            notes = case when ${given}::boolean then ${notes} else notes end,
            for_start_at = (select start_at from call_meeting where id = ${meetingOnly.id})
        where call_id is null and meeting_id = ${meetingOnly.id}
        returning id
      )
      insert into call_demo_attendance
        (call_id, call_lead_id, status, marked_by_user_id, notes,
         meeting_id, for_start_at)
      select null, ${meetingOnly.leadId}, ${status}, ${me.id}, ${notes},
        ${meetingOnly.id},
        (select start_at from call_meeting where id = ${meetingOnly.id})
      where not exists (select 1 from up)
    `);
    return Response.json({ ok: true });
  }
  if (callId === null) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  // The lead id is denormalised onto the attendance row so the one-fee-per-
  // business index can exist, so it is read from the call rather than trusted
  // from the browser. Checking the outcome here too: attendance is only a
  // question about a booking.
  const [target] = (await db.execute(sql`
    select c.id, c.call_lead_id, c.outcome, a.payout_id
    from "call" c
    left join call_demo_attendance a on a.call_id = c.id
    where c.id = ${callId}
  `)) as Record<string, unknown>[];

  if (!target) {
    return Response.json({ error: "No such call." }, { status: 404 });
  }
  if (target.outcome !== "demo_booked") {
    return Response.json(
      { error: "That call is not a booked demo." },
      { status: 400 },
    );
  }
  if (target.payout_id !== null && target.payout_id !== undefined) {
    return Response.json(
      {
        error:
          "That meeting has already been paid for. Record a correcting payout instead of changing it.",
      },
      { status: 409 },
    );
  }

  // One business earns the fee once, however many times it was booked. Checked
  // here as well as by the partial unique index, for the reason
  // `/api/call-leads/[id]` checks the duplicate-phone index rather than
  // catching it: a pre-check can name the other booking, where a constraint
  // violation can only say that there was one.
  if (status === "showed_up") {
    const [clash] = (await db.execute(sql`
      select a.call_id
      from call_demo_attendance a
      where a.call_lead_id = ${target.call_lead_id}
        and a.status = 'showed_up'
        and a.call_id <> ${callId}
    `)) as Record<string, unknown>[];
    if (clash) {
      return Response.json(
        {
          error:
            "That business is already marked as having shown up for another booking. It earns the fee once.",
        },
        { status: 409 },
      );
    }
  }

  try {
    await db.execute(sql`
      insert into call_demo_attendance
        (call_id, call_lead_id, status, marked_by_user_id, notes,
         meeting_id, for_start_at)
      values (${callId}, ${target.call_lead_id}, ${status}, ${me.id}, ${notes},
        ${pin?.id ?? null},
        -- Copied inside the database, never through JavaScript: a Date keeps
        -- milliseconds and start_at has microseconds, so a round trip stored a
        -- time that never equalled the meeting's and the answer applied to
        -- nothing.
        (select start_at from call_meeting where id = ${pin?.id ?? null}))
      on conflict (call_id) do update
        set status = excluded.status,
            marked_by_user_id = excluded.marked_by_user_id,
            marked_at = now(),
            -- A correction from Payroll carries no meeting, and must not unpin
            -- an answer given on the row: an early "not a real booking" would
            -- otherwise stop counting for the meeting it was about.
            meeting_id = coalesce(excluded.meeting_id, call_demo_attendance.meeting_id),
            for_start_at = case
              when excluded.meeting_id is not null then excluded.for_start_at
              else call_demo_attendance.for_start_at
            end,
            -- Only a caller who mentioned notes can change them. Correcting an
            -- answer from Payroll a day later must not silently delete what
            -- somebody wrote here: the sentence about the receptionist is worth
            -- more than the status it was attached to, and there is no way to
            -- get it back. The cast is needed or Postgres cannot type the
            -- parameter inside a case.
            notes = case
              when ${given}::boolean then excluded.notes
              else call_demo_attendance.notes
            end
    `);
  } catch (err) {
    // The index, as a backstop to the check above, for the race where two
    // bookings of one business are answered at the same moment.
    //
    // Read off `cause`, not `message`: Drizzle wraps the driver error, so the
    // outer `message` is only "Failed query: insert into …" and the Postgres
    // detail — including the constraint name — hangs off `cause`. Matching on
    // the outer message silently never fires, which turns a 409 anyone could
    // act on into an unexplained 500.
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    if (
      cause?.constraint_name === "call_demo_attendance_one_show_per_lead_idx"
    ) {
      return Response.json(
        {
          error:
            "That business is already marked as having shown up for another booking. It earns the fee once.",
        },
        { status: 409 },
      );
    }
    console.error("attendance failed", err);
    return Response.json(
      { error: "Could not save that." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
