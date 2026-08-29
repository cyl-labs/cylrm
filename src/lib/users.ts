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
  /** Their most recent call. What the floor is actually judged on, where
   *  "last seen" only says a tab was open. */
  lastDialedAt: string | null;
  /** Which market they work, and so which script they see. Null shows every
   *  region — see the Team screen. */
  callRegion: CallRegion | null;
  /** The number they ring from. Null falls back to their market's. */
  telnyxDid: string | null;
  /** `browser` | `handset`. See schema. */
  dialMethod: "browser" | "handset";
  /** The founders' account: protected from other admins. */
  isOwner: boolean;
  /** May open the Keypad. Admins always may, whatever this says. */
  keypadAccess: boolean;
  /** How they prefer to be paid — free text, possibly a link. Set on Team,
   *  read on Payroll at the moment a payout is recorded. */
  paymentMethod: string | null;
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
      isOwner: appUser.isOwner,
      keypadAccess: appUser.keypadAccess,
      paymentMethod: appUser.paymentMethod,
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
      lastDialedAt: sql<string | null>`max(${call.calledAt})`,
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
    lastDialedAt: r.lastDialedAt ? new Date(r.lastDialedAt).toISOString() : null,
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

/**
 * Which clock this person reads the calling numbers in.
 *
 * Null means Eastern — `DEFAULT_STATS_REGION` — which is what both Stats and
 * the Scoreboard measured in before the picker existed, so an account that
 * never touches it sees no change. Read live and `cache()`d for the same
 * reasons `callRegionOf` is; a `?tz=` in the URL beats it, that being someone
 * saying which zone they mean for this look at the screen.
 *
 * Kept apart from `callRegion`, which is the market they *work*: a founder in
 * Singapore reading a US floor's numbers has every market and one clock.
 */
export const statsRegionOf = cache(
  async (userId: number | null | undefined): Promise<CallRegion | null> => {
    if (!userId) return null;
    const [row] = await db
      .select({ region: appUser.statsRegion })
      .from(appUser)
      .where(eq(appUser.id, userId));
    return row?.region ?? null;
  },
);

/**
 * Whether this person may open the Keypad.
 *
 * Admins always may — the column is the grant to everyone else, and storing
 * it for admins too would make revoking it look possible when it is not.
 * Read live rather than off the session, like `callRegionOf`, so a grant made
 * on the Team screen lands on their next page load rather than their next
 * login. `cache()`d because the sidebar, the drawer and the page all ask while
 * rendering one page.
 */
export const canUseKeypad = cache(
  async (
    userId: number | null | undefined,
    role: "admin" | "caller" | undefined,
  ): Promise<boolean> => {
    if (role === "admin") return true;
    if (!userId) return false;
    const [row] = await db
      .select({ granted: appUser.keypadAccess })
      .from(appUser)
      .where(eq(appUser.id, userId));
    return row?.granted ?? false;
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

/**
 * How long a heartbeat counts for.
 *
 * Three missed beats at the 15s cadence the dialler sends. Long enough that a
 * slow request or a backgrounded tab does not flicker someone to idle
 * mid-conversation, short enough that a closed laptop stops claiming a call
 * inside a minute. The deploy guard and the Team screen both read it, so a
 * change here moves both together.
 */
export const PRESENCE_TTL_SECONDS = 45;

export type Presence = {
  userId: number;
  name: string;
  /** Null when they are not on a call, or when we stopped hearing from them. */
  onCallSince: string | null;
  seconds: number;
};

/**
 * Who is on a call this second.
 *
 * Only ever browser calls — a handset caller's phone is invisible to us, and
 * the screens say so rather than reporting them idle.
 *
 * Both halves are required: a stale heartbeat means the tab is gone, whatever
 * `on_call_since` still says. Deliberately not `cache()`d, unlike the counts
 * on the sidebar — this is the one query on the app whose whole value is that
 * it is not a moment old.
 */
export async function getLiveCallers(): Promise<Presence[]> {
  const rows = (await db.execute(sql`
    select id, name, on_call_since,
      extract(epoch from (now() - on_call_since))::int as seconds
    from app_user
    where on_call_since is not null
      and presence_at > now() - make_interval(secs => ${PRESENCE_TTL_SECONDS})
    order by on_call_since
  `)) as {
    id: number;
    name: string;
    on_call_since: string | null;
    seconds: number | null;
  }[];

  return rows.map((r) => ({
    userId: Number(r.id),
    name: String(r.name),
    onCallSince: r.on_call_since ? new Date(r.on_call_since).toISOString() : null,
    seconds: Number(r.seconds ?? 0),
  }));
}

/** The heartbeat. `onCall` false clears the call but still stamps the beat, so
 *  an idle caller with a dialler open is known to be there. */
export async function recordPresence(userId: number, onCall: boolean) {
  await db.execute(sql`
    update app_user
    set presence_at = now(),
        -- Left alone when they are already on a call, so the timer counts from
        -- when it started rather than restarting on every heartbeat.
        on_call_since = ${
          onCall ? sql`coalesce(on_call_since, now())` : sql`null`
        }
    where id = ${userId}
  `);
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
