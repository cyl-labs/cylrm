import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/**
 * Change a founders' call back, mark it done, or remove it. Founders only.
 *
 * `{ at?, notes?, done?, retry?, dead? }` on PATCH. "Change time" moves only
 * this entry: nothing is sent to the prospect, which is the reason it is not a
 * Cal.com reschedule.
 *
 * - `retry` is "No answer, try tomorrow": counts the try and moves the call
 *   back to the same wall-clock time tomorrow where the prospect is — from
 *   their today, not from the old date, so a call back three days overdue
 *   does not land in the past again.
 * - `dead` closes it and records the no-show's ring back as "Not rebooking",
 *   exactly as Dead in the no-show pop-up does, so both roads leave the same
 *   record behind.
 */
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
    at?: unknown;
    notes?: unknown;
    done?: unknown;
    retry?: unknown;
    dead?: unknown;
  } | null;

  const [fc] = (await db.execute(sql`
    select fc.id, fc.call_lead_id, fc.meeting_id, fc.tries, m.attendee_tz
    from founder_call fc
    left join call_meeting m on m.id = fc.meeting_id
    where fc.id = ${id}
  `)) as {
    id: number;
    call_lead_id: number | null;
    meeting_id: number | null;
    tries: number;
    attendee_tz: string | null;
  }[];
  if (!fc) return Response.json({ error: "Call back not found." }, { status: 404 });

  // The prospect's clock, the way every call back time is read.
  const zoneOf = async () =>
    prospectZone(
      fc.call_lead_id === null ? null : await zoneForLead(fc.call_lead_id),
      fc.attendee_tz,
    ) ?? (await readerZone(me.id)).tz;

  if (body?.retry === true) {
    const zone = await zoneOf();
    const [row] = (await db.execute(sql`
      update founder_call set
        tries = tries + 1,
        last_tried_at = now(),
        -- Their today plus one, at the wall-clock time it was set for. Local
        -- arithmetic, then back to an instant: the zone database handles a
        -- daylight-saving change in between, which a fixed 24 hours would not.
        start_at = (
          ((now() at time zone ${zone})::date + 1)
          + (start_at at time zone ${zone})::time
        ) at time zone ${zone}
      where id = ${id}
      returning start_at, tries
    `)) as { start_at: string; tries: number }[];
    return Response.json({
      ok: true,
      startAt: new Date(row.start_at).toISOString(),
      tries: Number(row.tries),
    });
  }

  if (body?.dead === true) {
    const tries = Number(fc.tries ?? 0);
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update founder_call set done_at = coalesce(done_at, now()) where id = ${id}
      `);
      // The same record Dead in the no-show pop-up leaves: the ring back logged
      // as "Not rebooking" against the meeting's current time.
      if (fc.meeting_id !== null) {
        await tx.execute(sql`
          insert into call_meeting_followup
            (meeting_id, user_id, result, notes, for_start_at)
          select m.id, ${me.id}, 'cancelled',
            ${`Dead after ${tries} unanswered ${tries === 1 ? "try" : "tries"}: not following up.`},
            m.start_at
          from call_meeting m
          where m.id = ${fc.meeting_id}
        `);
      }
    });
    return Response.json({ ok: true, dead: true });
  }

  if (body?.done === true) {
    await db.execute(sql`
      update founder_call set done_at = coalesce(done_at, now()) where id = ${id}
    `);
    return Response.json({ ok: true, done: true });
  }

  let startAt: Date | null = null;
  if (body?.at !== undefined) {
    const zone = await zoneOf();
    startAt = parseCallbackAt(body.at, zone);
    if (!startAt) {
      return Response.json({ error: "Pick a day and a time." }, { status: 400 });
    }
  }
  const notes =
    body?.notes === undefined
      ? undefined
      : typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, 2000)
        : null;

  await db.execute(sql`
    update founder_call set
      start_at = ${startAt ? startAt.toISOString() : sql`start_at`},
      notes = ${notes === undefined ? sql`notes` : notes}
    where id = ${id}
  `);
  return Response.json({ ok: true });
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
