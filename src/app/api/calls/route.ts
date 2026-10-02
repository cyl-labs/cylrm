import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { call, callLead } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { canEditLead } from "@/lib/lead-access";
import { parseCallbackAt } from "@/lib/call-time";
import { leadHasPipeline, zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

const OUTCOMES = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "callback",
  "not_interested",
  "demo_booked",
  "following_up",
  "trial",
  "won",
  "lost",
  "bad_number",
] as const;
type Outcome = (typeof OUTCOMES)[number];

const isOutcome = (v: unknown): v is Outcome =>
  typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);

/**
 * Whether a call that did not connect keeps its lead out of the dial queue.
 *
 * The queue reads a lead's latest call, so a no answer logged on a business
 * that already had its demo put it back in front of a caller as a cold retry
 * (Pro Junk Removal, 2026-09-29: a second demo, a second pickup, and a caller
 * who opened as if they had never spoken). On a lead with a demo, trial or
 * booking behind it the default is therefore to keep it out, and a person has
 * to say otherwise (`keepOutOfQueue: false`, the dial card's choice) to put it
 * back. The default lives here rather than in the dial card so the Spreadsheet,
 * the Pipeline and the Missed calls row are covered without each growing the
 * question.
 */
async function keepsOutOfQueue(
  leadId: number,
  outcome: Outcome,
  chosen: unknown,
  exceptCallId: number | null = null,
) {
  if (!["no_answer", "voicemail", "gatekeeper"].includes(outcome)) return false;
  if (!(await leadHasPipeline(leadId, exceptCallId))) return false;
  return chosen !== false;
}

export async function POST(request: Request) {
  // `getCurrentUser`, not the cookie's `loggedIn` flag: that flag is written at
  // sign-in and stays true for the thirty days the cookie lives, so a person
  // switched off on Monday could still write calls from the session already in
  // their pocket. This route is outside the middleware matcher, so it is the
  // only guard there is.
  const me = await getCurrentUser();
  if (!me) {
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
    keepOutOfQueue?: unknown;
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
    // Read in the prospect's zone, not the floor's — a callback is an
    // appointment with them, and "9am" means their morning. It was Singapore
    // for every lead until 2026-09-17, which put 9 of the 12 callbacks then
    // outstanding outside the prospect's 9 to 5, several at ten at night.
    // A lead with no zone — a toll-free number — is read on the clock the
    // caller picked at the top of Stats, which is what their screens show it
    // back in. No time at all still defaults to tomorrow rather than being
    // refused: the caller is mid-flow and should not be stopped by a form
    // error.
    callbackAt =
      parseCallbackAt(
        body.callbackAt,
        (await zoneForLead(leadId)) ?? (await readerZone(me.id)).tz,
      ) ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
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

  /**
   * The session the browser sent, or the recording that is plainly this call.
   *
   * `line.sessionId` is live state and is gone the moment a call ends, so the
   * dialler keeps the last finished call for the lead in memory and hands it
   * back here. A page reload between hanging up and logging loses that, and
   * the outcome then saves with nothing for `call_recording` to join on — a
   * real conversation with no "Listen back", for ever. Aaron's 4m53s call that
   * booked Garbage Removal LLc was one: he rang at 17:08, the prospect booked
   * at 17:17 and he logged it at 17:22, a page load later. Thirty-six calls in
   * a fortnight had a recording sitting unclaimed beside them.
   *
   * So when the browser sends none, look for one: same prospect number, placed
   * from this caller's own line, started within the half hour before the
   * outcome was logged, and attached to no other call. All four, because the
   * cost of guessing is one person's conversation on another person's row.
   * The longest wins where there are several, the rule `meetingSelect`
   * already uses — a six-second redial is not the call.
   *
   * It runs only on the `null` path, so a browser that did its job is never
   * second-guessed, and finding nothing is the ordinary case: a handset call
   * has no recording, and neither has a no-answer.
   */
  const sent =
    typeof body.telnyxSessionId === "string" && body.telnyxSessionId
      ? body.telnyxSessionId.slice(0, 200)
      : null;
  let sessionId = sent;
  if (!sessionId) {
    const [found] = (await db.execute(sql`
      select cr.call_session_id
      from call_recording cr
      join call_lead l on l.id = ${leadId}
      join app_user u on u.id = ${me.id}
      where regexp_replace(cr.to_number, '[^0-9]', '', 'g')
            = regexp_replace(l.phone, '[^0-9]', '', 'g')
        and regexp_replace(cr.from_number, '[^0-9]', '', 'g')
            = regexp_replace(u.telnyx_did, '[^0-9]', '', 'g')
        and cr.started_at > now() - interval '30 minutes'
        and cr.started_at <= now()
        and not exists (
          select 1 from "call" c where c.telnyx_session_id = cr.call_session_id
        )
      order by cr.duration_ms desc nulls last, cr.started_at desc
      limit 1
    `)) as { call_session_id: string }[];
    sessionId = found?.call_session_id ?? null;
  }

  // Who dialled. The session is the only source for this — a client-supplied
  // user id would let anyone log calls against a colleague's name.
  const [row] = await db
    .insert(call)
    .values({
      callLeadId: leadId,
      userId: me.id,
      // Written only by the browser dialler. Null on every handset call,
      // which is all of them until a DID exists. The session id is what
      // `call_recording` joins on; the duration is the browser's timer, and
      // is present even on a no-answer, which has no recording at all.
      telnyxSessionId: sessionId,
      // The caller ID this was placed from (2026-10-03): the caller's own
      // number when they dial in the browser, which is the only way a number
      // appears on a call. A handset call leaves it null.
      dialledFrom: await dialledFromFor(me.id),
      durationSeconds:
        typeof body.durationSeconds === "number" &&
        Number.isFinite(body.durationSeconds)
          ? Math.max(0, Math.round(body.durationSeconds))
          : null,
      outcome: body.outcome,
      notes,
      callbackAt,
      keepOutOfQueue: await keepsOutOfQueue(
        leadId,
        body.outcome,
        body.keepOutOfQueue,
      ),
    })
    .returning({ id: call.id, calledAt: call.calledAt });

  /**
   * A founder logging a callback moves the founders' call back too
   * (2026-10-02). The Meetings card reads `founder_call`, the callbacks diary
   * reads this call, and they were two records of one promise: Mark logged
   * "call me December 1" after a prospect rang him back, the diary said
   * December and the meeting card went on saying "call back in 11 days" until
   * somebody noticed. One open call back per business, so it moves to the new
   * time, and the new note replaces the old one when there is one. Founders
   * only: a caller's callback is the callers' diary and never touches it.
   */
  if (me.role === "admin" && body.outcome === "callback" && callbackAt) {
    await db.execute(sql`
      update founder_call
      set start_at = ${callbackAt.toISOString()}::timestamptz,
          notes = coalesce(nullif(${notes ?? ""}, ''), notes)
      where call_lead_id = ${leadId} and done_at is null
    `);
  }

  /**
   * A founder writing a business off takes it off Meetings too (2026-10-02).
   * "Not interested" and "lost" end the sale, but an open founders' call back
   * and a no-show's ring back kept the row on the calendar until someone used
   * Remove from Meetings. So the call back is closed, and every meeting that
   * has already started gets the same `cancelled` row Remove writes, which is
   * what clears a ring back. **A meeting still ahead is left alone**: a
   * prospect who says no on a call but is still booked for tomorrow is a
   * decision for the person taking the demo, and Remove is the way to say it.
   * Founders only; a caller logging the same outcome closes nothing.
   */
  if (
    me.role === "admin" &&
    (body.outcome === "not_interested" || body.outcome === "lost")
  ) {
    await db.execute(sql`
      update founder_call set done_at = now()
      where call_lead_id = ${leadId} and done_at is null
    `);
    await db.execute(sql`
      insert into call_meeting_followup
        (meeting_id, user_id, result, notes, for_start_at)
      select m.id, ${me.id}, 'cancelled',
        ${body.outcome === "lost" ? "Closed: logged as lost." : "Closed: logged as not interested."},
        m.start_at
      from call_meeting m
      where m.call_lead_id = ${leadId}
        and m.status = 'accepted'
        and m.start_at <= now()
        and not exists (
          select 1 from call_meeting_followup fu
          where fu.meeting_id = m.id and fu.for_start_at = m.start_at
            and fu.result = 'cancelled'
        )
    `);
  }

  /**
   * Claim the booking this call just made, without waiting for the sync.
   *
   * The Cal.com sync links a meeting to the call that booked it, and it runs
   * every five minutes — so a prospect who books while still on the phone
   * produces a meeting the CRM sees *before* the caller has pressed Demo
   * booked. Aaron's Garbage Removal demo missed by thirteen seconds and Next
   * Level Haul Away by fifty-six. Both healed on the next tick, and in between
   * the card said nobody had booked it and offered no way to log attendance,
   * which is the part somebody notices.
   *
   * So the save does it too. `call_id is null` is the whole guard: a meeting
   * already attached to a call is never taken off it, so this can only ever
   * fill a gap the sync would have filled later. `kind = 'demo'`, because
   * logging a demo says nothing about a follow-up booking; and the soonest
   * upcoming one, since a caller booking now is booking the next one.
   */
  if (body.outcome === "demo_booked") {
    await db.execute(sql`
      update call_meeting
      set call_id = ${row.id}
      where id = (
        select m.id from call_meeting m
        where m.call_lead_id = ${leadId}
          and m.call_id is null
          and m.kind = 'demo'
          and m.status = 'accepted'
          and m.start_at > now()
        order by m.start_at asc
        limit 1
      )
    `);
  }

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
  // `getCurrentUser`, not the cookie's `loggedIn` flag: that flag is written at
  // sign-in and stays true for the thirty days the cookie lives, so a person
  // switched off on Monday could still write calls from the session already in
  // their pocket. This route is outside the middleware matcher, so it is the
  // only guard there is.
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    callLeadId?: unknown;
    outcome?: unknown;
    callbackAt?: unknown;
    contactEmail?: unknown;
    contactName?: unknown;
    notes?: unknown;
    keepOutOfQueue?: unknown;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const leadId = Number(body.callLeadId);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }

  // The same answer as a lead that does not exist, as a list a caller may not
  // open gets: nothing here says whether the id is real.
  if (!(await canEditLead(me, leadId))) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }


  // Notes typed into the Spreadsheet's Notes cell. That column is the latest
  // call's notes, so an edit rewrites them in place: not an outcome change and
  // not a new attempt, the same reasoning as the rest of this route. It was not
  // editable at all until 2026-09-15, and a caller who wanted to add what a
  // prospect said after the fact had nowhere to put it.
  if (body.outcome === undefined && typeof body.notes === "string") {
    const latest = await latestCallFor(leadId);
    if (!latest) {
      return Response.json(
        { error: "This lead has no calls yet. Log a call first: notes belong to a call." },
        { status: 400 },
      );
    }
    const notes = body.notes.trim() === "" ? null : body.notes.trim().slice(0, 5000);
    await db.update(call).set({ notes }).where(eq(call.id, latest.id));
    return Response.json({ id: latest.id, notes });
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

  // The same write-back the log route does, for a call relabelled as a demo
  // from the Spreadsheet's booking step: the email is what the invite and the
  // reminders go to.
  if (body.outcome === "demo_booked") {
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
  }

  const existing = await latestCallFor(leadId);

  let callbackAt: Date | null = null;
  if (body.outcome === "callback") {
    callbackAt =
      parseCallbackAt(
        body.callbackAt,
        (await zoneForLead(leadId)) ?? (await readerZone(me.id)).tz,
      ) ??
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
        userId: me.id,
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
    .set({
      outcome: body.outcome,
      callbackAt,
      keepOutOfQueue: await keepsOutOfQueue(
        leadId,
        body.outcome,
        body.keepOutOfQueue,
        existing.id,
      ),
    })
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
  // `getCurrentUser`, not the cookie's `loggedIn` flag: that flag is written at
  // sign-in and stays true for the thirty days the cookie lives, so a person
  // switched off on Monday could still write calls from the session already in
  // their pocket. This route is outside the middleware matcher, so it is the
  // only guard there is.
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = Number(searchParams.get("callLeadId"));
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: "Invalid lead." }, { status: 400 });
  }

  // The same answer as a lead that does not exist, as a list a caller may not
  // open gets: nothing here says whether the id is real.
  if (!(await canEditLead(me, leadId))) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
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

/** The number a browser caller's calls go out from, or null for a handset
 *  caller (their own phone is the caller ID, which is not one of ours). */
async function dialledFromFor(userId: number): Promise<string | null> {
  const [u] = (await db.execute(sql`
    select telnyx_did, dial_method from app_user where id = ${userId}
  `)) as { telnyx_did: string | null; dial_method: string }[];
  return u && u.dial_method === "browser" ? (u.telnyx_did ?? null) : null;
}
