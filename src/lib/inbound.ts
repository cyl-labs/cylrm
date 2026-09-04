import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dncBlockReason } from "@/lib/dnc";
import { dialCountry } from "@/lib/phone";
import type { CurrentUser } from "@/lib/session";

/**
 * Calls that came in.
 *
 * The mirror of the callbacks diary, and read the same way: opened at the
 * start of a shift, worked top to bottom. What it answers is the thing the
 * Call CRM could not answer at all until inbound existed — somebody rang us
 * and nobody picked up.
 *
 * Rows are written by the Telnyx webhook, so a call that rang out while the
 * CRM was closed is here too. That is the whole reason this is not derived
 * from anything the browser saw.
 */

export type InboundCall = {
  id: number;
  from: string;
  /** Which of our numbers they rang. */
  to: string;
  /** Whose number it was. Null when it belongs to nobody, which only an admin
   *  ever sees and which means a number is routed somewhere unowned. */
  forName: string | null;
  at: string;
  /** Null means nobody picked up. */
  answeredAt: string | null;
  /** Seconds on the call, when it was answered. */
  seconds: number | null;
  handledAt: string | null;
  handledBy: string | null;

  /** The lead this number belongs to, when we have one. */
  leadId: number | null;
  company: string | null;
  leadName: string | null;
  listName: string | null;
  /** Why this number may not be rung, or null — the same block the dialler
   *  and the callbacks diary apply, so a screening result cannot be walked
   *  past just because the prospect rang first. */
  dncBlock: string | null;
};

/** A caller sees calls to their own number; an admin sees the lot, including
 *  the ones belonging to nobody. Deliberately by the number that was rung
 *  rather than by any list ownership: an inbound call is addressed to a
 *  person, not to a niche. */
const scoped = (me: CurrentUser | null) =>
  me?.role === "admin" ? sql`` : sql`and ic.user_id = ${me?.id ?? -1}`;

const KEEP_DAYS = 30;

export async function getInboundCalls(
  me: CurrentUser | null,
  { missedOnly = false }: { missedOnly?: boolean } = {},
): Promise<InboundCall[]> {
  const rows = (await db.execute(sql`
    select ic.id, ic.from_number, ic.to_number, ic.started_at, ic.answered_at,
      ic.ended_at, ic.handled_at,
      u.name as for_name,
      h.name as handled_by,
      l.id as lead_id, l.company, l.name as lead_name,
      l.dnc_status, l.dnc_checked_at,
      cl.name as list_name
    from inbound_call ic
    left join app_user u on u.id = ic.user_id
    left join app_user h on h.id = ic.handled_by
    left join call_lead l on l.id = ic.call_lead_id
    left join call_list cl on cl.id = l.call_list_id
    where ic.started_at > now() - ${`${KEEP_DAYS} days`}::interval
      ${missedOnly ? sql`and ic.answered_at is null and ic.handled_at is null` : sql``}
      ${scoped(me)}
    order by ic.started_at desc
    limit 300
  `)) as Record<string, unknown>[];

  return rows.map((r) => {
    const answeredAt = r.answered_at ? new Date(r.answered_at as string) : null;
    const endedAt = r.ended_at ? new Date(r.ended_at as string) : null;
    const phone = String(r.from_number);
    return {
      id: Number(r.id),
      from: phone,
      to: String(r.to_number),
      forName: (r.for_name as string | null) ?? null,
      at: new Date(r.started_at as string).toISOString(),
      answeredAt: answeredAt?.toISOString() ?? null,
      seconds:
        answeredAt && endedAt
          ? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000))
          : null,
      handledAt: r.handled_at
        ? new Date(r.handled_at as string).toISOString()
        : null,
      handledBy: (r.handled_by as string | null) ?? null,
      leadId: r.lead_id === null ? null : Number(r.lead_id),
      company: (r.company as string | null) ?? null,
      leadName: (r.lead_name as string | null) ?? null,
      listName: (r.list_name as string | null) ?? null,
      dncBlock: dncBlockReason(
        {
          dncStatus: (r.dnc_status as "clean" | "listed" | null) ?? null,
          dncCheckedAt: r.dnc_checked_at
            ? new Date(r.dnc_checked_at as string).toISOString()
            : null,
        },
        dialCountry(phone),
      ),
    };
  });
}

/**
 * How many missed calls are still owed a ring back.
 *
 * `cache()`d for the reason `countCallbacksDue` and `countUnreadReplies` are:
 * the sidebar and `PageShell` both ask while rendering one page.
 */
export const countMissedCalls = cache(async function countMissedCalls(
  me: CurrentUser | null,
): Promise<number> {
  const [row] = (await db.execute(sql`
    select count(*)::int as n from inbound_call ic
    where ic.answered_at is null and ic.handled_at is null
      and ic.started_at > now() - ${`${KEEP_DAYS} days`}::interval
      ${scoped(me)}
  `)) as { n: number }[];
  return row?.n ?? 0;
});
