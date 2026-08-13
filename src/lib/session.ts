import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  /**
   * Kept alongside `userId` rather than replaced by it: every route in the
   * app tests it, and a session cookie issued before staff logins existed
   * still has it set. `userId` is what says *who*, so anything that writes a
   * call requires that instead — see `requireUser`.
   */
  loggedIn?: boolean;
  userId?: number;
  /** Denormalised so the sidebar and the call routes do not query for a name
   *  on every request. Refreshed at login; a rename shows up next sign-in. */
  userName?: string;
  role?: "admin" | "caller";
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "cylrm_session",
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

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
 * The signed-in employee, or null.
 *
 * Null for a session predating staff logins, which is why the middleware
 * sends those back to /login: an unattributed call is worse than one more
 * sign-in, since the whole point of the feature is knowing whose it was.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.loggedIn || !session.userId) return null;
  return {
    id: session.userId,
    name: session.userName ?? "Unknown",
    role: session.role ?? "caller",
  };
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
