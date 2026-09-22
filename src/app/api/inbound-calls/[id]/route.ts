import { sql } from "drizzle-orm";
import { db } from "@/db";
import { call } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";
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
 *
 * **Clearing a row clears every ring it stands for.** The screen shows one row
 * per burst carrying "rang 5 times", so stamping the representative leg alone
 * left four behind to re-group and come back as "rang 4 times". See the update
 * at the bottom for the scope, which is narrower than it first looks.
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
    /** The browser call the ring back was, when it was placed from the row's
     *  Call back button, so the recording joins the call it belongs to. */
    telnyxSessionId?: unknown;
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
  const telnyxSessionId =
    typeof body?.telnyxSessionId === "string" && body.telnyxSessionId
      ? body.telnyxSessionId.slice(0, 200)
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
  // The lead test moved up here on 2026-09-17, and it is load-bearing now
  // rather than tidy. The parse used to run before anything knew whether a
  // lead existed, which was harmless only because the value was discarded a few
  // lines later — but the zone comes from the lead, and reading a typed wall
  // clock without one would silently fall back to Singapore for a US prospect.
  // A row matching no lead has nothing to log a call against anyway.
  if (outcome === "callback" && leadId !== null) {
    // The prospect's zone, exactly as the dialler reads it: a datetime-local
    // field sends no offset, the droplet is UTC, and "9am" means their morning.
    callbackAt =
      parseCallbackAt(
        body?.callbackAt,
        (await zoneForLead(leadId)) ?? (await readerZone(me.id)).tz,
      ) ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  let changed = 0;
  await db.transaction(async (tx) => {
    if (outcome !== null && leadId !== null) {
      // Exactly the row `/api/calls` writes. The session is present when the
      // ring back was dialled from the row in the browser, and absent when it
      // was dialled from a handset, in which case there is no recording to
      // join. A lead's state is derived from its latest call, so this alone
      // moves it out of the queue.
      await tx.insert(call).values({
        callLeadId: leadId,
        userId: me.id,
        outcome,
        notes,
        callbackAt,
        telnyxSessionId,
      });
    }

    // Every ring this row stands for, not just the leg that represents it.
    //
    // Missed calls are rolled up: a prospect whose phone system redials
    // against an unregistered browser arrives as a burst of legs, and the
    // screen shows the newest one carrying "rang 5 times". Stamping `id` alone
    // left the other four unhandled, so they re-grouped into a fresh burst and
    // the row came straight back saying "rang 4 times". Reported 2026-09-22;
    // 70 legs across 7 numbers were stranded that way, and one number shows
    // three presses of the same button at 07:01, 10:03 and 10:04.
    //
    // Scoped to the same number *and* the same line, because that pair is what
    // a caller owes: the same business reaching two callers is two ring backs,
    // and clearing one must not clear the other. `is not distinct from`
    // because the line can be null — a number belonging to nobody, which only
    // an admin sees — and `= null` would match no rows and quietly clear
    // nothing.
    //
    // Everything at or before this ring, rather than this burst only, which is
    // the same rule `RUNG_BACK_SINCE` already applies to a logged outcome: you
    // rang them back, so the calls they made before that are settled. A ring
    // that lands *after* this one is a new attempt and keeps its row.
    //
    // The row being cleared is joined in rather than read into JS and bound
    // back, and that is load-bearing. `started_at` carries milliseconds
    // (.610), and a round trip through the driver truncated it to the second
    // (.000) — so `started_at <= [that]` excluded the representative leg
    // itself and the row came back one ring lighter instead of clearing. The
    // timestamp never leaves Postgres now, so there is nothing to round.
    const cleared = (await tx.execute(sql`
      update inbound_call ic
      set handled_at = coalesce(ic.handled_at, now()),
          handled_by = coalesce(ic.handled_by, ${me.id})
      from inbound_call rep
      where rep.id = ${callId}
        and ic.from_number = rep.from_number
        and ic.user_id is not distinct from rep.user_id
        and ic.started_at <= rep.started_at
        and ic.handled_at is null
        -- Siblings only sweep up calls nobody picked up. An answered call was
        -- never owed a ring back and never appears on the screen, so stamping
        -- it "handled by" would put a thing that did not happen in the log.
        -- The row actually asked for is always cleared, answered or not, which
        -- is what this route did before it learned about bursts.
        and (ic.answered_at is null or ic.id = rep.id)
      returning ic.id
    `)) as { id: number }[];
    changed = cleared.length;
  });

  return Response.json({ ok: true, changed, logged: outcome !== null });
}
