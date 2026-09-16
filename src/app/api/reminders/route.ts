import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSetting } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";

/**
 * When the founders get each weekly reminder.
 *
 * One route for both rather than a pair of near-identical ones: the guard, the
 * validation and the single-row upsert are the same three things whichever
 * reminder is being moved, and two copies of "is 8 a valid hour" is how they
 * end up disagreeing. `which` names the reminder; everything else is shared.
 *
 * Not an addition to `/api/settings`, which is an Email CRM screen guarded by
 * `denyIfNotEmailUser` — the wrong gate entirely, and one that would let an
 * email user change when the calling floor is told about its own numbers.
 *
 * Admin-only, checked with `getCurrentUser` rather than the session flag:
 * `/api` is outside the middleware matcher, so this guard is the only one
 * there is, and `session.loggedIn` is a cookie flag that says nothing about
 * who holds it or whether they are still switched on.
 */

const FIELDS = {
  payroll: {
    on: "payrollReminderOn",
    weekday: "payrollReminderWeekday",
    hour: "payrollReminderHour",
  },
  quota: {
    on: "quotaDigestOn",
    weekday: "quotaDigestWeekday",
    hour: "quotaDigestHour",
  },
} as const;

type Which = keyof typeof FIELDS;

export async function PATCH(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only founders can change these reminders." },
      { status: 403 },
    );
  }

  let body: { which?: unknown; on?: unknown; weekday?: unknown; hour?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const which = body.which as Which;
  if (which !== "payroll" && which !== "quota") {
    return Response.json(
      { error: 'which must be "payroll" or "quota".' },
      { status: 400 },
    );
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

  const f = FIELDS[which];
  const values = {
    [f.on]: body.on,
    [f.weekday]: weekday,
    [f.hour]: hour,
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
