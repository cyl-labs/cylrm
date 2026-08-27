import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

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
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can confirm a meeting." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    callId?: unknown;
    showedUp?: unknown;
  } | null;

  const callId = Number(body?.callId);
  if (!Number.isInteger(callId)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  if (typeof body?.showedUp !== "boolean") {
    return Response.json(
      { error: "Say whether they showed up." },
      { status: 400 },
    );
  }
  const showedUp = body.showedUp;

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
  if (showedUp) {
    const [clash] = (await db.execute(sql`
      select a.call_id
      from call_demo_attendance a
      where a.call_lead_id = ${target.call_lead_id}
        and a.showed_up
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
        (call_id, call_lead_id, showed_up, marked_by_user_id)
      values (${callId}, ${target.call_lead_id}, ${showedUp}, ${me.id})
      on conflict (call_id) do update
        set showed_up = excluded.showed_up,
            marked_by_user_id = excluded.marked_by_user_id,
            marked_at = now()
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
