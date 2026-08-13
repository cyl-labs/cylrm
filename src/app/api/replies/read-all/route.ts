import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { message } from "@/db/schema";
import { denyIfNotEmailUser, getSession } from "@/lib/session";

const CLEARABLE = ["auto_reply", "bounce"] as const;
type Clearable = (typeof CLEARABLE)[number];

/**
 * Mark whole classes of inbound mail read in one go.
 *
 * Deliberately limited to auto-replies and bounces: those arrive in bulk and
 * need no individual attention, whereas a genuine reply going read without
 * being opened is exactly the failure the unread state exists to prevent.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await denyIfNotEmailUser();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { kinds?: unknown };
  const requested = Array.isArray(body.kinds) ? body.kinds : CLEARABLE;
  const kinds = requested.filter((k): k is Clearable =>
    (CLEARABLE as readonly unknown[]).includes(k),
  );
  if (kinds.length === 0) {
    return Response.json(
      { error: "Only out-of-office replies and bounces can be cleared in bulk." },
      { status: 400 },
    );
  }

  const cleared = await db
    .update(message)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(message.direction, "in"),
        isNull(message.readAt),
        inArray(message.kind, kinds),
      ),
    )
    .returning({ id: message.id });

  return Response.json({ ok: true, cleared: cleared.length });
}
