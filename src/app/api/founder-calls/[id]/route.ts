import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/**
 * A meeting moved to a founders' call back: log what came of the call, move
 * it, or remove it. Founders only — `/api` is outside the middleware matcher.
 *
 * PATCH `{ result?, at?, notes? }`:
 *
 * - **With a `result`** it is the meeting's ring back being logged, in the
 *   ring-back logger's own vocabulary, written to `call_meeting_followup` the
 *   way that logger writes it — so a meeting reads the same however its no-show
 *   was followed up:
 *   - `no_answer` — "No answer, try again": one more try, and the call back
 *     moves to `at`.
 *   - `confirmed` — "Spoke to them, rebooking later": moves to `at`, not a try.
 *   - `rescheduled` — "Rebooked, new time agreed": the call back is over; the
 *     new time goes in through Move this demo, which is a real booking.
 *   - `cancelled` — "Not rebooking": dead, off the list.
 * - **Without one**, `at` and `notes` move the call back and change its note —
 *   "Change time". Nothing is ever sent to the prospect: this is not a Cal.com
 *   reschedule, which is the reason it exists.
 *
 * DELETE removes it.
 */

const RESULTS = ["no_answer", "confirmed", "rescheduled", "cancelled"] as const;
type Result = (typeof RESULTS)[number];
const isResult = (v: unknown): v is Result =>
  typeof v === "string" && (RESULTS as readonly string[]).includes(v);

async function guard(params: Promise<{ id: string }>) {
  const me = await getCurrentUser();
  if (!me) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (me.role !== "admin") {
    return {
      error: Response.json(
        { error: "Only a founder can change a founders' call back." },
        { status: 403 },
      ),
    };
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: Response.json({ error: "Invalid call back." }, { status: 400 }) };
  }
  return { me, id };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(params);
  if ("error" in g) return g.error;
  const { me, id } = g;

  const body = (await request.json().catch(() => null)) as {
    result?: unknown;
    at?: unknown;
    notes?: unknown;
  } | null;
  if (body?.result !== undefined && !isResult(body.result)) {
    return Response.json({ error: "Unknown result." }, { status: 400 });
  }
  const result = body?.result as Result | undefined;

  const [fc] = (await db.execute(sql`
    select fc.id, fc.call_lead_id, fc.meeting_id, m.attendee_tz
    from founder_call fc
    left join call_meeting m on m.id = fc.meeting_id
    where fc.id = ${id} and fc.done_at is null
  `)) as {
    id: number;
    call_lead_id: number | null;
    meeting_id: number | null;
    attendee_tz: string | null;
  }[];
  if (!fc) return Response.json({ error: "Call back not found." }, { status: 404 });

  const moves = result === undefined || result === "no_answer" || result === "confirmed";
  let startAt: Date | null = null;
  if (moves && body?.at !== undefined) {
    // Read in the prospect's zone, like every call back time in the app.
    const zone =
      prospectZone(
        fc.call_lead_id === null ? null : await zoneForLead(fc.call_lead_id),
        fc.attendee_tz,
      ) ?? (await readerZone(me.id)).tz;
    startAt = parseCallbackAt(body.at, zone);
  }
  if ((result === "no_answer" || result === "confirmed") && !startAt) {
    return Response.json(
      { error: "Pick when to call them back." },
      { status: 400 },
    );
  }
  if (result === undefined && body?.at !== undefined && !startAt) {
    return Response.json({ error: "Pick a day and a time." }, { status: 400 });
  }

  const notes =
    typeof body?.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 2000)
      : null;

  await db.transaction(async (tx) => {
    if (result && fc.meeting_id !== null) {
      // The ring back, logged as the ring-back logger logs it: against the
      // booking's own time, copied in the database rather than sent from the
      // browser — see the follow-up route for why.
      await tx.execute(sql`
        insert into call_meeting_followup
          (meeting_id, user_id, result, notes, for_start_at)
        select m.id, ${me.id}, ${result}, ${notes}, m.start_at
        from call_meeting m
        where m.id = ${fc.meeting_id}
      `);
    }
    if (result === "rescheduled" || result === "cancelled") {
      await tx.execute(sql`
        update founder_call set done_at = now() where id = ${id}
      `);
    } else if (result === "no_answer") {
      await tx.execute(sql`
        update founder_call set
          start_at = ${startAt!.toISOString()},
          tries = tries + 1,
          last_tried_at = now()
        where id = ${id}
      `);
    } else if (result === "confirmed") {
      await tx.execute(sql`
        update founder_call set start_at = ${startAt!.toISOString()}
        where id = ${id}
      `);
    } else {
      // Change time and/or the note, nothing logged.
      await tx.execute(sql`
        update founder_call set
          start_at = ${startAt ? startAt.toISOString() : sql`start_at`},
          notes = ${body?.notes === undefined ? sql`notes` : notes}
        where id = ${id}
      `);
    }
  });

  return Response.json({
    ok: true,
    closed: result === "rescheduled" || result === "cancelled",
    startAt: startAt?.toISOString() ?? null,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guard(params);
  if ("error" in g) return g.error;
  await db.execute(sql`delete from founder_call where id = ${g.id}`);
  return Response.json({ ok: true });
}
