import { getCurrentUser } from "@/lib/session";
import { pushToUser } from "@/lib/push";

/**
 * Send one notification to whoever just turned reminders on.
 *
 * Fired straight after a successful subscribe, because otherwise the first
 * proof that any of this works arrives days later, when a meeting happens to
 * fall due — and if it silently does not work, nobody finds out until a demo
 * has already been missed. This makes the whole chain, permission through
 * service worker through push service, verifiable at the moment somebody opts
 * in.
 *
 * Only ever to the caller themselves, so it cannot be used to notify anyone
 * else.
 */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const deliveries = await pushToUser(me.id, {
    title: "Reminders are on",
    body: "This is what a meeting reminder looks like.",
    url: "/meetings",
    // Its own tag, so a test never replaces a real reminder sitting unread.
    tag: "cylrm-test",
  });

  return Response.json({ ok: true, deliveries });
}
