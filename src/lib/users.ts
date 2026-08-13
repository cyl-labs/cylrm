import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUser, call } from "@/db/schema";
import { hashPassword, normaliseUsername } from "@/lib/password";

export type TeamMember = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "caller";
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  /** Lifetime, across every list — what the Team screen shows next to a name
   *  so a dormant account is obvious without opening Stats. */
  calls: number;
};

/**
 * Everyone, active first then alphabetical.
 *
 * Deactivated accounts stay on the list rather than disappearing: their calls
 * are still in the numbers, and a name that vanishes from the team screen but
 * persists in the stats reads as a bug.
 */
export async function listTeam(): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: appUser.id,
      username: appUser.username,
      name: appUser.name,
      role: appUser.role,
      active: appUser.active,
      createdAt: appUser.createdAt,
      lastSeenAt: appUser.lastSeenAt,
      calls: sql<number>`(select count(*) from ${call} where ${call.userId} = ${appUser.id})`,
    })
    .from(appUser)
    // Descending on a boolean puts the active accounts first.
    .orderBy(desc(appUser.active), asc(appUser.name));

  return rows.map((r) => ({
    ...r,
    role: r.role,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    calls: Number(r.calls ?? 0),
  }));
}

export async function findByUsername(username: string) {
  const [row] = await db
    .select()
    .from(appUser)
    .where(eq(appUser.username, normaliseUsername(username)));
  return row ?? null;
}

export async function createUser(input: {
  username: string;
  name: string;
  password: string;
  role: "admin" | "caller";
}) {
  const [row] = await db
    .insert(appUser)
    .values({
      username: normaliseUsername(input.username),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
    })
    .returning({ id: appUser.id, username: appUser.username });
  return row;
}

/** Stamped on sign-in, so "never signed in" is visible on the Team screen and
 *  a handed-over password that was never used can be spotted. */
export async function touchLastSeen(id: number) {
  await db
    .update(appUser)
    .set({ lastSeenAt: new Date() })
    .where(eq(appUser.id, id));
}

/** How many admins are left. The API refuses to demote or deactivate the last
 *  one — an app nobody can manage needs a database console to fix. */
export async function countActiveAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(appUser)
    .where(sql`${appUser.role} = 'admin' and ${appUser.active}`);
  return Number(row?.n ?? 0);
}
