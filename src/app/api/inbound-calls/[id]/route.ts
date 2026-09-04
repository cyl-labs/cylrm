import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Mark a missed call as rung back.
 *
 * Set by hand rather than derived from a later outgoing call. Deriving it
 * would only work for numbers that match a lead, and a number we hold no lead
 * for is precisely the one most likely to be a new enquiry and the likeliest
 * to be forgotten.
 *
 * Scoped the way the screen is: a caller can only clear a call to their own
 * number, an admin any. Enforced here rather than by hiding the button, since
 * a fetch walks straight past a hidden button.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const callId = Number(id);
  if (!Number.isInteger(callId)) {
    return Response.json({ error: "Invalid call." }, { status: 400 });
  }

  const rows = (await db.execute(sql`
    update inbound_call
    set handled_at = now(), handled_by = ${me.id}
    where id = ${callId}
      and handled_at is null
      ${me.role === "admin" ? sql`` : sql`and user_id = ${me.id}`}
    returning id
  `)) as { id: number }[];

  // Nothing updated is not an error worth a 500: the row may have been cleared
  // by somebody else a moment ago, and the screen refreshing onto the truth is
  // the right outcome either way.
  return Response.json({ ok: true, changed: rows.length });
}
