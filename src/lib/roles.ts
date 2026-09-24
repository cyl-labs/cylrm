/**
 * Who somebody is on the floor. Database-free, because the edge middleware and
 * client components read it too.
 *
 * **A closer is a caller who may also close** (2026-09-25). Everything a caller
 * has, a closer has: their own lists, the dialler, the quota bar, pay per
 * pickup. On top of that, and only on meetings a founder has handed them
 * (`call_meeting.closer_user_id`): log what happened at the demo, draft the
 * contracts, book and log the follow-up, and read the closing SOP. Brian was
 * the first — he books demos all week and closes the ones he is given.
 *
 * Nothing about a closer is admin. Every `role === "admin"` test in the app
 * keeps them out, which is the point: the screens that say what somebody is
 * paid, and who else is on the floor, stay the founders'.
 */
export type Role = "admin" | "closer" | "caller";

export const ROLES: readonly Role[] = ["caller", "closer", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  caller: "Caller",
  closer: "Closer",
  admin: "Admin",
};

/** Anything a request body or a cookie says, narrowed. Unknown is a caller:
 *  a role nobody recognises must fail closed, never open. */
export const toRole = (v: unknown): Role =>
  v === "admin" || v === "closer" ? v : "caller";

/**
 * Dials for a living: a caller or a closer.
 *
 * What `role === "caller"` used to mean everywhere it was written — the quota
 * bar, the scoreboard's ranking, payroll's pickup pay, the first-week guide. A
 * closer still cold calls all week and is paid for it the same way, so every
 * one of those asks this instead.
 */
export const isFloor = (role: unknown): boolean =>
  role === "caller" || role === "closer";

/**
 * The founders-only SOP documents a closer may also read.
 *
 * Named one by one rather than "every admin document" on purpose. `audience:
 * admins` means "not for the floor", and the next document to be given it
 * should not reach a closer because somebody forgot this list existed.
 */
export const CLOSER_SOP_SLUGS: readonly string[] = [
  "procedure-closing-the-demo",
];
