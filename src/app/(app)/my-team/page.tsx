import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageShell } from "@/components/page-shell";
import { ReportQuota } from "@/components/team/report-quota";
import { WEEKLY_CALL_QUOTA, quotaFraction } from "@/lib/call-quota";
import { PICKUP, quotaWeekStart } from "@/lib/call-stats";
import { reportsOf } from "@/lib/managers";
import { getPayrollRows } from "@/lib/payroll";
import { formatMoney } from "@/lib/payroll-rates";
import { getCurrentUser } from "@/lib/session";
import { readerZone } from "@/lib/users";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  name: string;
  active: boolean;
  weekly_quota: number | null;
  last_call: string | null;
  calls: string | number;
  pickups: string | number;
  demos: string | number;
  lists: string | number;
};

/**
 * The people a manager looks after (2026-10-01).
 *
 * Reachable only by somebody a founder has put in charge of other callers, and
 * only ever shows those people: the roster is `reportsOf(me.id)` and nothing
 * on the page takes an id from the address. Everything here is a view over what
 * the founders' Stats already counts, with the same definition of a call and a
 * pickup; the person's own Stats and recordings are one tap away, and the page
 * they open is scoped by the same list.
 *
 * Founders are turned away: they have Team and Stats, which show everyone.
 */
export default async function MyTeamPage() {
  const me = await getCurrentUser();
  if (!me || me.role === "admin") notFound();
  const reports = await reportsOf(me.id);
  if (reports.length === 0) notFound();

  const zone = await readerZone(me.id);
  // What each of them is owed right now, only for the people a founder has set
  // to be paid through this manager. Read-only: the founders send the money and
  // record it, the manager passes it on.
  const owed = new Map(
    (await getPayrollRows())
      .filter((p) => p.paidViaUserId === me.id)
      .map((p) => [p.userId, p]),
  );
  const owedTotal = [...owed.values()].reduce((sum, p) => sum + p.totalCents, 0);
  const { at } = await quotaWeekStart();
  const ids = reports.map((r) => sql`${r.id}`);
  const rows = (await db.execute(sql`
    select u.id, u.name, u.active, u.weekly_quota,
      max(c.called_at) as last_call_any,
      count(c.id) filter (where c.called_at >= ${at.toISOString()}::timestamptz) as calls,
      count(c.id) filter (
        where c.called_at >= ${at.toISOString()}::timestamptz and c.outcome in ${PICKUP}
      ) as pickups,
      count(c.id) filter (
        where c.called_at >= ${at.toISOString()}::timestamptz and c.outcome = 'demo_booked'
      ) as demos,
      (select count(*) from call_list cl where cl.assigned_user_id = u.id) as lists
    from app_user u
    left join "call" c on c.user_id = u.id
    where u.id in (${sql.join(ids, sql`, `)})
    group by u.id
    order by u.active desc, u.name
  `)) as unknown as (Row & { last_call_any: string | null })[];

  const when = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone.tz,
  });

  return (
    <PageShell title="My team">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 sm:px-6">
        <p className="text-[13px] text-muted-foreground">
          These are the callers you look after. Calls are counted from the start
          of this quota week, the same way the bar under the header counts
          yours. Open someone&rsquo;s stats to see every call they made and
          listen back to the recordings. Accounts, lists and pay are still set
          by the founders.
        </p>
        {owed.size > 0 && (
          <div className="rounded-[14px] border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted-foreground">
              Pay you pass on
            </p>
            <p className="mt-1 text-[22px] font-extrabold tabular-nums">
              {formatMoney(owedTotal)}
            </p>
            <p className="text-[12px] text-muted-foreground">
              Owed now to the people below who are paid through you. The
              founders send you this total when they pay out, and each
              person&rsquo;s share is on their card.
            </p>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const calls = Number(r.calls);
            const quota = r.weekly_quota ?? WEEKLY_CALL_QUOTA;
            const met = calls >= quota;
            const last = r.last_call_any ? when.format(new Date(r.last_call_any)) : null;
            return (
              <li
                key={r.id}
                className={cn(
                  "rounded-[14px] border bg-card p-4 shadow-[0_1px_3px_rgba(41,47,76,0.05)]",
                  !r.active && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px] font-extrabold tracking-[-0.01em]">
                    {r.name}
                    {!r.active && (
                      <span className="ml-2 text-[11px] font-semibold text-muted-foreground">
                        Switched off
                      </span>
                    )}
                  </p>
                  <Link
                    href={`/call-stats?person=${r.id}`}
                    className="text-[13px] font-semibold text-primary hover:underline"
                  >
                    Stats and recordings
                  </Link>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        met ? "bg-success" : "bg-primary",
                      )}
                      style={{ width: `${Math.round(quotaFraction(calls, quota) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[13px] font-semibold tabular-nums",
                      met ? "text-success" : "text-foreground",
                    )}
                  >
                    {calls.toLocaleString("en-US")} / {quota.toLocaleString("en-US")} calls
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {Number(r.pickups)} pickups, {Number(r.demos)} demos booked this
                  week. {last ? `Last call ${last} (${zone.name}).` : "No calls yet."}{" "}
                  {Number(r.lists) === 0 ? "No call lists assigned." : null}
                </p>

                {owed.get(r.id) && (
                  <p className="mt-2 text-[13px]">
                    <span className="font-semibold">
                      Owed now: {formatMoney(owed.get(r.id)!.totalCents)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      ({owed.get(r.id)!.pickups} pickups since the last payout
                      {owed.get(r.id)!.bankedBonusCents > 0 ? ", plus banked bonus" : ""}
                      , {owed.get(r.id)!.meetings}{" "}
                      {owed.get(r.id)!.meetings === 1 ? "meeting" : "meetings"}{" "}
                      that showed up
                      {(owed.get(r.id)!.halfMeetings ?? 0) > 0
                        ? `, plus ${owed.get(r.id)!.halfMeetings} half fee`
                        : ""}
                      ). Paid to you to pass on.
                    </span>
                  </p>
                )}

                <div className="mt-3">
                  <ReportQuota
                    userId={r.id}
                    name={r.name}
                    quota={r.weekly_quota}
                    fallback={WEEKLY_CALL_QUOTA}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </PageShell>
  );
}
