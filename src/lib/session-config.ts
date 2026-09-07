/**
 * The session cookie's shape and options, in a module with no database import.
 *
 * `src/middleware.ts` needs both and runs on the edge runtime, where the
 * Postgres client cannot even be bundled — so the moment `session.ts` began
 * reading `app_user` (see `getCurrentUser`) these had to move somewhere the
 * middleware could import without dragging the driver in. Same wall
 * `components/calls/outcome.ts`, `lib/phone.ts` and `lib/stats-zones.ts` were
 * built to get around. `session.ts` re-exports both, so every existing
 * `from "@/lib/session"` still works.
 */
import type { SessionOptions } from "iron-session";

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
