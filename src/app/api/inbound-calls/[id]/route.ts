import { sql } from "drizzle-orm";
import { db } from "@/db";
import { call } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt } from "@/lib/call-time";
import type { CallOutcome } from "@/lib/calls";

const OUTCOMES: CallOutcome[] = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "not_interested",
  "demo_booked",
  "trial",
  "won",
  "lost",
  "bad_number",
];

/**
 * Ring a missed call back, and say what came of it.
 *
 * With no body this only marks the call handled — set by hand rather than
 * derived from a later outgoing call, because deriving it would work only for
 * numbers that match a lead, and a number we hold no lead for is precisely the
 * one most likely to be a new enquiry and the likeliest to be forgotten.
 *
 * With an `outcome` it also logs a real `call` row against the lead, which is
 * what a ring back actually is: the prospect was dialled and something
 * happened. Both halves are done here rather than as two requests from the
 * browser, so "logged the outcome" and "no longer owed a ring back" cannot
 * come apart — the failure that leaves a call in the record and the row still
 * shouting on the screen, or worse, the reverse.
 *
 * Scoped the way the screen is: a caller can only clear a call to their own
 * number, an admin any. Enforced here rather than by hiding the button, since
 * a fetch walks straight past a hidden button.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const callId = Number(id);
  if (!Number.isInteger(callId)) {
    return Response.json({ error: "Invalid call." }, { status: 400 });
  }

  // A bodyless PATCH is the old "Mark as rung back" and still supported: a row
  // whose number matches no lead has nothing to log an outcome against.
  const body = (await request.json().catch(() => null)) as {
    outcome?: unknown;
    notes?: unknown;
    callbackAt?: unknown;
  } | null;

  let outcome: CallOutcome | null = null;
  if (body && body.outcome !== undefined) {
    if (
      typeof body.outcome !== "string" ||
      !OUTCOMES.includes(body.outcome as CallOutcome)
    ) {
      return Response.json({ error: "Unknown outcome." }, { status: 400 });
    }
    outcome = body.outcome as CallOutcome;
  }

  const notes =
    typeof body?.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 5000)
      : null;

  // Which inbound call this is, and the lead behind it. Read before anything
  // is written so the scope check and the lead lookup are one question.
  const found = (await db.execute(sql`
    select ic.id, ic.call_lead_id, ic.handled_at
    from inbound_call ic
    where ic.id = ${callId}
      ${me.role === "admin" ? sql`` : sql`and ic.user_id = ${me.id}`}
    limit 1
  `)) as { id: number; call_lead_id: number | null; handled_at: string | null }[];

  if (found.length === 0) {
    return Response.json({ error: "Call not found." }, { status: 404 });
  }
  const leadId = found[0].call_lead_id;

  if (outcome !== null && leadId === null) {
    return Response.json(
      {
        error:
          "That number is not a lead in the CRM, so there is nothing to log a call against.",
      },
      { status: 400 },
    );
  }

  let callbackAt: Date | null = null;
  if (outcome === "callback") {
    // Read as a wall clock in the calling timezone, exactly as the dialler
    // does: a datetime-local field sends no offset, and the droplet is UTC.
    callbackAt =
      parseCallbackAt(body?.callbackAt) ??
      new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  await db.transaction(async (tx) => {
    if (outcome !== null && leadId !== null) {
      // Exactly the row `/api/calls` writes, minus the telephony fields: the
      // ring back was dialled from a handset or the keypad, so there is no
      // session to join a recording on. A lead's state is derived from its
      // latest call, so this alone moves it out of the queue.
      await tx.insert(call).values({
        callLeadId: leadId,
        userId: me.id,
        outcome,
        notes,
        callbackAt,
      });
    }

    await tx.execute(sql`
      update inbound_call
      set handled_at = coalesce(handled_at, now()),
          handled_by = coalesce(handled_by, ${me.id})
      where id = ${callId}
    `);
  });

  return Response.json({ ok: true, changed: 1, logged: outcome !== null });
}
