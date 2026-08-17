import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { classifyPhone } from "@/lib/calls";
import {
  DNC_VALID_DAYS,
  DncNotConfiguredError,
  checkUnitedStates,
  screened,
} from "@/lib/dnc";

/**
 * How many numbers one tick will screen.
 *
 * Every check costs money, so this is a spend cap as much as a runtime one: a
 * bug that made every lead look stale can waste at most this many lookups per
 * tick instead of the whole list. RealPhoneValidation asks for no more than 10
 * requests a second and this loops serially, so 100 is also roughly a
 * ten-second tick.
 */
const PER_TICK = 100;

/**
 * Re-screen US leads whose Do Not Call check is missing or has lapsed.
 *
 * Runs on the same worker as the scheduler and poller. Doing nothing is the
 * normal outcome: once every US lead has a fresh result this finds no rows,
 * and only about one thirty-first of them fall out of date on any given day.
 *
 * Singapore leads are never screened — see the note at the top of lib/dnc.ts.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The country test has to happen in SQL, not just in JS afterwards. Fetching
  // a page of candidates and filtering them here looks equivalent and is not:
  // every unscreened Singapore lead has a null `dnc_checked_at`, sorts first
  // under `nulls first`, and fills the page — so the US leads are crowded out
  // of every page forever and the job silently checks nothing.
  //
  // `phone_key` is E.164 digits (see phoneKey), so a US number is 11 of them
  // starting with 1. That also matches Singapore toll-free, which is the same
  // shape — `classifyPhone` below is still the authority and drops those.
  const rows = (await db.execute(sql`
    select id, phone
    from call_lead
    where duplicate_of_lead_id is null
      and phone_key like '1%'
      and length(phone_key) = 11
      and (
        dnc_checked_at is null
        or dnc_checked_at < now() - ${`${DNC_VALID_DAYS} days`}::interval
      )
    order by dnc_checked_at asc nulls first, id asc
    limit ${PER_TICK * 5}
  `)) as { id: number; phone: string }[];

  const due = rows
    .filter((r) => screened(classifyPhone(r.phone)))
    .slice(0, PER_TICK);

  if (due.length === 0) {
    return NextResponse.json({ ok: true, job: "dnc", checked: 0 });
  }

  let results;
  try {
    results = await checkUnitedStates(due.map((r) => r.phone));
  } catch (err) {
    // Unconfigured is the steady state until someone buys a token, so it is
    // reported rather than thrown — a tick that cannot screen must not take
    // the scheduler and poller down with it.
    if (err instanceof DncNotConfiguredError) {
      return NextResponse.json({
        ok: true,
        job: "dnc",
        checked: 0,
        skipped: err.message,
      });
    }
    return NextResponse.json(
      { ok: false, job: "dnc", error: (err as Error).message },
      { status: 502 },
    );
  }

  const byPhone = new Map(results.map((r) => [r.phone, r]));
  let listed = 0;
  for (const lead of due) {
    const result = byPhone.get(lead.phone);
    if (!result) continue;
    if (result.status === "listed") listed++;
    await db.execute(sql`
      update call_lead
      set dnc_status = ${result.status},
          dnc_checked_at = now(),
          dnc_source = 'us_rpv',
          dnc_detail = ${JSON.stringify(result.detail)}::jsonb
      where id = ${lead.id}
    `);
  }

  return NextResponse.json({
    ok: true,
    job: "dnc",
    checked: results.length,
    listed,
  });
}
