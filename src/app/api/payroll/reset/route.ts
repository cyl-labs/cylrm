import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";
import { PICKUP } from "@/lib/call-stats";
import {
  MEETING_CENTS,
  PICKUPS_PER_BONUS,
  PICKUP_BONUS_CENTS,
  payWeekStart,
} from "@/lib/payroll";

/**
 * Start someone's pickup counter again from now, without paying them.
 *
 * A counter begins at its owner's last payout, so zeroing one used to mean
 * recording a payment that never happened. That is a lie in the one table
 * whose whole job is to be the record nobody has to take on trust, so a reset
 * is its own kind of row: it moves the boundary exactly as a payment does,
 * claims no money, and still snapshots the count it cleared.
 *
 * That snapshot is what makes this reversible. Nothing is deleted — the
 * `call` rows are untouched, and deleting the reset row puts the old count
 * back, because the counter is derived and not stored.
 *
 * What it is for: a counter whose *start date* is wrong rather than whose
 * calls are. Every caller had months of pickups predating the payroll
 * arrangement the day it shipped.
 *
 * It deliberately does **not** touch meeting commission. An attended meeting
 * is owed regardless of when the counter started — that is the whole reason
 * commission is pinned by payout id rather than compared against a date — and
 * a reset that quietly swallowed it would be the missed payment this design
 * exists to prevent. Commission is cleared only by paying it.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "Only an admin can reset a counter." },
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
        return { error: "Only callers are on payroll.", status: 400 } as const;
      }

      const periodStart = (person.last_paid_at ??
        person.created_at) as string | Date;

      const [counts] = (await tx.execute(sql`
        select count(*) as pickups from "call" c
        where c.user_id = ${userId}
          and c.outcome in ${PICKUP}
          and c.called_at > ${periodStart}
      `)) as Record<string, unknown>[];

      const pickups = Number(counts?.pickups ?? 0);

      // Nothing to clear is not an error, but it must not write a row: a reset
      // of a counter already at zero is a line in the history that records
      // nothing having happened.
      if (pickups === 0) {
        return { error: "That counter is already at zero.", status: 409 } as const;
      }

      // Every money column is zero, including the bonus the count would
      // otherwise have earned. Reading "84 pickups, $0" would look like a bug
      // in a `payment` row; in a `reset` row it is the whole point.
      const [row] = (await tx.execute(sql`
        insert into payout (
          user_id, kind, period_start, period_end, week_start,
          pickups, pickup_bonus_cents,
          meetings, meeting_commission_cents, total_cents,
          pickups_per_bonus, pickup_bonus_rate_cents, meeting_rate_cents,
          note, created_by_user_id
        ) values (
          ${userId}, 'reset', ${periodStart}, now(), ${weekStart},
          ${pickups}, 0,
          0, 0, 0,
          ${PICKUPS_PER_BONUS}, ${PICKUP_BONUS_CENTS}, ${MEETING_CENTS},
          ${note}, ${me.id}
        )
        returning id
      `)) as Record<string, unknown>[];

      return {
        ok: true as const,
        resetId: Number(row.id),
        name: String(person.name),
        pickupsCleared: pickups,
      };
    });

    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  } catch (err) {
    console.error("counter reset failed", err);
    return Response.json(
      { error: "Could not reset the counter." },
      { status: 500 },
    );
  }
}
