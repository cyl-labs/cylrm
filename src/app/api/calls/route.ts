import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { call, callLead } from "@/db/schema";
import { getCurrentUser, getSession } from "@/lib/session";
import { parseCallbackAt } from "@/lib/call-time";

const OUTCOMES = [
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
] as const;
type Outcome = (typeof OUTCOMES)[number];

const isOutcome = (v: unknown): v is Outcome =>
  typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    callLeadId?: unknown;
    outcome?: unknown;
    notes?: unknown;
    callbackAt?: unknown;
    contactEmail?: unknown;
    contactName?: unknown;
    telnyxSessionId?: unknown;
    durationSeconds?: unknown;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const leadId = Number(body.callLeadId);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }
  if (!isOutcome(body.outcome)) {
    return Response.json({ error: "Unknown call outcome." }, { status: 400 });
  }

  const [lead] = await db
    .select({ id: callLead.id })
    .from(callLead)
    .where(eq(callLead.id, leadId));
  if (!lead) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  // A callback with no time would sit in the queue forever with nothing to
  // sort it by, so it defaults to tomorrow rather than being rejected — the
  // caller is mid-flow and should not be stopped by a form error.
  let callbackAt: Date | null = null;
  if (body.outcome === "callback") {
    // The typed time is Singapore time; see parseCallbackAt for why saying so
    // matters. No time at all defaults to tomorrow.
    callbackAt =
      parseCallbackAt(body.callbackAt) ??
      new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim().slice(0, 5000)
      : null;

  // Details taken while booking a demo are written back to the lead, not just
  // into the notes: the email is what the Cal.com invite and every reminder
  // go to, and a booking without one is the failure the procedure warns about.
  // Only ever fills a blank or corrects it; a caller typing what the prospect
  // actually gave is better data than whatever the scrape held.
  const patch: { email?: string; name?: string } = {};
  if (typeof body.contactEmail === "string" && body.contactEmail.trim()) {
    patch.email = body.contactEmail.trim().slice(0, 500);
  }
  if (typeof body.contactName === "string" && body.contactName.trim()) {
    patch.name = body.contactName.trim().slice(0, 500);
  }
  if (Object.keys(patch).length > 0) {
    await db.update(callLead).set(patch).where(eq(callLead.id, leadId));
  }

  // Who dialled. The session is the only source for this — a client-supplied
  // user id would let anyone log calls against a colleague's name.
  const user = await getCurrentUser();

  const [row] = await db
    .insert(call)
    .values({
      callLeadId: leadId,
      userId: user?.id ?? null,
      // Written only by the browser dialler. Null on every handset call,
      // which is all of them until a DID exists. The session id is what
      // `call_recording` joins on; the duration is the browser's timer, and
      // is present even on a no-answer, which has no recording at all.
      telnyxSessionId:
        typeof body.telnyxSessionId === "string" && body.telnyxSessionId
          ? body.telnyxSessionId.slice(0, 200)
          : null,
      durationSeconds:
        typeof body.durationSeconds === "number" &&
        Number.isFinite(body.durationSeconds)
          ? Math.max(0, Math.round(body.durationSeconds))
          : null,
      outcome: body.outcome,
      notes,
      callbackAt,
    })
    .returning({ id: call.id, calledAt: call.calledAt });

  return Response.json({
    id: row.id,
    calledAt: row.calledAt.toISOString(),
    outcome: body.outcome,
  });
}

/** The lead's most recent call — the one its category is derived from. */
async function latestCallFor(leadId: number) {
  const [row] = await db
    .select({ id: call.id, callbackAt: call.callbackAt })
    .from(call)
    .where(eq(call.callLeadId, leadId))
    .orderBy(desc(call.calledAt), desc(call.id))
    .limit(1);
  return row ?? null;
}

/**
 * Fix a mis-tapped outcome.
 *
 * This overwrites the last call rather than logging another one: the dial did
 * happen, the label on it was wrong, and inserting a second row would show the
 * lead as rung twice. `called_at` is left alone for the same reason — the call
 * was made when it was made. A lead with no calls yet gets one, which is how a
 * category is set on a number nobody has rung.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    callLeadId?: unknown;
    outcome?: unknown;
    callbackAt?: unknown;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const leadId = Number(body.callLeadId);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }
  if (!isOutcome(body.outcome)) {
    return Response.json({ error: "Unknown call outcome." }, { status: 400 });
  }

  const [lead] = await db
    .select({ id: callLead.id })
    .from(callLead)
    .where(eq(callLead.id, leadId));
  if (!lead) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  const existing = await latestCallFor(leadId);

  let callbackAt: Date | null = null;
  if (body.outcome === "callback") {
    callbackAt =
      parseCallbackAt(body.callbackAt) ??
      // Keep the time they already asked for if there was one; a correction
      // to some other field should not move an agreed callback.
      existing?.callbackAt ??
      new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  if (!existing) {
    const [row] = await db
      .insert(call)
      .values({
        callLeadId: leadId,
        userId: (await getCurrentUser())?.id ?? null,
        outcome: body.outcome,
        callbackAt,
      })
      .returning({ id: call.id });
    return Response.json({ id: row.id, outcome: body.outcome, created: true });
  }

  // `user_id` is deliberately left alone: correcting a mis-tapped outcome
  // does not make the call yours. The dial was theirs and stays theirs.
  await db
    .update(call)
    .set({ outcome: body.outcome, callbackAt })
    .where(eq(call.id, existing.id));

  return Response.json({ id: existing.id, outcome: body.outcome });
}

/**
 * Put a lead back to never-called by dropping its most recent call.
 *
 * The escape hatch for logging an outcome against the wrong row: without it
 * that lead can only ever be *re*-labelled, never returned to the untouched
 * state it was in. Only the latest call goes, so earlier history survives.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = Number(searchParams.get("callLeadId"));
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }

  const existing = await latestCallFor(leadId);
  if (!existing) {
    return Response.json({ error: "This lead has no calls to undo." }, {
      status: 404,
    });
  }

  await db.delete(call).where(eq(call.id, existing.id));
  return Response.json({ ok: true });
}
