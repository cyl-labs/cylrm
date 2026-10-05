import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { parseCallbackAt } from "@/lib/call-time";
import { readerZone } from "@/lib/users";

const DEMO_MINUTES = 30;

/**
 * Hand a closer a practice meeting, `{ closerUserId, partnerUserId, at }`
 * (2026-10-05).
 *
 * For training new closers: they ring a "prospect" who is really a colleague's
 * CRM line, merge the voice agent in, and say how it went, with none of it
 * counting. The row is an ordinary `call_meeting` flagged `training`, with no
 * lead and no booking call, so there is nothing for payroll, Stats, the
 * reminders or the digest to pick up (each reads `not m.training` as well). The
 * partner may be a founder or another closer, which is the founder's choice.
 *
 * `at` is read on the founder's clock, as the other time boxes are. Founders
 * only, and `/api` is outside the middleware matcher, so this is the guard.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only a founder can set up training meetings." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    closerUserId?: unknown;
    partnerUserId?: unknown;
    at?: unknown;
    tz?: unknown;
  } | null;
  const closerId = Number(body?.closerUserId);
  const partnerId = Number(body?.partnerUserId);
  if (!Number.isInteger(closerId) || !Number.isInteger(partnerId)) {
    return Response.json(
      { error: "Pick who is training and who plays the prospect." },
      { status: 400 },
    );
  }
  if (closerId === partnerId) {
    return Response.json(
      { error: "The prospect has to be somebody other than the closer." },
      { status: 400 },
    );
  }

  // The zone the form was labelled with, so the time means what it said it
  // meant: the screen's clock can come from the picker, not only the account.
  let zone: string = (await readerZone(me.id)).tz;
  if (typeof body?.tz === "string") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.tz });
      zone = body.tz;
    } catch {
      // Keep the account's own zone.
    }
  }
  const startAt = parseCallbackAt(body?.at, zone);
  if (!startAt) {
    return Response.json({ error: "Pick a day and a time." }, { status: 400 });
  }
  if (startAt.getTime() < Date.now() - 15 * 60_000) {
    return Response.json(
      { error: "That time has already passed. Pick a time that is still ahead." },
      { status: 400 },
    );
  }

  const people = (await db.execute(sql`
    select id, name, role, telnyx_did from app_user
    where active and id in (${closerId}, ${partnerId})
  `)) as { id: number; name: string; role: string; telnyx_did: string | null }[];
  const closer = people.find((p) => Number(p.id) === closerId);
  const partner = people.find((p) => Number(p.id) === partnerId);
  if (!closer || closer.role !== "closer") {
    return Response.json({ error: "That person is not an active closer." }, { status: 400 });
  }
  if (!partner) {
    return Response.json({ error: "The prospect is not an active account." }, { status: 400 });
  }
  if (!partner.telnyx_did) {
    return Response.json(
      {
        error: `${partner.name} has no phone line assigned, so there is no number to ring. Assign one on Team first.`,
      },
      { status: 400 },
    );
  }

  const [row] = (await db.execute(sql`
    insert into call_meeting (
      cal_booking_uid, matched_by, start_at, end_at, status, title,
      attendee_name, attendee_phone, attendee_tz, kind,
      closer_user_id, training, synced_at
    ) values (
      ${`training-${randomUUID()}`}, 'manual',
      ${startAt.toISOString()}::timestamptz,
      ${new Date(startAt.getTime() + DEMO_MINUTES * 60_000).toISOString()}::timestamptz,
      'accepted', ${`Training: ${partner.name} plays the prospect`},
      ${partner.name}, ${partner.telnyx_did}, ${zone}, 'demo',
      ${closerId}, true, now()
    )
    returning id
  `)) as { id: number }[];

  return Response.json({ id: row.id, closer: closer.name, partner: partner.name });
}
