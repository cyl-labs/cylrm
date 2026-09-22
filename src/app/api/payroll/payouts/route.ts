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
 * Log a payment to one caller, and reset only what it actually settled.
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
    covers?: unknown;
  } | null;

  const userId = Number(body?.userId);
  if (!Number.isInteger(userId)) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }

  /**
   * Which half of the pay this settles.
   *
   * Defaults to both, so anything that called this route before the screen
   * had two buttons still means what it meant. The screen itself always names
   * one: the two rates are earned on different clocks — a pickup bonus over a
   * week of dialling, a $30 fee the moment a founder marks a demo — and
   * paying one used to force the other, because the counter ran from the last
   * payout of *any* kind.
   */
  const covers: "all" | "pickups" | "meetings" =
    body?.covers === "pickups" || body?.covers === "meetings"
      ? body.covers
      : "all";
  const paysPickups = covers !== "meetings";
  const paysMeetings = covers !== "pickups";
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
            -- The counter's boundary: the last row that settled or banked
            -- pickups. A meetings-only payout is not one, which is what lets
            -- the $30 fees be paid mid-week without binning the progress
            -- toward the next fifty. Must stay in step with lib/payroll.ts,
            -- which restates it for the screen. (No backticks in here: this
            -- is inside a template literal and one would end the string.)
            select paid_at from payout
            where payout.user_id = u.id
              and payout.kind in ('payment', 'reset', 'pickups')
            order by paid_at desc
            limit 1
          ) as last_paid_at,
          (
            select paid_at from payout
            where payout.user_id = u.id
              and payout.kind in ('payment', 'pickups')
            order by paid_at desc
            limit 1
          ) as last_payment_at
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

      // The money's boundary is the last *payment*; the counter's is the last
      // row of either kind. A reset banks rather than settles, so it moves the
      // second and not the first.
      const moneyStart = (person.last_payment_at ??
        person.created_at) as string | Date;

      const [counts] = (await tx.execute(sql`
        select
          (
            select count(*) from "call" c
            where c.user_id = ${userId}
              and c.outcome in ${PICKUP}
              and c.called_at > ${periodStart}
          ) as pickups,
          (
            -- Fifties banked by every reset since the last payment. Their
            -- periods tile without gaps, so these are unpaid by construction.
            select coalesce(sum(r.banked_bonus_cents), 0)
            from payout r
            where r.user_id = ${userId}
              and r.kind = 'reset'
              and r.paid_at > ${moneyStart}
          ) as banked
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
          and a.status = 'showed_up'
          and a.payout_id is null
        for update of a
      `)) as Record<string, unknown>[];

      const pickups = Number(counts?.pickups ?? 0);
      const banked = Number(counts?.banked ?? 0);
      const meetings = owed.length;

      // Nothing owed is not an error worth a stack trace, but it must not
      // write a row: a $0 payout would move the period boundary and throw away
      // whatever pickups had accumulated. It also makes a double-clicked
      // button harmless, since the second press finds a fresh period.
      // Banked money counts as something owed: somebody whose counter was
      // reset to nought on Friday and who has not called since is still owed
      // what the reset put aside, and refusing to pay it would be the missed
      // payment this file exists to prevent.
      // Judged against what was actually asked for, so "Pay meetings" on
      // somebody with pickups and no demos is refused rather than quietly
      // writing a $0 row that would move their counter — the exact side
      // effect the two buttons exist to remove.
      const pickupsOwed = pickups > 0 || banked > 0;
      if (paysPickups && !paysMeetings && !pickupsOwed) {
        return { error: "No pickups to pay for.", status: 409 } as const;
      }
      if (paysMeetings && !paysPickups && meetings === 0) {
        return { error: "No meetings to pay for.", status: 409 } as const;
      }
      if (!pickupsOwed && meetings === 0) {
        return { error: "Nothing owed.", status: 409 } as const;
      }

      // Only the half being settled carries a figure. The other stays nought
      // so the row is a truthful snapshot of what this payment covered.
      const paidPickups = paysPickups ? pickups : 0;
      const bonus = paysPickups ? pickupBonusCents(pickups) : 0;
      const bankedPaid = paysPickups ? banked : 0;
      const paidMeetings = paysMeetings ? meetings : 0;
      const commission = paidMeetings * MEETING_CENTS;
      const kind = covers === "all" ? "payment" : covers;

      const [row] = (await tx.execute(sql`
        insert into payout (
          user_id, kind, period_start, period_end, week_start,
          pickups, pickup_bonus_cents, banked_bonus_cents,
          meetings, meeting_commission_cents, total_cents,
          pickups_per_bonus, pickup_bonus_rate_cents, meeting_rate_cents,
          note, created_by_user_id
        ) values (
          ${userId}, ${kind},
          -- A meetings-only payout settles no pickup period, and claiming one
          -- would be a lie in the table whose whole job is to be the record
          -- nobody has to take on trust. An empty window says so; which demos
          -- it covered is on call_demo_attendance.payout_id, which is the
          -- only place that question is ever answered from.
          ${paysPickups ? sql`${periodStart}` : sql`now()`}, now(), ${weekStart},
          ${paidPickups}, ${bonus}, ${bankedPaid},
          ${paidMeetings}, ${commission}, ${bonus + bankedPaid + commission},
          ${PICKUPS_PER_BONUS}, ${PICKUP_BONUS_CENTS}, ${MEETING_CENTS},
          ${note}, ${me.id}
        )
        returning id, total_cents
      `)) as Record<string, unknown>[];

      const payoutId = Number(row.id);

      if (paidMeetings > 0) {
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
        kind,
        name: String(person.name),
        pickups: paidPickups,
        meetings: paidMeetings,
        bankedCents: bankedPaid,
        totalCents: bonus + bankedPaid + commission,
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
