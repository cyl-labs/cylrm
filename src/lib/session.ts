import { cache } from "react";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sessionOptions, type SessionData } from "@/lib/session-config";

// Re-exported so the sixty-odd `from "@/lib/session"` imports are unchanged;
// the definitions live in a database-free module because the edge middleware
// needs them. See `session-config.ts`.
export { sessionOptions };
export type { SessionData };

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export type CurrentUser = {
  id: number;
  name: string;
  role: "admin" | "caller";
};

/**
 * Whether this account is still switched on.
 *
 * Read from the database on every request rather than taken off the cookie,
 * for exactly the reason `canUseKeypad` and `callRegionOf` are: a session is
 * issued at sign-in and says nothing about what has happened since.
 *
 * Until 2026-09-07 `active` was tested **only** by the login route, so
 * switching somebody off stopped them signing in again and did nothing at all
 * to the session they already held — and the cookie lasts thirty days. An
 * employee who left on Monday kept full working access from the phone in their
 * pocket until October. Found when Allie quit; she had signed in on a personal
 * Android two days earlier. The Team screen's confirm dialog has always said
 * "They are signed out and cannot log back in"; this is what makes the first
 * half of that sentence true.
 *
 * `cache()`d, so the layout, the page and any route handler rendering one
 * request share a single primary-key lookup.
 */
const stillActive = cache(async (userId: number): Promise<boolean> => {
  const rows = (await db.execute(
    sql`select active from app_user where id = ${userId}`,
  )) as { active: boolean }[];
  // A row that has gone is not a reason to let somebody in.
  return rows[0]?.active === true;
});

/**
 * The signed-in employee, or null.
 *
 * Null for a session predating staff logins, which is why the middleware
 * sends those back to /login: an unattributed call is worse than one more
 * sign-in, since the whole point of the feature is knowing whose it was.
 *
 * Null too for an account that has since been switched off — see
 * `stillActive`. Every caller already treats null as "not signed in", so that
 * one check closes the API routes and empties the screens at once; the app
 * layout turns it into a sign-out notice rather than a blank app.
 *
 * `name` and `role` still come off the cookie deliberately: they are
 * denormalised so the sidebar does not query for a name on every request, and
 * a rename showing up at next sign-in is a documented trade. Being switched
 * off is not in that category.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.loggedIn || !session.userId) return null;
  if (!(await stillActive(session.userId))) return null;
  return {
    id: session.userId,
    name: session.userName ?? "Unknown",
    role: session.role ?? "caller",
  };
}

/**
 * A cookie that still names somebody, whose account is switched off.
 *
 * Told apart from "not signed in at all" so the app layout can say what has
 * happened instead of rendering an app with nothing in it. The middleware
 * cannot make this distinction — it has the cookie and no database — and it
 * bounces anyone carrying a session off `/login`, so a redirect there from a
 * page would loop. Clearing the cookie is what breaks the loop, and that is a
 * POST to `/api/logout`.
 */
export async function isSwitchedOff(): Promise<boolean> {
  const session = await getSession();
  if (!session.loggedIn || !session.userId) return false;
  return !(await stillActive(session.userId));
}

/**
 * Guard for every Email CRM endpoint.
 *
 * Callers are kept off the email side entirely, and hiding the nav is not
 * enough — a bookmarked URL or a hand-rolled fetch would sail straight
 * through. Returns a ready Response to bail out with, or null to carry on.
 */
export async function denyIfNotEmailUser(): Promise<Response | null> {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json(
      { error: "The email side is admin-only." },
      { status: 403 },
    );
  }
  return null;
}

/**
 * The owner id to scope calling queries by, or undefined for "everything".
 *
 * Admins run the floor and see every niche; a caller sees only what has been
 * assigned to them. A session with no user resolves to -1 rather than
 * undefined, so a bug upstream fails closed to an empty screen instead of
 * open to the whole database.
 */
export function callScope(me: CurrentUser | null): number | undefined {
  if (me?.role === "admin") return undefined;
  return me?.id ?? -1;
}
