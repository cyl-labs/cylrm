import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt, prospectZone } from "@/lib/call-time";
import { zoneForLead } from "@/lib/calls";
import { readerZone } from "@/lib/users";

/**
 * Change a founders' call back, mark it done, or remove it. Founders only.
 *
 * `{ at?, notes?, done? }` on PATCH. "Change time" moves only this entry:
 * nothing is sent to the prospect, which is the reason it is not a Cal.com
 * reschedule.
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
  } | null;

  const [fc] = (await db.execute(sql`
    select fc.id, fc.call_lead_id, m.attendee_tz
    from founder_call fc
    left join call_meeting m on m.id = fc.meeting_id
    where fc.id = ${id}
  `)) as { id: number; call_lead_id: number | null; attendee_tz: string | null }[];
  if (!fc) return Response.json({ error: "Call back not found." }, { status: 404 });

  if (body?.done === true) {
    await db.execute(sql`
      update founder_call set done_at = coalesce(done_at, now()) where id = ${id}
    `);
    return Response.json({ ok: true, done: true });
  }

  let startAt: Date | null = null;
  if (body?.at !== undefined) {
    const zone =
      prospectZone(
        fc.call_lead_id === null ? null : await zoneForLead(fc.call_lead_id),
        fc.attendee_tz,
      ) ?? (await readerZone(me.id)).tz;
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
