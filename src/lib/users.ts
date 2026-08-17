import { cache } from "react";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import type { CallRegion } from "@/lib/calls";
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
  /** Which market they work, and so which script they see. Null shows every
   *  region — see the Team screen. */
  callRegion: CallRegion | null;
  /** The number they ring from. Null falls back to their market's. */
  telnyxDid: string | null;
  /** `browser` | `handset`. See schema. */
  dialMethod: "browser" | "handset";
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
      callRegion: appUser.callRegion,
      telnyxDid: appUser.telnyxDid,
      dialMethod: appUser.dialMethod,
      // A join rather than a correlated subquery, because the subquery this
      // replaces was silently wrong. Drizzle renders an interpolated column
      // unqualified inside `.select()`, so `${appUser.id}` came out as a bare
      // `"id"` — and within `select ... from "call"` that binds to `call.id`,
      // not the user's. It counted calls whose own id happened to equal their
      // user_id, which correlates with nothing and returns the same number for
      // every row: 0 for everyone while user_id was null, then 1 for everyone
      // once the backfill set it. Qualify by joining, where Drizzle has two
      // tables to tell apart and prefixes them.
      //
      // `count(call.id)`, not `count(*)`: a LEFT JOIN that matches nothing
      // still produces one all-NULL row, and `*` scores that phantom as a
      // call — the same trap `getCallLists` documents.
      calls: count(call.id),
    })
    .from(appUser)
    .leftJoin(call, eq(call.userId, appUser.id))
    // Grouping by the primary key alone is enough; the rest are functionally
    // dependent on it.
    .groupBy(appUser.id)
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

/**
 * Which market this person works.
 *
 * Read from the database rather than the session, because the session cookie
 * is only refreshed at sign-in — an admin changing someone's market should
 * take effect on their next page load, not their next login. `cache()`d
 * because the Scripts page and the dialler both ask while rendering one page,
 * the same reason `countUnreadReplies` is.
 */
export const callRegionOf = cache(
  async (userId: number | null | undefined): Promise<CallRegion | null> => {
    if (!userId) return null;
    const [row] = await db
      .select({ region: appUser.callRegion })
      .from(appUser)
      .where(eq(appUser.id, userId));
    return row?.region ?? null;
  },
);

/** How this person places calls. Cached for the same reason callRegionOf is. */
export const dialMethodOf = cache(
  async (userId: number | null | undefined): Promise<"browser" | "handset"> => {
    if (!userId) return "browser";
    const [row] = await db
      .select({ method: appUser.dialMethod })
      .from(appUser)
      .where(eq(appUser.id, userId));
    return row?.method ?? "browser";
  },
);

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
