import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Register or drop this browser's push subscription.
 *
 * The endpoint is the identity of a subscription — re-subscribing in the same
 * browser returns the same one — so this upserts on it rather than letting a
 * person accumulate a row per page load. It also re-points the row at whoever
 * is signed in now: the floor shares machines, and a subscription left
 * pointing at the last person to use that browser would send one caller's
 * reminders to another.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  await db.execute(sql`
    insert into push_subscription (user_id, endpoint, p256dh, auth, user_agent)
    values (
      ${me.id}, ${endpoint}, ${p256dh}, ${auth},
      ${request.headers.get("user-agent")?.slice(0, 300) ?? null}
    )
    on conflict (endpoint) do update set
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent
  `);

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
  } | null;
  if (typeof body?.endpoint !== "string") {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  // Scoped to the signed-in user: an endpoint is unguessable, but nothing is
  // gained by letting one account delete another's row.
  await db.execute(sql`
    delete from push_subscription
    where endpoint = ${body.endpoint} and user_id = ${me.id}
  `);

  return Response.json({ ok: true });
}
