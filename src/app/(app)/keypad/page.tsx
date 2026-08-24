import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageShell } from "@/components/page-shell";
import { Keypad } from "@/components/calls/keypad";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A phone with no lead behind it, for testing.
 *
 * Admin-only, and the reason is not that the pad is dangerous — it is that a
 * caller placing calls this way places them off the record. Every number a
 * caller should ring is on a niche assigned to them, where the outcome is
 * logged and their day adds up; a pad in the sidebar is a way to make calls
 * that no screen ever counts. Founders testing a line want exactly that.
 *
 * Listed in ADMIN_ONLY_CALL_PREFIXES so the middleware turns a caller away
 * rather than the sidebar merely hiding it.
 */
export default async function KeypadPage() {
  const me = await getCurrentUser();

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
