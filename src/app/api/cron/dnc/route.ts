import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DNC_VALID_DAYS, dncEnforced } from "@/lib/dnc";

/**
 * Re-screen US leads against the locally held Do Not Call register.
 *
 * One statement, because the register is a table we own rather than a service
 * we call: no batching, no rate limit, no per-number cost. The whole job is a
 * set membership test.
 *
 * A lead is only marked from a *fresh* snapshot. Marking it against an area
 * code downloaded a year ago would give a lead a recent `dnc_checked_at` and
 * make it look screened, which is the same trap as storing a status with no
 * date — one level further up. A lead whose area code was never downloaded is
 * left unchecked, which blocks it.
 *
 * Singapore leads are never touched — see the note at the top of lib/dnc.ts.
 * The US filter is done in SQL rather than in JS afterwards, because unscreened
 * leads have a null `dnc_checked_at`, sort first, and would otherwise fill
 * every page and crowd the US leads out permanently.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Dormant until switched on, and this guard is what makes the feature safe
  // to ship unfinished: the worker calls this every five minutes, and the
  // tables it reads only exist where the DNC migrations have been applied.
  // Without the early return, a deploy to a database that has not seen them
  // puts a 500 in the worker log every tick, for a feature nobody is using.
  if (!dncEnforced()) {
    return NextResponse.json({
      ok: true,
      job: "dnc",
      skipped: "DNC_ENFORCE is not set",
    });
  }

  const stale = sql`${`${DNC_VALID_DAYS} days`}::interval`;

  const rows = (await db.execute(sql`
    with fresh as (
      select area_code from dnc_area_code where loaded_at > now() - ${stale}
    ),
    target as (
      select l.id,
             -- phone_key is E.164 digits, so a US number is 1 + 10 more.
             substr(l.phone_key, 2, 3) as area_code,
             substr(l.phone_key, 2)    as national
      from call_lead l
      where l.duplicate_of_lead_id is null
        and l.phone_key like '1%'
        and length(l.phone_key) = 11
        and (
          l.dnc_checked_at is null
          or l.dnc_checked_at < now() - ${stale}
        )
    )
    update call_lead l
    set dnc_status = case
          when exists (select 1 from dnc_number n where n.number = t.national)
          then 'listed' else 'clean' end,
        dnc_checked_at = now(),
        dnc_source = 'us_ftc',
        dnc_detail = jsonb_build_object('area_code', t.area_code)
    from target t
    where l.id = t.id
      and t.area_code in (select area_code from fresh)
    returning l.dnc_status
  `)) as { dnc_status: string }[];

  const listed = rows.filter((r) => r.dnc_status === "listed").length;

  // What could not be screened, and why — otherwise "checked: 0" is
  // indistinguishable from "nothing needed checking".
  const [gap] = (await db.execute(sql`
    select
      count(*) filter (
        where substr(phone_key, 2, 3) not in (select area_code from dnc_area_code)
      ) as area_code_never_loaded,
      count(*) filter (
        where substr(phone_key, 2, 3) in (
          select area_code from dnc_area_code where loaded_at <= now() - ${stale}
        )
      ) as snapshot_stale
    from call_lead
    where duplicate_of_lead_id is null
      and phone_key like '1%' and length(phone_key) = 11
  `)) as { area_code_never_loaded: string; snapshot_stale: string }[];

  return NextResponse.json({
    ok: true,
    job: "dnc",
    checked: rows.length,
    listed,
    areaCodeNeverLoaded: Number(gap?.area_code_never_loaded ?? 0),
    snapshotStale: Number(gap?.snapshot_stale ?? 0),
  });
}
