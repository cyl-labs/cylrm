import { getCurrentUser } from "@/lib/session";
import { getLiveCallers, recordPresence } from "@/lib/users";

/**
 * Who is mid-call, and the heartbeat that says so.
 *
 * POST is the browser reporting itself, sent by `useTelnyxCall` whenever the
 * line changes state and on a timer while it is up. Any signed-in user may
 * report their own presence and only their own — the id comes from the
 * session, never the body, so one caller cannot mark another as busy.
 *
 * GET is admin-only: it is the floor's live status, the same thing that makes
 * `/call-stats` and `/team` admin-only. The deploy guard does not use it —
 * `deploy.sh` reads the database over the SSH connection it already has, which
 * keeps this route out of the business of authenticating a shell script.
 */
export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { onCall?: unknown };
  await recordPresence(me.id, body.onCall === true);
  return Response.json({ ok: true });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") {
    return Response.json({ error: "Admins only" }, { status: 403 });
  }
  return Response.json({ live: await getLiveCallers() });
}
