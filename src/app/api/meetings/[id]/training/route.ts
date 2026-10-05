import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

const OUTCOMES = ["showed_up", "no_show", "not_interested", "booked_follow_up"];

async function load(id: number) {
  const [m] = (await db.execute(sql`
    select id, closer_user_id, training from call_meeting where id = ${id}
  `)) as { id: number; closer_user_id: number | null; training: boolean }[];
  return m ?? null;
}

/**
 * Say how a practice meeting went, `{ outcome }`, or clear it with `null`.
 *
 * The closer it was handed to, or a founder. Written to `training_outcome`
 * only: the real answer route (`/api/payroll/attendance`) is never involved,
 * which is what keeps a practice answer out of payroll. Refuses a meeting that
 * is not a training one, so this cannot be used to skip the real route.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  const m = await load(id);
  if (!m || !m.training) {
    return Response.json({ error: "Training meeting not found." }, { status: 404 });
  }
  if (me.role !== "admin" && Number(m.closer_user_id) !== me.id) {
    return Response.json({ error: "That meeting is not yours." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { outcome?: unknown } | null;
  const outcome = body?.outcome ?? null;
  if (outcome !== null && (typeof outcome !== "string" || !OUTCOMES.includes(outcome))) {
    return Response.json({ error: "Unknown outcome." }, { status: 400 });
  }

  await db.execute(sql`
    update call_meeting set training_outcome = ${outcome} where id = ${id} and training
  `);
  return Response.json({ ok: true });
}

/**
 * Remove a practice meeting. Founders only. Nothing else holds on to one (no
 * lead, no attendance, no payroll row), so deleting the row is the whole of
 * undoing it; its reminders and notes go with it by cascade.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Only a founder can remove these." }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }
  const gone = (await db.execute(sql`
    delete from call_meeting where id = ${id} and training returning id
  `)) as { id: number }[];
  if (gone.length === 0) {
    return Response.json({ error: "Training meeting not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
