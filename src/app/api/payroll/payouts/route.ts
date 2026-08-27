import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { PICKUP } from "@/lib/call-stats";
import {
  MEETING_CENTS,
  PICKUPS_PER_BONUS,
  PICKUP_BONUS_CENTS,
  payWeekStart,
  pickupBonusCents,
} from "@/lib/payroll";

/**
 * Log a payment to one caller and reset their counters.
 *
 * Everything is recomputed here from the database. The browser sends a user id
 * and nothing else — no amounts, no counts — because a screen that let the
 * client name the figure would be a screen that could be told any figure.
 *
 * The reset is not a delete. Zeroing the pickup count means moving this
 * person's period boundary forward to `paid_at`; every `call` row stays where
 * it is, so any past week can still be reconstructed from source. Likewise the
 * attendances are stamped with this payout's id rather than being cleared,
 * which is what makes "which meetings did that payment cover" answerable.
 *
 * All of it in one transaction: a payout row written without its attendances
 * stamped would pay for those meetings and then offer to pay for them again.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Enforced here rather than by hiding the button: `/api` is outside the
  // middleware's matcher, so this is the only guard on the route.
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can record a payout." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    note?: unknown;
  } | null;

  const userId = Number(body?.userId);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }
  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  const weekStart = payWeekStart();

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the row so two admins pressing the button at the same moment
      // cannot both read the same unpaid balance and both pay it.
      const [person] = (await tx.execute(sql`
        select u.id, u.name, u.role, u.created_at,
          (
            select paid_at from payout
            where payout.user_id = u.id
            order by paid_at desc
            limit 1
          ) as last_paid_at
        from app_user u
        where u.id = ${userId}
        for update
      `)) as Record<string, unknown>[];

      if (!person) return { error: "No such person.", status: 404 } as const;
      if (person.role !== "caller") {
        return {
          error: "Only callers are on payroll.",
          status: 400,
        } as const;
      }

      const periodStart = (person.last_paid_at ??
        person.created_at) as string | Date;

      const [counts] = (await tx.execute(sql`
        select
          (
            select count(*) from "call" c
            where c.user_id = ${userId}
              and c.outcome in ${PICKUP}
              and c.called_at > ${periodStart}
          ) as pickups
      `)) as Record<string, unknown>[];

      // The attendances this payout will claim, resolved to ids first so the
      // update below stamps exactly the rows that were counted — recounting
      // with the same predicate could pick up one marked in between and pay
      // for a meeting the admin was never shown.
      const owed = (await tx.execute(sql`
        select a.id
        from call_demo_attendance a
        join "call" ac on ac.id = a.call_id
        where ac.user_id = ${userId}
          and a.showed_up
          and a.payout_id is null
        for update of a
      `)) as Record<string, unknown>[];

      const pickups = Number(counts?.pickups ?? 0);
      const meetings = owed.length;

      // Nothing owed is not an error worth a stack trace, but it must not
      // write a row: a $0 payout would move the period boundary and throw away
      // whatever pickups had accumulated. It also makes a double-clicked
      // button harmless, since the second press finds a fresh period.
      if (pickups === 0 && meetings === 0) {
        return { error: "Nothing owed.", status: 409 } as const;
      }

      const bonus = pickupBonusCents(pickups);
      const commission = meetings * MEETING_CENTS;

      const [row] = (await tx.execute(sql`
        insert into payout (
          user_id, period_start, period_end, week_start,
          pickups, pickup_bonus_cents,
          meetings, meeting_commission_cents, total_cents,
          pickups_per_bonus, pickup_bonus_rate_cents, meeting_rate_cents,
          note, created_by_user_id
        ) values (
          ${userId}, ${periodStart}, now(), ${weekStart},
          ${pickups}, ${bonus},
          ${meetings}, ${commission}, ${bonus + commission},
          ${PICKUPS_PER_BONUS}, ${PICKUP_BONUS_CENTS}, ${MEETING_CENTS},
          ${note}, ${me.id}
        )
        returning id, total_cents
      `)) as Record<string, unknown>[];

      const payoutId = Number(row.id);

      if (meetings > 0) {
        const ids = owed.map((o) => Number(o.id));
        await tx.execute(sql`
          update call_demo_attendance
          set payout_id = ${payoutId}
          where id in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})
        `);
      }

      return {
        ok: true as const,
        payoutId,
        name: String(person.name),
        pickups,
        meetings,
        totalCents: bonus + commission,
      };
    });

    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (err) {
    console.error("payout failed", err);
    return Response.json(
      { error: "Could not record the payout." },
      { status: 500 },
    );
  }
}
