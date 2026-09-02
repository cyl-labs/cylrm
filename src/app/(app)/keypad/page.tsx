import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageShell } from "@/components/page-shell";
import { Keypad } from "@/components/calls/keypad";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { callRegionOf, canUseKeypad, canUseLiveHints } from "@/lib/users";
import { getDiallerSop } from "@/lib/sop";
import { sopRegionFor } from "@/lib/calls";
import { getKeypadLines, getSavedLines } from "@/lib/calls";

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
  //
  // The other two columns decide what the pad can offer to dial: the labelled
  // lines are the founders' to ring, and the plain account numbers belong to
  // whoever works every market rather than one. Read here rather than off the
  // session for the reason `callRegionOf` is — a change made on Team should
  // land on the next page load, not the next login.
  const [row] = (await db.execute(
    sql`select telnyx_did, is_owner, call_region
        from app_user where id = ${me?.id ?? -1}`,
  )) as {
    telnyx_did: string | null;
    is_owner: boolean;
    call_region: string | null;
  }[];

  // Which market's sheet this screen shows.
  //
  // Somebody assigned a market gets theirs and no choice, which is right: they
  // work one market all day and a picker would be a way to get it wrong.
  //
  // Somebody with no market — the founders' account, deliberately, so it can
  // work all of them — gets both and picks. That is the case the dialler solves
  // by falling back to the list's own market; there is no list here, so the
  // choice has to be offered rather than guessed. Showing nothing, which is
  // what `getDiallerSop(null)` returns, reads as the feature being broken
  // rather than as a setting.
  const mine = sopRegionFor(await callRegionOf(me?.id));
  const [us, sg] = await Promise.all([
    mine === "sg" ? null : getDiallerSop("us"),
    mine === "us" ? null : getDiallerSop("sg"),
  ]);
  const sheets = [
    us ? { key: "us" as const, label: "US", ...us } : null,
    sg ? { key: "sg" as const, label: "Singapore", ...sg } : null,
  ].filter((x) => x !== null);

  return (
    <PageShell title="Keypad">
      <div className="px-4 py-6 sm:px-6">
        <Keypad
          did={row?.telnyx_did?.trim() || null}
          callerName={me?.name ?? "you"}
          lines={await getSavedLines()}
          book={await getKeypadLines({
            labelled: row?.is_owner === true,
            // Null is "every market", which is the whole condition: a caller
            // handed one market has one number and nothing to choose between.
            plain: row ? row.call_region === null : false,
          })}
          sheets={sheets}
          liveHints={
            process.env.LIVE_HINTS === "1" &&
            Boolean(process.env.OPENAI_API_KEY) &&
            (await canUseLiveHints(me?.id))
          }
        />
      </div>
    </PageShell>
  );
}
