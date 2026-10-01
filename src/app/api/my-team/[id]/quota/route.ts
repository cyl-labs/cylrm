import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { canManage } from "@/lib/managers";

/**
 * Set the weekly calls owed by one of the caller's own people (2026-10-01).
 *
 * `canManage` is the whole permission: it is a founder, or the person this one
 * reports to, and never the caller themselves (so a manager cannot lower his
 * own quota). The number is stored with who set it and when, so a change can
 * be traced on Team. Null puts them back on the default. Pay does not read it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }
  if (!(await canManage(me, targetId))) {
    return Response.json(
      { error: "That person is not on your team." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    weeklyQuota?: unknown;
  } | null;
  const q = body?.weeklyQuota;
  if (
    q === undefined ||
    (q !== null && !(Number.isInteger(q) && (q as number) >= 0 && (q as number) <= 5000))
  ) {
    return Response.json(
      { error: "Quota must be a whole number of calls, or empty for the default." },
      { status: 400 },
    );
  }

  await db
    .update(appUser)
    .set({
      weeklyQuota: q as number | null,
      weeklyQuotaBy: me.id,
      weeklyQuotaAt: new Date(),
    })
    .where(eq(appUser.id, targetId));
  return Response.json({ ok: true });
}
