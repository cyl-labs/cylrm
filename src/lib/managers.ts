import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "@/lib/session";

/**
 * A caller who looks after other callers (2026-10-01).
 *
 * **There is no manager role.** A manager is whoever somebody else's
 * `app_user.manager_id` points at, set by a founder on Team. Akshansh hires
 * and runs a group of callers and needs to see their numbers, hear their calls
 * and set their quotas; making him an admin would also have handed him pay,
 * accounts and every other caller. A new `Role` value was the other option and
 * it fails the same way: `role === "admin"` is tested in about sixty places,
 * and each of them keeps meaning exactly what it meant only if nothing new is
 * an admin.
 *
 * Everything a manager can reach goes through `canManage`, so the rule is one
 * function and a missed check fails closed (nobody is anybody's report until a
 * founder says so). `callScope` is deliberately untouched: a manager's own
 * working screens stay their own.
 */
export type Report = { id: number; name: string; active: boolean };

/** Everybody who reports to this person, switched-off accounts included: their
 *  calls and recordings are still the manager's to review. */
export const reportsOf = cache(async (managerId: number): Promise<Report[]> => {
  const rows = (await db.execute(sql`
    select id, name, active from app_user
    where manager_id = ${managerId}
    order by active desc, name
  `)) as { id: number; name: string; active: boolean }[];
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active === true }));
});

export const reportIdsOf = async (managerId: number): Promise<number[]> =>
  (await reportsOf(managerId)).map((r) => r.id);

/** Has anybody reporting to them. Drives the nav link, nothing else. */
export const isManager = async (me: CurrentUser | null): Promise<boolean> =>
  me !== null && me.role !== "admin" && (await reportsOf(me.id)).length > 0;

/**
 * May this person manage that person?
 *
 * Founders may manage anyone; anybody else only the people whose `manager_id`
 * is theirs, and never themselves (so a manager cannot raise or lower their own
 * quota, and a founder who set it up wrongly cannot loop it).
 */
export async function canManage(
  me: CurrentUser | null,
  targetId: number,
): Promise<boolean> {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (targetId === me.id) return false;
  return (await reportIdsOf(me.id)).includes(targetId);
}
