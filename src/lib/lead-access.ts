import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "@/lib/session";

/**
 * May this person change or undo what is on this lead? (2026-09-29)
 *
 * Used by the routes that edit or delete: relabelling or undoing the latest
 * call, editing notes in the Spreadsheet, and correcting a lead's own fields.
 * Those took a lead id and nothing else, so any caller could rewrite or erase
 * another team's logged call, and calls drive payroll and the quota.
 *
 * Admins may touch anything. Everyone else needs the lead's list to be
 * assigned to them, the same lock `callScope` puts on every calling screen, or
 * to have logged a call of their own on it. The second half keeps a caller
 * working on a business they rang after its niche was reassigned; without it
 * the Spreadsheet would offer an edit that then failed.
 *
 * **Deliberately not applied to logging a new call** (`POST /api/calls`): a
 * ring-back is answered by whoever is at the phone, on a business that may sit
 * on anybody's niche, and that call has to be loggable. It only ever adds a
 * row under the caller's own name, so it cannot erase another person's work.
 */
export async function canEditLead(
  me: CurrentUser,
  leadId: number,
): Promise<boolean> {
  if (me.role === "admin") return true;
  const rows = (await db.execute(sql`
    select 1
    from call_lead l
    join call_list cl on cl.id = l.call_list_id
    where l.id = ${leadId}
      and (
        cl.assigned_user_id = ${me.id}
        or exists (
          select 1 from "call" c
          where c.call_lead_id = l.id and c.user_id = ${me.id}
        )
      )
    limit 1
  `)) as unknown[];
  return rows.length > 0;
}
