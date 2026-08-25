import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageShell } from "@/components/page-shell";
import { Keypad } from "@/components/calls/keypad";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canUseKeypad } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * A phone with no lead behind it.
 *
 * Granted per person (`app_user.keypad_access`) rather than by role, because
 * it is one permission and not a rank. Admins have it by being admins.
 *
 * Checked here rather than in the middleware, which only has the session
 * cookie and so could not tell a granted caller from an ungranted one without
 * signing everybody out first. Hiding the sidebar link is the courtesy; this
 * redirect is the control, and a bookmark walks straight past the former.
 *
 * What the grant actually hands over: a line that dials a typed number and
 * writes no `call` row, so nothing from it reaches Stats, the board, the
 * Scoreboard or a lead's state. The screen says so at the bottom rather than
 * relying on whoever opened it to know.
 */
export default async function KeypadPage() {
  const me = await getCurrentUser();
  if (!(await canUseKeypad(me?.id, me?.role))) redirect("/calls");

  // Read straight rather than through `getDids`, which maps one number across
  // every country for the lead-shaped callers. Here there is no lead and so no
  // country to key on: it is simply the number this person rings from.
  const [row] = (await db.execute(
    sql`select telnyx_did from app_user where id = ${me?.id ?? -1}`,
  )) as { telnyx_did: string | null }[];

  return (
    <PageShell title="Keypad">
      <div className="px-4 py-6 sm:px-6">
        <Keypad
          did={row?.telnyx_did?.trim() || null}
          callerName={me?.name ?? "you"}
        />
      </div>
    </PageShell>
  );
}
