import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/**
 * When the founders get the payday reminder.
 *
 * Its own route rather than an addition to `/api/settings`, which is an Email
 * CRM screen guarded by `denyIfNotEmailUser` — the wrong gate entirely for a
 * Call CRM setting, and one that would let an email user change when the
 * calling floor gets paid.
 *
 * Admin-only, checked with `getCurrentUser` rather than the session flag:
 * `/api` is outside the middleware matcher, so this guard is the only one
 * there is, and `session.loggedIn` is a cookie flag that says nothing about
 * who is holding it or whether they are still switched on.
 */
export async function PATCH(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only founders can change the payday reminder." },
      { status: 403 },
    );
  }

  let body: { on?: unknown; weekday?: unknown; hour?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.on !== "boolean") {
    return Response.json({ error: "on must be a boolean." }, { status: 400 });
  }
  const weekday = Number(body.weekday);
  const hour = Number(body.hour);
  // ISO weekday, Monday first — the order `payWeekStart` cuts the week on.
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return Response.json(
      { error: "weekday must be 1 (Monday) to 7 (Sunday)." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return Response.json({ error: "hour must be 0 to 23." }, { status: 400 });
  }

  const values = {
    payrollReminderOn: body.on,
    payrollReminderWeekday: weekday,
    payrollReminderHour: hour,
  };

  // The single-row settings table, created with its defaults if nothing has
  // asked for it yet — the pattern `scheduler.ts` and `campaign-progress.ts`
  // both use.
  const [existing] = await db
    .select({ id: appSetting.id })
    .from(appSetting)
    .limit(1);
  if (existing) {
    await db
      .update(appSetting)
      .set(values)
      .where(eq(appSetting.id, existing.id));
  } else {
    await db.insert(appSetting).values(values);
  }

  return Response.json({ ok: true });
}
