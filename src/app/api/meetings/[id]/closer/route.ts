import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Hand a meeting to a closer, or back to the founders (`closerUserId: null`).
 *
 * Founders only (2026-09-25). A closer can close only what a founder has
 * given them, so this is the whole of that permission: the attendance,
 * contracts and brief routes all read `call_meeting.closer_user_id` rather than
 * trusting anything the browser says. `/api` is outside the middleware
 * matcher, so this check is the only guard.
 *
 * Only an active closer can be named. Handing a meeting to a caller would give
 * them nothing (they cannot close) while taking it off the founders' plate on
 * the screen, which is the worst of both.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only a founder can hand out meetings." },
      { status: 403 },
    );
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid meeting." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    closerUserId?: unknown;
  } | null;
  const raw = body?.closerUserId;
  const closerUserId = raw === null || raw === undefined ? null : Number(raw);
  if (closerUserId !== null && !Number.isInteger(closerUserId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }

  if (closerUserId !== null) {
    const [person] = (await db.execute(sql`
      select role, active from app_user where id = ${closerUserId}
    `)) as { role: string; active: boolean }[];
    if (!person || person.role !== "closer" || !person.active) {
      return Response.json(
        { error: "Only an active closer can take a meeting. Make them a closer on Team first." },
        { status: 400 },
      );
    }
  }

  const updated = (await db.execute(sql`
    update call_meeting set closer_user_id = ${closerUserId}
    where id = ${id}
    returning id
  `)) as { id: number }[];
  if (updated.length === 0) {
    return Response.json({ error: "Meeting not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
